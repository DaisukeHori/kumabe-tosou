-- rate_limits の原子カウント RPC (cms-ai-pipeline.md §3.3 の rate limit 実装)。
--
-- 従来の rate-limit.server.ts は select → (update | insert) の read-then-write で、
-- 同一 IP からの並列送信で count の取りこぼし (lost update) と PK 重複 insert の失敗が起きうる。
-- insert ... on conflict do update ... returning count の 1 文にまとめ、呼び出し側は
-- 返った count が上限を超えていれば拒否するだけにする。
--
-- rate_limits は primary key (ip_hash, route, window_start) を 20260708000001_init_schema.sql で
-- 定義済みのため、on conflict の競合ターゲットはその PK を使う (追加の unique index は不要)。
--
-- 権限: rate_limits テーブル自体が service role 専用 (RLS ポリシー無し = 拒否) なので、
-- security definer の本関数も anon/authenticated から呼べないよう revoke する
-- (vault_read_secret と同型: 20260708000010_distribution_worker_support.sql)。
create or replace function public.rate_limit_increment(
  p_ip_hash text,
  p_route text,
  p_window_start timestamptz,
  p_limit int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into rate_limits (ip_hash, route, window_start, count)
  values (p_ip_hash, p_route, p_window_start, 1)
  on conflict (ip_hash, route, window_start)
    do update set count = rate_limits.count + 1
  returning count into v_count;

  -- p_limit は呼び出し側の判定材料として受け取るが、DB 側では count を丸めず実数を返す
  -- (上限超過分の試行回数も監視・分析に使えるようにするため)。判定は呼び出し側で行う。
  return v_count;
end;
$$;

revoke execute on function public.rate_limit_increment(text, text, timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.rate_limit_increment(text, text, timestamptz, int)
  to service_role;
