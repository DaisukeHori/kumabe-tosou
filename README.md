# 隈部塗装 — KUMABE TOSO

3Dプリント表面処理（研磨・塗装）専門工房「隈部塗装」の公式サイト。

**「3Dプリントを、量産品と見分けがつかない外観にする最終工程」の専門工房**

- 代表: 隈部 信之
- 所在地: 大分県豊後高田市（郵送受託・全国対応）
- 事業: 積層痕除去の研磨〜自動車グレード塗装仕上げ（試作1点〜ブリッジ生産1,000個）

## サイト

GitHub Pages で公開: https://daisukehori.github.io/kumabe-tosou/

## 構成

```
index.html      … 1ページ構成のLP（全セクション）
css/style.css   … デザイントークン＋全スタイル
js/main.js      … Before/Afterスライダー・スクロール演出・ナビ
```

静的サイト（ビルド不要）。HTML/CSS/Vanilla JS のみ。

## デザイン

- 基調: 塗装ブースの黒 `#0C0D0F` × 実車カラー8色（CSSでパール/メタリック質感を再現）
- 書体: しっぽり明朝B1（見出し）/ Zen Kaku Gothic New（本文）/ IBM Plex Mono（カラーコード・工業ラベル）
- シグネチャー: ヒーローの「しずく型デモピース」Before/Afterスライダー（左＝積層痕、右＝3コート仕上げ）

## 更新予定（TODO)

- [ ] 問い合わせ窓口の確定（`index.html` の `#contact` セクションを差し替え）
- [ ] デモピース実物写真への差し替え（撮影後）
- [ ] 実測に基づく正式価格表の公開
- [ ] OGP画像の追加

## ローカル確認

```bash
python3 -m http.server 8000
# → http://localhost:8000
```
