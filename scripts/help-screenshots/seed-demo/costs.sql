-- ヘルプ用デモデータ: /admin/costs (slug: costs)
-- 撮影ブランチ (help-screenshots) 専用。本番では実行しない。
-- 既存行の削除・更新はしない (INSERT + ON CONFLICT DO NOTHING のみ)。
--
-- 内容:
--   * AI の鍵 3 本 (キー別の表に名前を出すため。実際の鍵の値は入れない)。
--   * 直近 30 日 (2026-08-08〜2026-09-06) の利用記録。
--     プロバイダ 3 社 / モデル 5 種 / 用途 5 種にばらけさせ、
--     日別グラフ・モデル別・キー別・用途別の表すべてに中身が出るようにする。
--   * 当月 (2026-09) の予算消化行 (予算バーが途中まで伸びた状態にする)。
--   id は md5 から決めるので、何度流しても同じ行になる (重複しない)。

insert into ai_provider_keys (id, provider, label, vault_secret_name, key_last4, priority, status, last_tested_at, detected_models, enabled_models, default_model)
values
  (md5('help-key-openai')::uuid,    'openai',    '文章と画像の鍵',   'help_demo_openai_key',    'a91f', 10, 'ok', '2026-09-01T10:00:00+09:00',
   '["gpt-4o-mini","gpt-image-1","whisper-1"]'::jsonb, '["gpt-4o-mini","gpt-image-1","whisper-1"]'::jsonb, 'gpt-4o-mini'),
  (md5('help-key-anthropic')::uuid, 'anthropic', '記事づくりの鍵',   'help_demo_anthropic_key', '7c2d', 20, 'ok', '2026-09-01T10:00:00+09:00',
   '["claude-sonnet-4-5"]'::jsonb, '["claude-sonnet-4-5"]'::jsonb, 'claude-sonnet-4-5'),
  (md5('help-key-gemini')::uuid,    'gemini',    '予備の鍵',         'help_demo_gemini_key',    '5e08', 30, 'ok', '2026-08-20T10:00:00+09:00',
   '["gemini-2.5-flash"]'::jsonb, '["gemini-2.5-flash"]'::jsonb, 'gemini-2.5-flash')
on conflict (id) do nothing;

-- 直近 30 日分の利用記録 (日ごとに決まった値。乱数は使わない)。
insert into ai_usage_log (id, provider, model, key_id, kind, feature, input_tokens, output_tokens, image_count, cost_micro_usd, status, created_at)
select md5('help-usage-studio-' || d::text)::uuid, 'anthropic', 'claude-sonnet-4-5', md5('help-key-anthropic')::uuid,
       'text', 'studio', 12000 + (d % 5) * 1500, 3000 + (d % 4) * 400, null,
       1350000 + (d % 5) * 90000, 'ok', ('2026-08-08'::date + d) + time '10:20' at time zone 'Asia/Tokyo'
from generate_series(0, 29) d
on conflict (id) do nothing;

insert into ai_usage_log (id, provider, model, key_id, kind, feature, input_tokens, output_tokens, image_count, cost_micro_usd, status, created_at)
select md5('help-usage-suggest-' || d::text)::uuid, 'openai', 'gpt-4o-mini', md5('help-key-openai')::uuid,
       'text', 'text-suggest', 3000 + (d % 3) * 500, 900 + (d % 3) * 120, null,
       520000 + (d % 3) * 70000, 'ok', ('2026-08-08'::date + d) + time '14:05' at time zone 'Asia/Tokyo'
from generate_series(0, 29) d
on conflict (id) do nothing;

insert into ai_usage_log (id, provider, model, key_id, kind, feature, input_tokens, output_tokens, image_count, cost_micro_usd, status, created_at)
select md5('help-usage-calltrans-' || d::text)::uuid, 'openai', 'whisper-1', md5('help-key-openai')::uuid,
       'text', 'call-transcribe', null, null, null,
       260000 + (d % 4) * 30000, 'ok', ('2026-08-08'::date + d) + time '09:10' at time zone 'Asia/Tokyo'
from generate_series(0, 29) d where d % 2 = 0
on conflict (id) do nothing;

insert into ai_usage_log (id, provider, model, key_id, kind, feature, input_tokens, output_tokens, image_count, cost_micro_usd, status, created_at)
select md5('help-usage-callanalysis-' || d::text)::uuid, 'gemini', 'gemini-2.5-flash', md5('help-key-gemini')::uuid,
       'text', 'call-analysis', 2200, 700, null,
       210000 + (d % 6) * 25000, 'ok', ('2026-08-08'::date + d) + time '09:25' at time zone 'Asia/Tokyo'
from generate_series(0, 29) d where d % 3 = 0
on conflict (id) do nothing;

insert into ai_usage_log (id, provider, model, key_id, kind, feature, input_tokens, output_tokens, image_count, cost_micro_usd, status, created_at)
select md5('help-usage-snsimage-' || d::text)::uuid, 'openai', 'gpt-image-1', md5('help-key-openai')::uuid,
       'image', 'sns-image', null, null, 4,
       480000, 'ok', ('2026-08-08'::date + d) + time '16:40' at time zone 'Asia/Tokyo'
from generate_series(0, 29) d where d % 5 = 0
on conflict (id) do nothing;

-- 当月の予算消化 (予算バーの見え方をつくる)。
insert into ai_budget_months (month, reserved_micro_usd, settled_micro_usd, reserved_image_count, settled_image_count)
values ('2026-09-01', 850000, 15900000, 4, 20)
on conflict (month) do nothing;
