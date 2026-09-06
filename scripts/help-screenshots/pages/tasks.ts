/**
 * やること (/admin/tasks) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/tasks.ts
 *
 * 撮影先は開発サーバー + Supabase 開発ブランチのデモデータ (本番データは写さない)。
 * デモデータの投入 SQL は scripts/help-screenshots/seed-demo/tasks.sql に置いてある。
 * 出力: public/help/tasks/NN-name.png と同名 .json (注釈座標)。
 */
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "tasks";

/**
 * 編集の引き出しを撮るときに開く「やること」。
 * ヘルプ本文のユースケース (留守電から自動でできた用事を片づける) と同じ 1 件を写すため、
 * 先頭行ではなく題名で指名する (seed-demo/calls.sql で入れている電話AI 由来の 1 件)。
 */
const EDIT_TARGET_TITLE = "田中様へ見積書を送る (メタリックレッド塗装)";

/** カンバンの列は共通部品 (KanbanColumn) が描くので、data-help ではなく読み上げ用の名前で指す。 */
function column(key: string, label: string) {
  return { key, selector: `[role="group"][aria-label="${label}"]` };
}

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: 一覧の全体 (期日ごとのまとまりで並ぶ)。
    await capture(page, {
      slug: SLUG,
      name: "01-list",
      url: "/admin/tasks",
      waitFor: '[data-help="task-row-1"]',
      fullPage: true,
      anchors: [
        help("page-header"),
        help("help-button"),
        help("task-kanban-link"),
        help("task-quick-add"),
        help("task-filters"),
        // 「期日のまとまり」は見出しの行だけを囲む
        // (data-help はまとまり全体の箱に付いているので、その中の見出しを指す)。
        { key: "task-group-overdue", selector: '[data-help="task-group-overdue"] > h3' },
        help("task-row-1"),
        help("task-check-1"),
        help("task-origin-1"),
      ],
    });

    // 2 枚目: 一番上の追加欄 (思いついたことをその場で足す)。
    await capture(page, {
      slug: SLUG,
      name: "02-quick-add",
      url: "/admin/tasks",
      waitFor: '[data-help="task-quick-add"]',
      actions: async (p) => {
        await p.fill('[data-help="task-title-input"] input, input[data-help="task-title-input"]', "田中様に色見本を送る");
      },
      clipTo: { selectors: ['[data-help="task-quick-add"]'], padding: 24 },
      anchors: [
        help("task-quick-add"),
        help("task-title-input"),
        help("task-due-input"),
        help("task-deal-picker"),
        help("task-add-button"),
      ],
    });

    // 3 枚目: 編集の引き出し (右から出てくる入力欄)。
    await capture(page, {
      slug: SLUG,
      name: "03-edit",
      url: "/admin/tasks",
      waitFor: '[data-help="task-menu-1"]',
      actions: async (p) => {
        await p.waitForTimeout(1200); // 画面が操作できる状態になるまで待つ
        // ユースケースの本文と同じ 1 件を開く (行の位置は期日で変わるので題名で指名する)。
        const checkbox = p.locator(`[aria-label="「${EDIT_TARGET_TITLE}」を完了にする"]`);
        await checkbox.waitFor({ state: "visible" });
        await checkbox.locator("xpath=..").getByRole("button", { name: "操作" }).click();
        await p.waitForSelector('[data-slot="dropdown-menu-content"]');
        await p.click('[data-slot="dropdown-menu-item"]:has-text("編集")');
        await p.waitForSelector('[data-help="task-edit-sheet"]');
        await p.waitForTimeout(600);
      },
      anchors: [
        help("task-edit-sheet"),
        help("task-edit-title"),
        help("task-edit-due"),
        help("task-edit-deal"),
        help("task-edit-customer"),
        help("task-edit-body"),
        help("task-edit-save"),
      ],
    });

    // 4 枚目: カンバン表示 (期日の 5 つの列。カードを動かすと期日が変わる)。
    // 盤面は横スクロールするので、撮る間だけ 5 列すべてが並ぶように横幅の制限を外す
    // (列の中身・並びは変わらない。座標もこの状態で測るのでずれない)。
    await capture(page, {
      slug: SLUG,
      name: "04-kanban",
      url: "/admin/tasks?view=kanban",
      waitFor: '[role="grid"][aria-label="やることカンバン"]',
      actions: async (p) => {
        // 盤面はふだん横スクロールするので、撮る間だけ本文の横幅の制限を外して
        // 5 列すべてを 1 枚に収める (左のメニューは切り取りの外なので隠して場所を空ける)。
        // 列の中身・並び・大きさは変わらず、座標もこの状態で測るのでずれない。
        await p.addStyleTag({
          content:
            "aside { display: none !important; } main { max-width: none !important; overflow-x: visible !important; }",
        });
        await p.waitForTimeout(400);
      },
      clipTo: { selectors: ['[role="grid"][aria-label="やることカンバン"]'], padding: 20 },
      anchors: [
        { key: "task-kanban", selector: '[role="grid"][aria-label="やることカンバン"]' },
        column("task-col-overdue", "期日超過"),
        column("task-col-today", "今日"),
        column("task-col-week", "今週"),
        column("task-col-later", "それ以降"),
        column("task-col-no-due", "期日なし"),
      ],
    });

    // 5 枚目: 「完了」で絞り込み、行の操作メニューを開いたところ (元に戻す入口)。
    await capture(page, {
      slug: SLUG,
      name: "05-done",
      url: "/admin/tasks?status=done",
      waitFor: '[data-help="task-row-1"]',
      actions: async (p) => {
        await p.waitForTimeout(1200); // 画面が操作できる状態になるまで待つ
        await p.click('[data-help="task-menu-1"]');
        await p.waitForSelector('[data-slot="dropdown-menu-content"]');
        await p.waitForTimeout(400);
      },
      anchors: [
        help("page-header"),
        help("task-filters"),
        help("task-row-1"),
        help("task-menu-1"),
        { key: "task-row-menu", selector: '[data-slot="dropdown-menu-content"]' },
      ],
    });

    console.log(`[help-screenshots] ${SLUG}: 5 枚を撮影しました`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
