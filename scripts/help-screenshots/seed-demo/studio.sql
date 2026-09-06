-- 発信スタジオ (/admin/studio) ヘルプ用デモデータ。
-- canonical: docs/design/admin-help/README.md §5 (撮影は開発ブランチ help-screenshots のみ)。
--
-- 方針:
-- - 既存行の削除・更新はしない (他担当が同時に撮影中のため insert のみ)。
-- - id は固定 UUID にして、撮影スクリプトの URL (?source=..&run=..) から参照できるようにする。
-- - 内容はすべて架空 (山岸塗装の 3D プリント造形物の塗装ネタ)。本番データは一切含まない。
--
-- 投入する 3 つの場面:
--   A. 音声を文字起こししただけで、まだ整文していない発言 (「整文確認」画面の撮影用)
--   B. 整文まで終わっていて、まだ実行していない発言 (「実行」画面の撮影用)
--   C. 実行が終わってレビュー待ちの発言 + 3 チャネル分の下書き (「レビュー」画面の撮影用)

-- ---------------------------------------------------------------------------
-- A. 文字起こし済み・未整文
-- ---------------------------------------------------------------------------
insert into ai_sources (id, input_type, raw_text, cleaned_text, cleaned_at, transcript_status, duration_seconds, created_at)
values (
  '11111111-1111-4111-8111-111111111101',
  'audio',
  'えーと、今日はですね、あの、3Dプリントの造形物の、まあ積層痕っていうんですけど、あの線を消す下地の話をします。えっと、サフを吹く前に、その、800番くらいのペーパーで、あの、全体をならして、で、細かいところは、まあスポンジやすりで、えー、追い込んでいきます。で、そのあとにサフを2回、薄く、はい、乾かしながら吹くと、まあだいたい消えます。急いで厚く吹くと逆に、あの、垂れるので、そこは、まあ我慢ですね。',
  null,
  null,
  'done',
  74,
  now() - interval '3 hours'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- B. 整文済み・実行前
-- ---------------------------------------------------------------------------
insert into ai_sources (id, input_type, raw_text, cleaned_text, cleaned_at, transcript_status, created_at)
values (
  '11111111-1111-4111-8111-111111111102',
  'text',
  '寒い時期の塗装について話します。気温が10度を下回ると塗料の乾きが遅くなります。無理に乾かそうとすると表面だけ先に固まって曇りが出ます。暖房で室温を上げてから塗るのが確実です。',
  '寒い時期の塗装について話します。気温が10度を下回ると、塗料の乾きが遅くなります。無理に乾かそうとすると表面だけ先に固まり、白い曇りが出ることがあります。作業場の室温を上げてから塗るのが確実です。',
  now() - interval '2 hours',
  'cleaned',
  now() - interval '2 hours'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- C. 整文済み + レビュー待ちの実行
-- ---------------------------------------------------------------------------
insert into ai_sources (id, input_type, raw_text, cleaned_text, cleaned_at, transcript_status, duration_seconds, created_at)
values (
  '11111111-1111-4111-8111-111111111103',
  'audio',
  'えー、フィギュアの塗装の色選びの話なんですけど、あの、写真で見た色と、実物ってけっこう違うんですよね。で、うちでは、まあ色見本を先に送って、実物で決めてもらってます。',
  'フィギュアの塗装では、色選びが仕上がりを大きく左右します。写真で見た色と実物の色は、光の当たり方で印象が変わります。山岸塗装では色見本を先にお送りし、実物を見て決めていただいています。',
  now() - interval '50 minutes',
  'cleaned',
  132,
  now() - interval '1 hour'
)
on conflict (id) do nothing;

insert into ai_runs (id, source_id, status, target_channels, brief, research_enabled, token_usage, created_at, updated_at)
values (
  '22222222-2222-4222-8222-222222222201',
  '11111111-1111-4111-8111-111111111103',
  'ready_for_review',
  array['site_blog','note','x']::text[],
  '{"theme":"フィギュア塗装の色選び","topics":["色見本","光と見え方","打ち合わせの進め方"],"audience":"造形物の塗装を初めて依頼する方","keywords":["フィギュア塗装","色見本","色決め"],"claims":[{"text":"写真の色と実物の色は光の当たり方で印象が変わる","source":"speech","research_url":null},{"text":"山岸塗装では色見本を先に送って実物で色を決めてもらう","source":"speech","research_url":null},{"text":"屋内の照明の色温度によって同じ塗装面でも見え方が変わる","source":"inference","research_url":null}]}'::jsonb,
  false,
  '{"input_tokens":8421,"output_tokens":3110,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"web_search_requests":0}'::jsonb,
  now() - interval '45 minutes',
  now() - interval '40 minutes'
)
on conflict (id) do nothing;

-- 自サイトブログ: レビュー待ち
insert into channel_drafts (id, run_id, channel, status, content, claims, current_revision, created_at)
values (
  '33333333-3333-4333-8333-333333333301',
  '22222222-2222-4222-8222-222222222201',
  'site_blog',
  'needs_review',
  '{"title":"フィギュア塗装の色は、写真ではなく実物で決めてください","excerpt":"写真の色と実物の色は、光の当たり方で印象が変わります。山岸塗装が色見本を先にお送りしている理由をご説明します。","body_md":"## 写真の色は当てになりません\n\nフィギュアやガレージキットの塗装で、いちばん多いご相談が色の決め方です。画面で見た色と、手元に届いた実物の色が違う。これは塗装が悪いのではなく、光の当たり方で色の見え方が変わるためです。\n\n## 色見本を先にお送りします\n\n山岸塗装では、塗り始める前に色見本をお送りしています。実際の塗料を、実際の塗り方で塗った小さな板です。窓際と部屋の照明の下、両方で見比べていただくと、仕上がりの想像がぐっと近づきます。\n\n## 迷ったら 2 色送ってください\n\n候補が絞りきれないときは、2 色まとめて色見本をお作りします。並べて見ると、思っていたより差が小さかった、逆に全然違った、ということがよくあります。","suggested_slug":"figure-color-sample","cover_media_id":null}'::jsonb,
  '[{"text":"写真の色と実物の色は光の当たり方で印象が変わる","source":"speech","research_url":null},{"text":"山岸塗装では色見本を先に送って実物で色を決めてもらう","source":"speech","research_url":null},{"text":"屋内の照明の色温度によって同じ塗装面でも見え方が変わる","source":"inference","research_url":null}]'::jsonb,
  2,
  now() - interval '40 minutes'
)
on conflict (id) do nothing;

-- note: レビュー待ち
insert into channel_drafts (id, run_id, channel, status, content, claims, current_revision, created_at)
values (
  '33333333-3333-4333-8333-333333333302',
  '22222222-2222-4222-8222-222222222201',
  'note',
  'needs_review',
  '{"title":"色見本を先に送る、という手間のはなし","body_md":"塗装の仕事で、いちばん時間をかけているのは実は色決めです。\n\n写真で見た色と、実物の色は違って見えます。太陽の光と部屋の照明では、同じ塗装面でも印象が変わるからです。だから山岸塗装では、塗り始める前に色見本をお送りしています。\n\n手間はかかります。それでも、塗り上がってから違ったと言われるより、ずっと早くて確実です。","hashtags":["塗装","フィギュア","ものづくり"]}'::jsonb,
  '[{"text":"写真の色と実物の色は光の当たり方で印象が変わる","source":"speech","research_url":null},{"text":"山岸塗装では色見本を先に送って実物で色を決めてもらう","source":"speech","research_url":null}]'::jsonb,
  1,
  now() - interval '40 minutes'
)
on conflict (id) do nothing;

-- X: 承認済み (バッジの色の違いを説明するため)
insert into channel_drafts (id, run_id, channel, status, content, claims, current_revision, reviewed_at, created_at)
values (
  '33333333-3333-4333-8333-333333333303',
  '22222222-2222-4222-8222-222222222201',
  'x',
  'approved',
  '{"thread":[{"text":"フィギュア塗装のご相談で一番多いのが色の決め方です。写真の色と実物の色は、光の当たり方で印象が変わります。","media_id":null},{"text":"山岸塗装では塗り始める前に色見本をお送りしています。窓際と部屋の照明、両方で見比べていただくと仕上がりの想像が近づきます。","media_id":null}]}'::jsonb,
  '[{"text":"写真の色と実物の色は光の当たり方で印象が変わる","source":"speech","research_url":null}]'::jsonb,
  1,
  now() - interval '35 minutes',
  now() - interval '40 minutes'
)
on conflict (id) do nothing;

-- 人間が手直しした履歴 (自サイトブログの revision 2)
insert into draft_revisions (id, draft_id, revision, content, edited_by, created_at)
values (
  '44444444-4444-4444-8444-444444444401',
  '33333333-3333-4333-8333-333333333301',
  1,
  '{"title":"フィギュア塗装の色選び","excerpt":"色見本を先にお送りしている理由をご説明します。","body_md":"## 写真の色は当てになりません\n\nフィギュアやガレージキットの塗装で、いちばん多いご相談が色の決め方です。画面で見た色と、手元に届いた実物の色が違う。これは塗装が悪いのではなく、光の当たり方で色の見え方が変わるためです。","suggested_slug":"figure-color-sample","cover_media_id":null}'::jsonb,
  'ai',
  now() - interval '42 minutes'
)
on conflict (id) do nothing;
