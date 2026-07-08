"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * legacy (Phase 0 モックアップ) の /notes ページは #note-01〜#note-07 のアンカーで
 * 7記事へ直接リンクする単一スクロールページだった。CMS 化で /notes/[slug] の詳細
 * ページに分割したため、既存のアンカー URL (SNS 等で共有済みの可能性がある) を
 * 壊さないよう、該当ハッシュがあれば対応する詳細ページへ client-side redirect する
 * (cms-ai-pipeline.md §6.2: 「既存アンカー URL からの redirect 対応」)。
 *
 * seed データ (scripts/seed-data/posts.ts) は note-01〜07 を slug としてそのまま採用して
 * いるため、ハッシュ文字列とスラグは 1:1 で一致する (変換テーブル不要)。
 */
const LEGACY_ANCHOR_PATTERN = /^note-0[1-7]$/;

export function LegacyNoteAnchorRedirect() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (LEGACY_ANCHOR_PATTERN.test(hash)) {
      router.replace(`/notes/${hash}`);
    }
    // マウント時の初回チェックのみで十分 (SPA 内遷移ではこのページを再マウントしてから
    // ハッシュを伴って戻ってくる導線は無い)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
