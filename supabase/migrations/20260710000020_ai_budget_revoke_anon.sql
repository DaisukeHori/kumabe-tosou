-- =========================================================
-- AI スタジオ v2: 予算テーブルの直接アクセスを剥奪 (Codex R (コードレビュー) MINOR 修正)
-- canonical: docs/design/ai-studio-v2.md §2 (全 AI テーブルは admin only + revoke anon)
--
-- 0015 で ai_budget_months / ai_budget_reservations は RLS 有効化のみで、他 4 テーブル
-- (ai_provider_keys / ai_usage_log / ai_image_generations / ai_image_generation_sources)
-- のような明示 revoke が漏れていた。両テーブルは「RPC 経由のみ (直接アクセス不可)」の
-- 設計 (0015 コメント参照) なので、anon/authenticated からの直接アクセスを明示剥奪する。
-- ai_budget_reserve / ai_budget_settle は security definer のため、この revoke の影響を受けず
-- 引き続き両テーブルを読み書きできる (RLS + 直接 grant を関数所有者権限でバイパス)。
-- =========================================================

revoke all on public.ai_budget_months from anon, authenticated;
revoke all on public.ai_budget_reservations from anon, authenticated;
