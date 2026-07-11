-- tests/integration/settings-media-refs.sql
--
-- 位置づけ: #45 (05-site-settings.md §12.1・§13.2 A1〜A3) の結合検証 SQL artifact。
--
-- 【重要・確定方針】このリポジトリでは supabase start / ローカル Docker スタック /
-- Supabase MCP の create_branch は使わない (docker 無し環境のため)。本ファイルは
-- vitest からは実行しない静的ファイルであり、このエージェント (implementer) も実行しない。
--
-- 実行方法 (メインループ担当が本番へ migration 0035・0036 を適用した"後"に実行すること):
--   1. mcp__claude_ai_Supabase__apply_migration で 20260711000035_branding_favicon_media_refs.sql
--      および 20260711000036_site_settings_public_select.sql (レビュー BLOCKER 対応 —
--      site_settings anon SELECT の許可リスト化。07-contracts-delta §D5) を
--      本番 (project_id: ixvfhxbfpdquwktsnmqy — HANDOFF.md §3 / list_projects で要再確認) に適用する
--      (0035 → 0036 の順序で適用。0036 は media 参照や favicon_media_id と無関係な独立 SQL のため
--      逆順でも実害はないが、ファイル番号順を既定の適用順とする)
--   2. 下記の A1 / A2 / A3 の 3 ブロックを、それぞれ独立した
--      mcp__claude_ai_Supabase__execute_sql 呼び出しでそのまま実行する
--      (1 ブロック = 1 回の execute_sql 呼び出しを推奨。ツールが複数 SQL 文の結果セットを
--      1 つしか返さない実装の場合、ブロック内を分割して都度実行すること)
--   3. 各ブロックの SELECT 結果が末尾コメントの「期待値」と一致することを確認し、
--      本番 pg_policies の media_admin_delete 定義文字列に favicon_media_id が含まれることを
--      実測記録する (A1相当の別チェック。05-site-settings.md §13.2 A1)。
--
-- 安全性: 3 ブロックとも begin ... rollback で閉じる。挿入した検証用 media / site_settings.branding /
-- ai_image_generations 行、admin DELETE の試行結果、ai_draft_cleanup_run が内部で行う DELETE は
-- すべてブロック終了時にロールバックされ、本番データには一切影響を残さない。
--
-- ロール模擬方針: Supabase の RLS は `request.jwt.claim.sub` (auth.uid() が読む GUC) と
-- 現在ロール (anon / authenticated / service_role) の組で判定される (Supabase 公式ドキュメント
-- "Testing your database" の確立パターン)。本番には bootstrap-admin による実 profiles 行が
-- 既に 1 件存在する (20260708000002_rls.sql §is_admin 参照) ため、その id をサブクエリで動的に
-- 取得し admin セッションを模擬する。anon は role を 'anon' に切替えるのみ (sub 不要)。
-- service は role を 'service_role' に切替える (RLS を完全 bypass する Supabase の標準動作)。
--
-- 固定 uuid 採番: 00000000-0000-4000-8000-0000000000{45,46,...} を本ファイル専用の
-- テスト用 id として予約する (issue 番号 45 由来。本番の実データと衝突しない前提)。

-- =========================================================
-- A1. 削除拒否: favicon 参照中の media は admin セッションでも DELETE 0 行
--     (media_admin_delete RLS ポリシーの favicon_media_id 条件が効いていることの検証)
-- =========================================================
begin;

-- 準備 (service_role: RLS を bypass して検証用データを作る)
set local role service_role;

insert into media (id, storage_path, alt, width, height, mime_type, tags, is_placeholder)
values (
  '00000000-0000-4000-8000-000000000045',
  'test/issue45-a1-favicon-media.webp',
  'issue45 結合検証用 (A1: favicon 参照 media)',
  32, 32, 'image/webp', '{}', false
)
on conflict (id) do nothing;

insert into site_settings (key, value)
values ('branding', jsonb_build_object('favicon_media_id', '00000000-0000-4000-8000-000000000045'))
on conflict (key) do update set value = excluded.value;

-- admin セッション模擬用に profiles.id をここ (service_role = RLS bypass) で取得し GUC に
-- セットしておく (レビュー MAJOR 対応: authenticated ロールへ切替後に同じサブクエリを
-- 実行すると、その時点では request.jwt.claim.sub がまだ未設定で auth.uid()=null のため
-- profiles_self_select (20260708000002_rls.sql: using (auth.uid() = id)) が全行を弾き
-- 0 行→NULL になり、鶏卵問題で admin セッションを確立できない)。
select set_config('request.jwt.claim.sub', (select id::text from profiles limit 1), true);

reset role;

-- 本検証: admin (authenticated + is_admin()=true) セッションで DELETE を試みる
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

-- admin セッションが実際に確立できていることを明示的にアサートする (レビュー MAJOR 対応)。
-- ここで false/NULL になる場合、以降の DELETE 0 行は「favicon 参照により admin でも拒否」
-- ではなく「admin 未確立につき拒否」という別理由による偽陽性 PASS であり、A1 の検証意図
-- (favicon_media_id 条件が効いていることの検証) を満たさない
select public.is_admin() as a1_is_admin_precondition; -- 期待値: true

with attempt as (
  delete from media
  where id = '00000000-0000-4000-8000-000000000045'
  returning id
)
select count(*) as a1_deleted_row_count -- 期待値: 0 (favicon_media_id 条件により admin でも拒否される)
from attempt;

reset role;

rollback; -- 検証用 media / site_settings.branding の変更、および (万一削除できてしまった場合の) DELETE をすべて戻す

-- =========================================================
-- A2. 参照カウント: media_reference_summary.reference_count に favicon 参照分が加算される
--     (view の DROP+CREATE 置換が反映されていることの検証。anon から読める公開 view)
-- =========================================================
begin;

set local role service_role;

insert into media (id, storage_path, alt, width, height, mime_type, tags, is_placeholder)
values (
  '00000000-0000-4000-8000-000000000045',
  'test/issue45-a2-favicon-media.webp',
  'issue45 結合検証用 (A2: favicon 参照 media)',
  32, 32, 'image/webp', '{}', false
)
on conflict (id) do nothing;

-- 対照用: どこからも参照されていない media (reference_count = 0 の対照)
insert into media (id, storage_path, alt, width, height, mime_type, tags, is_placeholder)
values (
  '00000000-0000-4000-8000-000000000046',
  'test/issue45-a2-unreferenced-media.webp',
  'issue45 結合検証用 (A2: 無参照 media)',
  32, 32, 'image/webp', '{}', false
)
on conflict (id) do nothing;

insert into site_settings (key, value)
values ('branding', jsonb_build_object('favicon_media_id', '00000000-0000-4000-8000-000000000045'))
on conflict (key) do update set value = excluded.value;

reset role;

-- 本検証: anon (site_settings_public_select が 'branding' を許可リストに含む前提 — 07 §D5) から
-- media_reference_summary を読む
set local role anon;

select media_id, reference_count
from public.media_reference_summary
where media_id in (
  '00000000-0000-4000-8000-000000000045', -- 期待値: reference_count >= 1 (favicon 参照分が加算)
  '00000000-0000-4000-8000-000000000046'  -- 期待値: reference_count = 0 (どこからも参照されていない対照)
)
order by media_id;

reset role;

rollback;

-- =========================================================
-- A3. cleanup 除外: ai_draft_cleanup_run は favicon 参照中の ai-draft media を削除候補から除外する
--     (関数内の candidates CTE に favicon_media_id 除外条件が効いていることの検証)
-- =========================================================
begin;

set local role service_role; -- ai_draft_cleanup_run は revoke execute from public,anon,authenticated 済みのため service のみ実行可

-- …045: ai-draft タグ + cutoff (既定 7日) より古い created_at + favicon 参照あり
--       → 除外条件が効いていれば削除候補に「含まれない」
insert into media (id, storage_path, alt, width, height, mime_type, tags, is_placeholder, created_at)
values (
  '00000000-0000-4000-8000-000000000045',
  'test/issue45-a3-favicon-ai-draft-media.webp',
  'issue45 結合検証用 (A3: favicon 参照 + ai-draft media)',
  32, 32, 'image/webp', '{ai-draft}', true, now() - interval '8 days'
)
on conflict (id) do nothing;

-- …046: ai-draft タグ + cutoff より古い created_at + 参照なし (対照)
--       → 通常どおり削除候補に「含まれる」ことの対照確認
insert into media (id, storage_path, alt, width, height, mime_type, tags, is_placeholder, created_at)
values (
  '00000000-0000-4000-8000-000000000046',
  'test/issue45-a3-unreferenced-ai-draft-media.webp',
  'issue45 結合検証用 (A3: 無参照 ai-draft media)',
  32, 32, 'image/webp', '{ai-draft}', true, now() - interval '8 days'
)
on conflict (id) do nothing;

insert into site_settings (key, value)
values ('branding', jsonb_build_object('favicon_media_id', '00000000-0000-4000-8000-000000000045'))
on conflict (key) do update set value = excluded.value;

-- ai_draft_cleanup_run の候補条件のもう1つの要件:
-- 「is_selected=false の ai_image_generations 行が存在する」を両方に用意する
insert into ai_image_generations (id, request_group_id, prompt, provider, model, media_id, is_selected)
values (
  '00000000-0000-4000-8000-000000000047',
  '00000000-0000-4000-8000-000000000048',
  'issue45 結合検証 (A3: favicon 参照側)',
  'openai', 'test-model',
  '00000000-0000-4000-8000-000000000045',
  false
)
on conflict (id) do nothing;

insert into ai_image_generations (id, request_group_id, prompt, provider, model, media_id, is_selected)
values (
  '00000000-0000-4000-8000-000000000049',
  '00000000-0000-4000-8000-000000000050',
  'issue45 結合検証 (A3: 無参照側)',
  'openai', 'test-model',
  '00000000-0000-4000-8000-000000000046',
  false
)
on conflict (id) do nothing;

-- 本検証: ai_draft_cleanup_run を実行し、返り値の media_id 集合を確認する
select media_id, storage_path
from public.ai_draft_cleanup_run(now())
where media_id in (
  '00000000-0000-4000-8000-000000000045', -- 期待値: 結果に含まれない (favicon 参照により除外)
  '00000000-0000-4000-8000-000000000046'  -- 期待値: 結果に含まれる (無参照なので通常どおり削除候補)
);

reset role;

rollback; -- ai_draft_cleanup_run 内部の実 DELETE も含め、すべてロールバックする
