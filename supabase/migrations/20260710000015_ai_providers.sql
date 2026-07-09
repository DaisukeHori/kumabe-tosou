-- =========================================================
-- AI スタジオ v2: ai-providers モジュール基盤 (P1)
-- canonical: docs/design/ai-studio-v2.md §1 (facade/ルータ/キー選択/予算ガード) / §2 (DDL) / §11 (セキュリティ)
--            docs/module-contracts.md v2.5 §1 (ai-providers 所有テーブル: ai_provider_keys,
--            ai_usage_log, ai_image_generations, ai_image_generation_sources, ai_budget_months)
--
-- 本 migration が追加するもの:
--   1) ai_provider_keys テーブル + trigger + RLS (admin only 4 ポリシー) + revoke anon + grant
--   2) ai_usage_log テーブル + RLS (同型) + revoke anon + grant
--   3) ai_image_generations / ai_image_generation_sources テーブル + RLS (admin only) + revoke anon + grant
--   4) ai_budget_months / ai_budget_reservations テーブル (直接アクセス不可。RPC 経由のみ — rate_limits と同型)
--   5) ai_budget_reserve / ai_budget_settle / ai_budget_get_current_month RPC
--      (§1 BLOCKER-2: atomic 予約/確定、FOR UPDATE。reservation 方式で恒久ロックを回避)
--   6) vault_delete_secret RPC (判断点: キー削除時の Vault 秒クリーンアップ。0004/0010 の対)
--   7) media_admin_delete RLS (20260709000013 の DROP+CREATE 置換) に
--      ai_image_generations/ai_image_generation_sources の参照ゼロ判定を追加
--   8) media_reference_summary view (同上) の DROP+CREATE 置換 (整合性のため同時更新)
--   9) site_settings.ops_limits の既存行に AI 予算関連 3 キーをバックフィル
--
-- 乖離・判断点 (オーケストレーターへ報告済み。実装報告参照):
--   - ai_provider_keys.key_last4: 設計書 §2 原文には無い列。§6 UI「保存後は末尾 4 桁のみ表示」
--     を実現するために追加 (生キーは Vault のみに保存する前提と矛盾しない — 末尾 4 桁は非機微情報)。
--   - ai_budget_months / ai_budget_reservations: 設計書は RPC の存在のみ言及し DDL 原文は
--     無いため、reserve/settle の意味論から素直に導かれる列構成で新規設計した。
--   - tester 検証 (HIGH) 対応: 当初 (v1) は ai_budget_months の集計値だけを reserve/settle
--     で加減する設計だったが、settle が呼ばれずに終わる (プロセスクラッシュ・タイムアウト・
--     未捕捉例外) と reserved_micro_usd が二度と減らず、月次予算が実際には空いているのに
--     恒久的に埋まったまま (恒久ロック) になるバグがあった。ai_budget_reservations で
--     個々の予約を追跡し、reserve 呼び出しのたびに「期限切れ (expires_at 経過) かつ未 settle」
--     の予約を自動回収してからカウンタと突き合わせる方式に修正した (v2)。
-- =========================================================

-- =========================================================
-- 1) ai_provider_keys
-- =========================================================
create table ai_provider_keys (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('openai','anthropic','gemini')),
  label text not null,                    -- 表示名 '本番キー' '検証キー'
  vault_secret_name text not null unique, -- 実キーは Vault (前例: vault_upsert_secret)
  key_last4 text not null,                -- 判断点: §6 UI「末尾 4 桁のみ表示」用 (非機微情報)
  priority int not null default 100,      -- 小さいほど優先
  status text not null default 'untested' check (status in ('untested','ok','failed','limited')),
  cooldown_until timestamptz,             -- MAJOR-1: 429 受信時の再試行可能時刻 (status='limited')
  last_error text,                        -- MAJOR-1: 直近の失敗理由 (人間可読)
  last_tested_at timestamptz,
  detected_models jsonb not null default '[]'::jsonb, -- [{id, kind, display}] 検知キャッシュ
  enabled_models jsonb not null default '[]'::jsonb,  -- 管理者が有効化した model id 配列
  default_model text,                     -- kind=text の既定。画像の既定は ops 設定 (§6)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- MINOR-3: priority 同値の決定順は (priority, created_at)。provider+label は unique
create unique index on ai_provider_keys (provider, label);

alter table ai_provider_keys enable row level security;
create policy ai_provider_keys_admin_select on ai_provider_keys for select using (public.is_admin());
create policy ai_provider_keys_admin_insert on ai_provider_keys for insert with check (public.is_admin());
create policy ai_provider_keys_admin_update on ai_provider_keys for update using (public.is_admin()) with check (public.is_admin());
create policy ai_provider_keys_admin_delete on ai_provider_keys for delete using (public.is_admin());
revoke all on ai_provider_keys from anon;
grant select, insert, update, delete on ai_provider_keys to authenticated;

create trigger handle_updated_at before update on ai_provider_keys
  for each row execute procedure extensions.moddatetime (updated_at);

-- =========================================================
-- 2) ai_usage_log
-- =========================================================
create table ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  key_id uuid references ai_provider_keys(id) on delete set null,
  kind text not null check (kind in ('text','image')),
  feature text not null,                  -- 'text-suggest' | 'image-gen' | 'image-cascade' | 'sns-text' | 'sns-image' | 'studio' | 'test' | 'transcribe'
  input_tokens int,
  output_tokens int,
  image_count int,
  cost_micro_usd bigint not null,         -- 記録時に確定 (µUSD 整数)
  status text not null default 'ok' check (status in ('ok','error')),
  error_code text,
  raw_usage jsonb,                        -- MINOR-2: プロバイダ応答の usage 原文 (監査列)
  rate_snapshot jsonb,                    -- MINOR-2: 適用単価のスナップショット
  ref_table text,                         -- MINOR-2: 呼び出し元実体テーブル (ai_image_generations 等)
  ref_id uuid,                            -- MINOR-2: 呼び出し元実体 ID
  created_at timestamptz not null default now()
);
create index on ai_usage_log (created_at);

-- RLS/grant: ai_provider_keys と同型 (admin only 4 ポリシー + revoke anon、設計書 §2 の指示通り)
alter table ai_usage_log enable row level security;
create policy ai_usage_log_admin_select on ai_usage_log for select using (public.is_admin());
create policy ai_usage_log_admin_insert on ai_usage_log for insert with check (public.is_admin());
create policy ai_usage_log_admin_update on ai_usage_log for update using (public.is_admin()) with check (public.is_admin());
create policy ai_usage_log_admin_delete on ai_usage_log for delete using (public.is_admin());
revoke all on ai_usage_log from anon;
grant select, insert, update, delete on ai_usage_log to authenticated;

-- =========================================================
-- 3) ai_image_generations / ai_image_generation_sources
-- =========================================================
-- BLOCKER-3 (SYNTHESIS §系譜モデル準拠): 1 行 = 1 出力画像。バッチは request_group_id で束ねる。
-- 配列 FK は使わない (削除ガード・参照整合を FK で効かせるため)。
create table ai_image_generations (
  id uuid primary key default gen_random_uuid(),
  request_group_id uuid not null,         -- 同一「4 枚生成」バッチの束
  parent_id uuid references ai_image_generations(id) on delete set null, -- カスケード親 (選択された 1 枚の行)
  root_id uuid references ai_image_generations(id) on delete set null,   -- 系譜ルート (パンくず用の非正規化)
  prompt text not null,                   -- このノードで入力されたプロンプト
  provider text not null,
  model text not null,
  params jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','succeeded','failed')),
  provider_interaction_id text,           -- Responses API 等のマルチターン継続用 ID
  media_id uuid references media(id) on delete set null,  -- 生成画像 (成功時、1 行 1 枚)
  is_selected boolean not null default false,             -- ユーザーが選択した画像
  usage_log_id uuid references ai_usage_log(id),
  error_code text,
  created_at timestamptz not null default now()
);
create index on ai_image_generations (request_group_id);
create index on ai_image_generations (parent_id);

alter table ai_image_generations enable row level security;
create policy ai_image_generations_admin_select on ai_image_generations for select using (public.is_admin());
create policy ai_image_generations_admin_insert on ai_image_generations for insert with check (public.is_admin());
create policy ai_image_generations_admin_update on ai_image_generations for update using (public.is_admin()) with check (public.is_admin());
create policy ai_image_generations_admin_delete on ai_image_generations for delete using (public.is_admin());
revoke all on ai_image_generations from anon;
grant select, insert, update, delete on ai_image_generations to authenticated;

-- 参照画像はソース側も FK で
create table ai_image_generation_sources (
  generation_group_id uuid not null,      -- request_group_id と対応
  media_id uuid not null references media(id),
  ord int not null,
  primary key (generation_group_id, media_id)
);

alter table ai_image_generation_sources enable row level security;
create policy ai_image_generation_sources_admin_select on ai_image_generation_sources for select using (public.is_admin());
create policy ai_image_generation_sources_admin_insert on ai_image_generation_sources for insert with check (public.is_admin());
create policy ai_image_generation_sources_admin_update on ai_image_generation_sources for update using (public.is_admin()) with check (public.is_admin());
create policy ai_image_generation_sources_admin_delete on ai_image_generation_sources for delete using (public.is_admin());
revoke all on ai_image_generation_sources from anon;
grant select, insert, update, delete on ai_image_generation_sources to authenticated;

-- =========================================================
-- 4) ai_budget_months / ai_budget_reservations
--    (判断点: 設計書は RPC のみ言及。月次集計行 + 個別予約行として新規設計)
-- =========================================================
create table ai_budget_months (
  month date primary key,                 -- 月初日 (例 2026-07-01) で月を表す
  reserved_micro_usd bigint not null default 0,
  settled_micro_usd bigint not null default 0,
  reserved_image_count int not null default 0,
  settled_image_count int not null default 0,
  updated_at timestamptz not null default now()
);
alter table ai_budget_months enable row level security;
-- rate_limits / work_images と同型: ポリシーを作らない (= 拒否)。
-- ai_budget_reserve / ai_budget_settle (security definer RPC) 経由のみが読み書きする。

-- tester 検証 (HIGH) 対応: 個々の予約を追跡し、settle 未到来 (クラッシュ・タイムアウト等) の
-- 予約を expires_at 経過後に次の reserve 呼び出しが自動回収できるようにする
-- (恒久ロック防止。ai_budget_months の集計値だけでは「どの予約が孤児化したか」判別不能だった)。
create table ai_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  month date not null,
  estimate_micro_usd bigint not null,
  image_count int not null default 0,
  expires_at timestamptz not null,
  settled boolean not null default false,
  created_at timestamptz not null default now()
);
create index on ai_budget_reservations (month, settled, expires_at);
alter table ai_budget_reservations enable row level security;
-- ai_budget_months と同様: ポリシーを作らない (= 拒否)。RPC 経由のみ。

-- =========================================================
-- 5) 予算 RPC (§1 BLOCKER-2: atomic reserve/settle。FOR UPDATE で排他)
-- =========================================================

-- (a) 期限切れ未 settle 予約の回収 → (b) 上限判定 → (c) reservation 行 insert
--     (expires_at = now() + 10 分) + カウンタ加算 → reservation_id を返す。
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
  if not public.is_admin() then
    raise exception 'permission denied: ai_budget_reserve requires admin';
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
  if not public.is_admin() then
    raise exception 'permission denied: ai_budget_settle requires admin';
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
  if not public.is_admin() then
    raise exception 'permission denied: ai_budget_get_current_month requires admin';
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
-- 6) vault_delete_secret RPC (判断点: repository.ts コメント参照。0004/0010 の対)
-- =========================================================
create or replace function public.vault_delete_secret(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from vault.secrets where name = p_name;
end;
$$;

revoke execute on function public.vault_delete_secret(text) from public, anon, authenticated;

-- =========================================================
-- 7) media_admin_delete RLS (20260709000013) の DROP+CREATE 置換
-- =========================================================
drop policy if exists media_admin_delete on media;

create policy media_admin_delete on media
  for delete
  using (
    public.is_admin()
    and not exists (select 1 from work_images wi where wi.media_id = media.id)
    and not exists (select 1 from works w where w.cover_media_id = media.id)
    and not exists (select 1 from posts p where p.cover_media_id = media.id)
    and not exists (select 1 from voices v where v.photo_media_id = media.id)
    and not exists (
      select 1 from site_settings s
      where s.value @> jsonb_build_object('media_id', media.id::text)
         or s.value @> jsonb_build_object('og_media_id', media.id::text)
    )
    and not exists (select 1 from page_media pm where pm.media_id = media.id)
    and not exists (select 1 from ai_image_generations aig where aig.media_id = media.id)
    and not exists (select 1 from ai_image_generation_sources aigs where aigs.media_id = media.id)
  );

-- =========================================================
-- 8) media_reference_summary view (20260709000013) の DROP+CREATE 置換 (整合性のため同時更新)
-- =========================================================
drop view if exists public.media_reference_summary;

create view public.media_reference_summary
with (security_invoker = true) as
select
  m.id as media_id,
  (
    (select count(*) from work_images wi where wi.media_id = m.id)
    + (select count(*) from works w where w.cover_media_id = m.id)
    + (select count(*) from posts p where p.cover_media_id = m.id)
    + (select count(*) from voices v where v.photo_media_id = m.id)
    + (
        select count(*) from site_settings s
        where s.value @> jsonb_build_object('media_id', m.id::text)
           or s.value @> jsonb_build_object('og_media_id', m.id::text)
      )
    + (select count(*) from page_media pm where pm.media_id = m.id)
    + (select count(*) from ai_image_generations aig where aig.media_id = m.id)
    + (select count(*) from ai_image_generation_sources aigs where aigs.media_id = m.id)
  )::int as reference_count
from media m;

grant select on public.media_reference_summary to anon, authenticated;

-- =========================================================
-- 9) site_settings.ops_limits の既存行に AI 予算関連キーをバックフィル
-- (settings/contracts.ts zOpsLimits の非破壊的スキーマ拡張。0013 の hero.media_id 除去と
--  同じ「既存行 UPDATE」パターン)
-- =========================================================
update site_settings
   set value = value || jsonb_build_object(
     'ai_monthly_budget_micro_usd', coalesce(value->'ai_monthly_budget_micro_usd', to_jsonb(50000000)),
     'ai_monthly_image_limit', coalesce(value->'ai_monthly_image_limit', to_jsonb(200)),
     'ai_default_image_model', coalesce(value->'ai_default_image_model', 'null'::jsonb)
   )
 where key = 'ops_limits';
