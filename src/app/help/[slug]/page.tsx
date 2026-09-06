import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdminPage } from "@/app/admin/_lib/require-admin-page";
import { loadHelpDoc } from "@/help/registry";
import { HELP_SLUG_META, isHelpSlug, type HelpSlug } from "@/help/slugs";
import { HelpRenderer, HelpToc } from "@/help/renderer";

/**
 * /help/<slug> (docs/design/admin-help/README.md §3)。
 *
 * - 事前生成はしない (generateStaticParams を置かない)。ヘルプは管理者しか見ないうえ、
 *   ログイン判定が必要なため常にリクエスト時に描く。
 * - /help/login だけは未ログインでも開ける (ログインできない人が読むページなので)。
 * - まだ本文が書かれていない slug は「準備中」を出す (リンク切れにしない)。
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isHelpSlug(slug)) return { title: "使い方" };
  return { title: HELP_SLUG_META[slug].title };
}

export default async function HelpSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isHelpSlug(slug)) notFound();

  // login のヘルプだけは公開 (middleware も /help/login は素通しする)。
  if (slug !== "login") {
    const gate = await requireAdminPage(`/help/${slug}`);
    if (!gate.ok) {
      return (
        <p className="text-sm text-destructive">
          ログイン状態を確認できませんでした ({gate.code})。少し待ってからもう一度開いてください。
        </p>
      );
    }
  }

  const doc = await loadHelpDoc(slug);
  if (!doc) return <HelpPending slug={slug} />;

  return (
    <div data-help-layout="" className="flex flex-col gap-6 md:grid md:grid-cols-[15rem_1fr] md:gap-8">
      <aside data-help-toc-column="" className="md:sticky md:top-20 md:self-start">
        <HelpToc doc={doc} />
      </aside>
      <div className="min-w-0">
        <HelpRenderer doc={doc} />
      </div>
    </div>
  );
}

/** 本文がまだ無い slug の表示 (準備中)。 */
function HelpPending({ slug }: { slug: HelpSlug }) {
  const meta = HELP_SLUG_META[slug];
  return (
    <div className="flex max-w-[40rem] flex-col gap-3 rounded-lg border border-border bg-card p-6">
      <h1 className="font-heading text-xl font-bold text-foreground">{meta.title} の使い方</h1>
      <p className="text-sm text-muted-foreground">
        この画面の説明は準備中です。もうしばらくお待ちください。
      </p>
      <p className="text-sm text-muted-foreground">
        急ぎのときは、画面を触る前に管理担当者に聞いてください。
      </p>
      <Link href={meta.adminPath} className="text-sm underline underline-offset-4">
        {meta.title} の画面を開く
      </Link>
    </div>
  );
}
