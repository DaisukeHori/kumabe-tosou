-- セキュリティアドバイザ対応 (2026-07-08):
-- 1) trigger 関数の search_path 固定 (function_search_path_mutable)
-- 2) media 公開バケットの一覧列挙防止 (public_bucket_allows_listing)
--    公開バケットのオブジェクト配信は公開 URL で行われ RLS ポリシー不要。
--    SELECT ポリシーは list API での全件列挙を許すため削除 (設計 §3.4「一覧不可」準拠)。

create or replace function public.check_channel_post_channel_match()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_draft_channel text;
begin
  select channel into v_draft_channel from channel_drafts where id = new.draft_id;

  if v_draft_channel is null then
    raise exception 'channel_posts.draft_id % が channel_drafts に存在しません', new.draft_id;
  end if;

  if v_draft_channel <> new.channel then
    raise exception 'channel_posts.channel (%) が channel_drafts.channel (%) と一致しません', new.channel, v_draft_channel;
  end if;

  return new;
end;
$$;

drop policy if exists media_bucket_anon_select on storage.objects;
