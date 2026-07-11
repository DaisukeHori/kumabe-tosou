-- =========================================================
-- CRM スイート M0 共通基盤: バックグラウンド AI 実行基盤 (裁定 J2)
-- canonical: docs/design/crm-suite/00-overview.md §3.1.2c (0021 本体・本節が canonical DDL) /
--            docs/design/crm-suite/07-contracts-delta.md §D5 (anon 可読キー許可リスト・同一 SQL)
--
-- 本 migration が行うこと:
--   1. is_admin_or_service() ヘルパ関数の新設 (session 管理者 or service_role のどちらでも通す)
--   2. ai_budget_reserve / ai_budget_settle / ai_budget_get_current_month の
--      冒頭ガードを is_admin() → is_admin_or_service() に緩和 (create or replace)
--   3. site_settings の anon SELECT ポリシーを公開キー許可リストに置換
--      (invoice_issuer の振込先口座・telephony の転送先個人携帯等が anon 公開される事故の防止)
-- 本 migration が行わないこと: 2. の関数本体のロジック変更 (0015 の現行定義を全文コピーし、
--   ガード節 (if not ... then raise ... end if) 1 箇所のみ置換する。ガード節以外は
--   0015 と diff ゼロであることを実装時に確認済み — 実装報告参照)。
--
-- §3.1.1 の問題 (実測済み): router.ts の routeGenerateText/routeGenerateImages/routeTranscribe は
-- 冒頭で createSupabaseServerClient() (cookie セッション) を固定生成し、予算 RPC は
-- is_admin() (= auth.uid() が profiles に存在) 非成立時に raise exception する。
-- service_role クライアントでも auth.uid() = null のため通らず、Twilio webhook / pg_cron
-- 文脈から AI を呼べない。本 migration の is_admin_or_service() 緩和が解決する。
-- =========================================================

-- =========================================================
-- 1) is_admin_or_service()
-- =========================================================
create or replace function public.is_admin_or_service()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.is_admin() or coalesce(auth.jwt()->>'role', '') = 'service_role'
$$;

revoke all on function public.is_admin_or_service() from public, anon;
grant execute on function public.is_admin_or_service() to authenticated;

-- =========================================================
-- 2) ai_budget_reserve / ai_budget_settle / ai_budget_get_current_month
--    (20260710000015_ai_providers.sql の現行定義を全文コピーし、
--     冒頭ガードのみ is_admin_or_service() に置換。それ以外は 1 文字も変えない)
-- =========================================================
create or replace function public.ai_budget_reserve(
  p_estimate_micro_usd bigint,
  p_image_count int default 0
)
returns table (reservation_id uuid, ok boolean, error_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', now())::date;
  v_budget_limit bigint;
  v_image_limit int;
  v_row ai_budget_months%rowtype;
  v_reservation_id uuid;
  v_reclaimed_micro_usd bigint := 0;
  v_reclaimed_images int := 0;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: ai_budget_reserve requires admin or service_role';
  end if;

  insert into ai_budget_months (month) values (v_month)
    on conflict (month) do nothing;

  -- 行ロック取得。以降このトランザクション内は同月の reserve/settle が直列化される。
  select * into v_row from ai_budget_months where month = v_month for update;

  -- (a) 期限切れ未 settle 予約の回収 (恒久ロック対策)。settle が呼ばれないまま
  -- クラッシュ/タイムアウトした予約は expires_at 経過後にここで清算され、
  -- reserved カウンタから確実に外れる (settle 側からの解放を待たずに自己修復する)。
  select
    coalesce(sum(estimate_micro_usd), 0),
    coalesce(sum(image_count), 0)
    into v_reclaimed_micro_usd, v_reclaimed_images
  from ai_budget_reservations
  where month = v_month and settled = false and expires_at < now();

  update ai_budget_reservations
    set settled = true
    where month = v_month and settled = false and expires_at < now();

  -- 回収分を反映した実効値で以降の上限判定・書き込みを行う (メモリ上でのみ調整。
  -- 実テーブルへの反映は下の各分岐の UPDATE でまとめて行う)。
  v_row.reserved_micro_usd := greatest(0, v_row.reserved_micro_usd - v_reclaimed_micro_usd);
  v_row.reserved_image_count := greatest(0, v_row.reserved_image_count - v_reclaimed_images);

  -- (b) 上限判定
  select (value->>'ai_monthly_budget_micro_usd')::bigint into v_budget_limit
    from site_settings where key = 'ops_limits';
  if v_budget_limit is null then v_budget_limit := 50000000; end if;

  select (value->>'ai_monthly_image_limit')::int into v_image_limit
    from site_settings where key = 'ops_limits';
  if v_image_limit is null then v_image_limit := 200; end if;

  if (v_row.reserved_micro_usd + v_row.settled_micro_usd + p_estimate_micro_usd) > v_budget_limit
     or (v_row.reserved_image_count + v_row.settled_image_count + p_image_count) > v_image_limit
  then
    -- 上限超過でも回収した分は必ずカウンタへ反映する (回収を破棄すると次回また
    -- 期限切れ判定からやり直しになり非効率なだけで実害は無いが、素直に反映しておく)。
    update ai_budget_months
      set reserved_micro_usd = v_row.reserved_micro_usd,
          reserved_image_count = v_row.reserved_image_count,
          updated_at = now()
      where month = v_month;
    return query select null::uuid, false, 'KMB-E407'::text;
    return;
  end if;

  -- (c) reservation 行 insert (expires_at = now() + 10 分) + カウンタ加算
  insert into ai_budget_reservations (month, estimate_micro_usd, image_count, expires_at)
  values (v_month, p_estimate_micro_usd, p_image_count, now() + interval '10 minutes')
  returning id into v_reservation_id;

  update ai_budget_months
    set reserved_micro_usd = v_row.reserved_micro_usd + p_estimate_micro_usd,
        reserved_image_count = v_row.reserved_image_count + p_image_count,
        updated_at = now()
    where month = v_month;

  return query select v_reservation_id, true, null::text;
end;
$$;

revoke execute on function public.ai_budget_reserve(bigint, int) from public, anon;
grant execute on function public.ai_budget_reserve(bigint, int) to authenticated;

-- reservation 行を settled 化し、reserved から estimate を減算・settled には actual を加算する。
-- 二重 settle (同じ reservation_id を 2 回呼ぶ) は no-op (settled=true の行は素通り)。
-- reservation_id が既に期限切れ回収で閉じられていた場合も同様に no-op で安全側に倒す。
create or replace function public.ai_budget_settle(
  p_reservation_id uuid,
  p_actual_micro_usd bigint,
  p_actual_image_count int default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation ai_budget_reservations%rowtype;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: ai_budget_settle requires admin or service_role';
  end if;

  select * into v_reservation from ai_budget_reservations where id = p_reservation_id for update;

  if not found or v_reservation.settled then
    return;
  end if;

  update ai_budget_reservations set settled = true where id = p_reservation_id;

  update ai_budget_months
    set reserved_micro_usd = greatest(0, reserved_micro_usd - v_reservation.estimate_micro_usd),
        settled_micro_usd = settled_micro_usd + p_actual_micro_usd,
        reserved_image_count = greatest(0, reserved_image_count - v_reservation.image_count),
        settled_image_count = settled_image_count + p_actual_image_count,
        updated_at = now()
    where month = v_reservation.month;
end;
$$;

revoke execute on function public.ai_budget_settle(uuid, bigint, int) from public, anon;
grant execute on function public.ai_budget_settle(uuid, bigint, int) to authenticated;

-- P5 ダッシュボード用: 当月の reserved/settled/上限を可視化するための読み取り専用 RPC
-- (ai_budget_months/ops_limits の直接 SELECT は RLS で拒否されるため、admin 限定の RPC で提供する)。
create or replace function public.ai_budget_get_current_month()
returns table (
  month date,
  reserved_micro_usd bigint,
  settled_micro_usd bigint,
  reserved_image_count int,
  settled_image_count int,
  budget_limit_micro_usd bigint,
  image_limit int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', now())::date;
  v_budget_limit bigint;
  v_image_limit int;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: ai_budget_get_current_month requires admin or service_role';
  end if;

  select (value->>'ai_monthly_budget_micro_usd')::bigint into v_budget_limit
    from site_settings where key = 'ops_limits';
  if v_budget_limit is null then v_budget_limit := 50000000; end if;

  select (value->>'ai_monthly_image_limit')::int into v_image_limit
    from site_settings where key = 'ops_limits';
  if v_image_limit is null then v_image_limit := 200; end if;

  return query
    select
      v_month,
      coalesce(m.reserved_micro_usd, 0::bigint),
      coalesce(m.settled_micro_usd, 0::bigint),
      coalesce(m.reserved_image_count, 0),
      coalesce(m.settled_image_count, 0),
      v_budget_limit,
      v_image_limit
    from (select 1) as _dummy
    left join ai_budget_months m on m.month = v_month;
end;
$$;

revoke execute on function public.ai_budget_get_current_month() from public, anon;
grant execute on function public.ai_budget_get_current_month() to authenticated;

-- =========================================================
-- 3) site_settings: 全行 anon SELECT (20260708000002 site_settings_anon_select using(true)) を廃し、
--    公開キーの許可リストに置換する (07-contracts-delta.md §D5 と同一 SQL。既定 deny — 新規キーは
--    許可リストに載せない限り anon から読めない)。非公開キー (ops_limits / notifications /
--    invoice_issuer / work_capacity / telephony) は admin セッションまたは service client のみ読取。
--    既存 anon 読取の同時是正: src/modules/inquiry/internal/notify.ts の notifications read を
--    service client へ切替済み (同フェーズの実装対象 — 実装報告参照。通知メールが静かに止まる
--    regression を防ぐ)。
-- =========================================================
drop policy if exists site_settings_anon_select on site_settings;

create policy site_settings_public_select on site_settings
  for select
  using (key in ('company', 'hero', 'seo_defaults', 'analytics', 'branding', 'business_hours'));

create policy site_settings_admin_select on site_settings
  for select
  using (public.is_admin());

-- =========================================================
-- 4) site_settings.ops_limits の既定行を冪等に用意する (敵対レビュー MAJOR#1)
--
-- 背景: distribution/internal/worker.ts と distribution/facade.ts (schedulePosts) の
-- X 課金ガードは、ops_limits 行が読めない (行不在 or zOpsLimits.safeParse 失敗) 場合に
-- 無制限フォールバックを避けて安全側 (投稿ブロック) に倒す設計にした。しかしこれまでの
-- migration には ops_limits 行を新規作成する処理が一切無く (上の 0015 §9 相当の
-- バックフィルは「既存行があれば」の UPDATE のみで、行そのものは作らない)。
-- scripts/seed-from-legacy.ts を未実行の新規/リストア環境ではこの行が存在せず、
-- fail-closed が常時発動して X 配信が起動直後から機能停止する。
--
-- 対応: on conflict (key) do nothing で「行が無ければ既定値を作る、既にあれば一切
-- 触らない (本番の現行値を尊重する)」を保証する。site_settings.key は primary key
-- (20260708000001_init_schema.sql) のため on conflict (key) が成立する。
-- ops_limits は 20260708000001_init_schema.sql の時点から既に存在が前提とされている
-- 既存キーであり、07-contracts-delta.md の「新規キーの seed 禁止」規約 (migration から
-- 未知キーを勝手に作らない) の対象外 (新規キーの追加ではなく、既存キーの行不在という
-- 運用上の穴を塞ぐもの)。
--
-- 既定値の出典 (zOpsLimits.parse を通る完全値。scripts/seed-data/settings.ts の
-- OPS_LIMITS_SEED、および本ファイル §2 / 20260710000015_ai_providers.sql §9 の
-- バックフィル既定値と同一の値に揃えている):
--   x_monthly_post_limit        = 100        (OPS_LIMITS_SEED コメント「初期値 100」)
--   ai_monthly_budget_micro_usd = 50_000_000 ($50。§2 v_budget_limit 既定と同値)
--   ai_monthly_image_limit      = 200         (§2 v_image_limit 既定と同値)
--   ai_default_image_model      = null        (未設定。設定画面で選択されるまで)
-- =========================================================
insert into site_settings (key, value)
values (
  'ops_limits',
  jsonb_build_object(
    'x_monthly_post_limit', 100,
    'ai_monthly_budget_micro_usd', 50000000,
    'ai_monthly_image_limit', 200,
    'ai_default_image_model', null
  )
)
on conflict (key) do nothing;
