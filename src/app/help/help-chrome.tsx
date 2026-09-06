"use client";

import { useEffect } from "react";

/**
 * ヘルプ画面の上部バーにある 2 つのボタン (Client Component)。
 * - 印刷: window.print()。印刷用 CSS は layout.tsx の <style> に置いてある。
 *   よくある質問は閉じていると紙にも出ないので、印刷の直前にすべて開く。
 * - 管理画面に戻る: 別ウィンドウで開いている場合は window.close() で閉じ、
 *   閉じられない場合 (直接 URL を開いたとき) は管理画面へ移動する。
 */
export function HelpChromeButtons({ backHref }: { backHref: string }) {
  // ブラウザのメニューや Ctrl+P から印刷したときも、質問がすべて開いた状態で印刷されるようにする。
  useEffect(() => {
    const openAll = () => {
      document.querySelectorAll("details").forEach((el) => {
        el.open = true;
      });
    };
    window.addEventListener("beforeprint", openAll);
    return () => window.removeEventListener("beforeprint", openAll);
  }, []);

  return (
    <div className="flex items-center gap-2" data-help-chrome="">
      <button
        type="button"
        onClick={() => {
          document.querySelectorAll("details").forEach((el) => {
            el.open = true;
          });
          window.print();
        }}
        className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
      >
        印刷
      </button>
      <button
        type="button"
        onClick={() => {
          window.close();
          // 別ウィンドウでない (window.open で開いていない) 場合は close が効かないので移動する。
          window.setTimeout(() => {
            window.location.href = backHref;
          }, 150);
        }}
        className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
      >
        管理画面に戻る
      </button>
    </div>
  );
}
