// ヘルプ撮影用デモデータの SQL 生成スクリプト。
// 実行: node scripts/help-screenshots/seed-demo/generate-00-base.mjs > scripts/help-screenshots/seed-demo/00-base.sql
// 生成した SQL は Supabase MCP execute_sql (project_id: lyafsdqnxeswkohsqbyx) に投入する。
// 既存データは削除・更新しない (INSERT のみ)。

function uuid() {
  return crypto.randomUUID();
}

function sqlStr(s) {
  if (s === null || s === undefined) return "null";
  return `'${String(s).replace(/'/g, "''")}'`;
}
function sqlBool(b) {
  return b ? "true" : "false";
}
function sqlNum(n) {
  return n === null || n === undefined ? "null" : String(n);
}
function sqlJson(obj) {
  return `'${JSON.stringify(obj).replace(/'/g, "''")}'::jsonb`;
}
function sqlArr(arr) {
  if (!arr || arr.length === 0) return "'{}'";
  return `ARRAY[${arr.map((s) => sqlStr(s)).join(",")}]`;
}
function ts(isoLocalNoTz) {
  // '2026-09-06 09:00:00+09'
  return sqlStr(`${isoLocalNoTz}+09`);
}

const out = [];
const p = (s) => out.push(s);

p("-- scripts/help-screenshots/seed-demo/00-base.sql");
p("-- ヘルプ用スクリーンショット撮影のデモデータ (Supabase 開発ブランチ help-screenshots 専用)。");
p("-- 生成: scripts/help-screenshots/seed-demo/generate-00-base.mjs (再現用)。架空の名前・番号のみ。");
p("-- 既存データは削除・更新しない (INSERT のみ)。");
p("begin;");
p("-- 発行済み帳票の明細 INSERT ガード (document_lines_draft_guard) をこのトランザクションに限り解除。");
p("-- 通常の発行フローは RPC 経由でこの GUC を立てるが、デモ投入は直接 INSERT するため必要。");
p("select set_config('kmb.sales_revision_unlock', 'on', true);");
p("");

// ---------------------------------------------------------------
// 1. site_settings
// ---------------------------------------------------------------
p("-- ===== site_settings =====");

const companyValue = {
  name: "山岸塗装",
  representative: "山岸 信之",
  address: "〒879-0614 大分県豊後高田市来縄3036-1",
  tel: "090-9478-5028",
  email: "info@example.com",
  founded: "2018",
  business_hours: "平日 9:00〜18:00 (土日祝休み)",
};
const seoValue = {
  title_template: "%s | 山岸塗装",
  description:
    "3Dプリントを、量産品と見分けがつかない外観に。積層痕除去の研磨から自動車グレードの塗装仕上げまで、試作1点からブリッジ生産1,000個まで郵送で全国受託。山岸塗装(大分県豊後高田市)。",
  og_media_id: null,
};
const heroValue = {
  heading: "3Dプリントを、量産品と見分けがつかない外観に。",
  subheading: "積層痕を消す研磨から、自動車グレードの塗装仕上げまで。",
  cta_label: "SHOPで概算を出す",
  cta_href: "/shop",
};
const opsLimitsValue = {
  x_monthly_post_limit: 100,
  ai_monthly_budget_micro_usd: 50_000_000,
  ai_monthly_image_limit: 200,
  ai_default_image_model: null,
};
const notificationsValue = {
  inquiry_to: "demo@example.com",
  on_publish_failure: false,
};
const telephonyValue = {
  phone_number_e164: "+815000000000",
  twilio_number_sid: "PN00000000000000000000000000000000",
  forward_to_e164: "+819000000000",
  consent_announcement_enabled: true,
  consent_announcement_text: null,
  in_hours_greeting_text: null,
  after_hours_greeting_text: null,
  voicemail_max_seconds: 120,
  delete_twilio_recording_after_download: true,
  max_processing_minutes: 30,
};
const businessHoursValue = {
  mon: { open: "09:00", close: "18:00" },
  tue: { open: "09:00", close: "18:00" },
  wed: { open: "09:00", close: "18:00" },
  thu: { open: "09:00", close: "18:00" },
  fri: { open: "09:00", close: "18:00" },
  sat: null,
  sun: null,
  holidays: [],
};
const workCapacityValue = { weekly_hours: 40 };
const invoiceIssuerValue = {
  issuer_name: "山岸塗装",
  registration_number: "T0000000000000",
  tax_rounding: "floor",
  bank_account: {
    bank_name: "おおいた信用金庫",
    branch_name: "豊後高田支店",
    account_type: "ordinary",
    account_number: "1234567",
    account_holder_kana: "ヤマギシトソウ",
  },
  transfer_fee_note: "振込手数料はお客様のご負担でお願いします。",
  seal_storage_path: null,
  quote_valid_days: 30,
};

function upsertSetting(key, value) {
  p(
    `insert into site_settings (key, value) values (${sqlStr(key)}, ${sqlJson(value)}) on conflict (key) do nothing;`,
  );
}
upsertSetting("company", companyValue);
// 注記: seo_defaults.og_media_id は zMediaId (uuid, 必須・nullable ではない) のため、
// media 行を作らない方針 (実体が無い Storage 参照を避ける) と両立できない。
// 判断: seo_defaults は投入しない (既存の未設定状態のまま)。§ 報告に記載する。
void seoValue;
upsertSetting("hero", heroValue);
upsertSetting("ops_limits", opsLimitsValue);
upsertSetting("notifications", notificationsValue);
upsertSetting("telephony", telephonyValue);
upsertSetting("business_hours", businessHoursValue);
upsertSetting("work_capacity", workCapacityValue);
upsertSetting("invoice_issuer", invoiceIssuerValue);
p("");

// ---------------------------------------------------------------
// 2. work_types (5) — 既定 seed と重複しないよう key に demo_ 接頭辞
// ---------------------------------------------------------------
p("-- ===== work_types =====");
const workTypes = [
  { key: "demo_sanding", label: "研磨", color: "#60a5fa", consumes: true, hours: 2 },
  { key: "demo_primer", label: "下地(プライマー)", color: "#f59e0b", consumes: true, hours: 1.5 },
  { key: "demo_painting", label: "塗装", color: "#ef4444", consumes: true, hours: 3 },
  { key: "demo_drying", label: "乾燥", color: "#a78bfa", consumes: false, hours: 12 },
  { key: "demo_inspection", label: "検品", color: "#22c55e", consumes: true, hours: 0.5 },
].map((w) => ({ ...w, id: uuid() }));

for (const [i, w] of workTypes.entries()) {
  p(
    `insert into work_types (id, key, label, color, consumes_capacity, default_hours, sort_order) values (${sqlStr(w.id)}, ${sqlStr(w.key)}, ${sqlStr(w.label)}, ${sqlStr(w.color)}, ${sqlBool(w.consumes)}, ${w.hours}, ${i + 1}) on conflict (key) do nothing;`,
  );
}
p("");

// ---------------------------------------------------------------
// 3. work_templates (2) + work_template_items
// ---------------------------------------------------------------
p("-- ===== work_templates =====");
const templates = [
  { id: uuid(), name: "標準塗装セット (小物)", grade_key: "demo_solid", size_key: "demo_small" },
  { id: uuid(), name: "自動車グレード仕上げセット", grade_key: "demo_premium", size_key: "demo_large" },
];
for (const t of templates) {
  p(
    `insert into work_templates (id, name, grade_key, size_key, is_active) values (${sqlStr(t.id)}, ${sqlStr(t.name)}, ${sqlStr(t.grade_key)}, ${sqlStr(t.size_key)}, true);`,
  );
}
let itemSort = 0;
for (const t of templates) {
  for (const [idx, w] of workTypes.entries()) {
    itemSort++;
    p(
      `insert into work_template_items (id, template_id, work_type_id, hours, sort_order) values (${sqlStr(uuid())}, ${sqlStr(t.id)}, ${sqlStr(w.id)}, ${w.hours}, ${idx + 1});`,
    );
  }
}
p("");

// ---------------------------------------------------------------
// 4. companies (3)
// ---------------------------------------------------------------
p("-- ===== companies =====");
const companies = [
  { id: uuid(), name: "有限会社豊後カスタムパーツ", kana: "ブンゴカスタムパーツ", tel: "+81978000001", address: "大分県豊後高田市本町1-1" },
  { id: uuid(), name: "株式会社来縄モデリング", kana: "クナワモデリング", tel: "+81978000002", address: "大分県豊後高田市来縄100-2" },
  { id: uuid(), name: "田染フィギュア工房合同会社", kana: "タシブフィギュアコウボウ", tel: "+81978000003", address: "大分県豊後高田市田染300-5" },
].map((c) => ({ ...c }));
for (const c of companies) {
  p(
    `insert into companies (id, name, name_kana, tel_e164, address) values (${sqlStr(c.id)}, ${sqlStr(c.name)}, ${sqlStr(c.kana)}, ${sqlStr(c.tel)}, ${sqlStr(c.address)});`,
  );
}
p("");

// ---------------------------------------------------------------
// 5. customers (8: person 5 / company_contact 3)
// ---------------------------------------------------------------
p("-- ===== customers =====");
function cf(pairs) {
  return Object.entries(pairs).map(([label, value]) => ({ label, value }));
}
const customers = [
  {
    id: uuid(), kind: "person", name: "田中 一郎", kana: "タナカ イチロウ", email: "tanaka.demo1@example.com",
    tel: "+819000000101", company_id: null, address: "大分県別府市北浜1-2-3", lifecycle: "customer", source: "form",
    custom_fields: cf({ 依頼品目: "フィギュア", 塗装希望色: "メタリックレッド" }),
    billing_info: { postal_code: "8740041", address: "大分県別府市北浜1-2-3", tel_e164: "+819000000101", name: "田中 一郎", suffix: "様" },
    shipping_info: null,
  },
  {
    id: uuid(), kind: "person", name: "佐々木 花子", kana: "ササキ ハナコ", email: "sasaki.demo2@example.com",
    tel: "+819000000102", company_id: null, address: "福岡県北九州市小倉北区1-1", lifecycle: "lead", source: "simulator",
    custom_fields: [], billing_info: null, shipping_info: null,
  },
  {
    id: uuid(), kind: "person", name: "山本 太郎", kana: "ヤマモト タロウ", email: null,
    tel: "+819000000103", company_id: null, address: "大分県中津市3-4-5", lifecycle: "lead", source: "phone",
    custom_fields: [], billing_info: null, shipping_info: null,
  },
  {
    id: uuid(), kind: "person", name: "小林 みどり", kana: "コバヤシ ミドリ", email: "kobayashi.demo4@example.com",
    tel: "+819000000104", company_id: null, address: "大分県杵築市6-7-8", lifecycle: "customer", source: "manual",
    custom_fields: cf({ 依頼品目: "自動車パーツ" }),
    billing_info: null,
    shipping_info: { postal_code: "8730001", address: "大分県杵築市6-7-8", tel_e164: "+819000000104", name: "小林 みどり", suffix: null },
  },
  {
    id: uuid(), kind: "person", name: "渡辺 修", kana: "ワタナベ オサム", email: "watanabe.demo5@example.com",
    tel: "+819000000105", company_id: null, address: "大分県宇佐市9-1-2", lifecycle: "archived", source: "migration",
    custom_fields: [], billing_info: null, shipping_info: null,
  },
  {
    id: uuid(), kind: "company_contact", name: "松本 健二", kana: "マツモト ケンジ", email: "matsumoto.demo6@example.com",
    tel: "+819000000106", company_id: companies[0].id, address: null, lifecycle: "customer", source: "manual",
    custom_fields: cf({ 部署: "購買部" }),
    billing_info: { postal_code: "8790614", address: companies[0].address, tel_e164: companies[0].tel, name: companies[0].name, suffix: "御中" },
    shipping_info: null,
  },
  {
    id: uuid(), kind: "company_contact", name: "中村 由美", kana: "ナカムラ ユミ", email: "nakamura.demo7@example.com",
    tel: "+819000000107", company_id: companies[1].id, address: null, lifecycle: "customer", source: "form",
    custom_fields: cf({ 部署: "設計部" }), billing_info: null, shipping_info: null,
  },
  {
    id: uuid(), kind: "company_contact", name: "加藤 大輔", kana: "カトウ ダイスケ", email: "kato.demo8@example.com",
    tel: "+819000000108", company_id: companies[2].id, address: null, lifecycle: "lead", source: "manual",
    custom_fields: [], billing_info: null, shipping_info: null,
  },
];
for (const c of customers) {
  p(
    `insert into customers (id, kind, name, name_kana, email, tel_e164, company_id, address, lifecycle, source, custom_fields, billing_info, shipping_info) values (${sqlStr(c.id)}, ${sqlStr(c.kind)}, ${sqlStr(c.name)}, ${sqlStr(c.kana)}, ${sqlStr(c.email)}, ${sqlStr(c.tel)}, ${sqlStr(c.company_id)}, ${sqlStr(c.address)}, ${sqlStr(c.lifecycle)}, ${sqlStr(c.source)}, ${sqlJson(c.custom_fields)}, ${c.billing_info ? sqlJson(c.billing_info) : "null"}, ${c.shipping_info ? sqlJson(c.shipping_info) : "null"});`,
  );
}
p("");

// ---------------------------------------------------------------
// 6. deals (8) — 相談/見積中/見積送付/受注/製作中/請求/入金済/失注
// ---------------------------------------------------------------
p("-- ===== deals =====");
const deals = [
  { id: uuid(), title: "田中様 フィギュア塗装のご相談", customer_id: customers[0].id, stage: "inquiry", amount: null, source: "form" },
  { id: uuid(), title: "佐々木様 見積り作成中", customer_id: customers[1].id, stage: "estimating", amount: 28000, source: "simulator" },
  { id: uuid(), title: "山本様 見積り送付済み", customer_id: customers[2].id, stage: "quote_sent", amount: 45000, source: "phone" },
  { id: uuid(), title: "小林様 自動車パーツ塗装 受注", customer_id: customers[3].id, stage: "ordered", amount: 120000, source: "manual" },
  { id: uuid(), title: "松本様(豊後カスタムパーツ) 製作中案件", customer_id: customers[5].id, company_id: companies[0].id, stage: "in_production", amount: 260000, source: "manual" },
  { id: uuid(), title: "中村様(来縄モデリング) 請求書発行済み", customer_id: customers[6].id, company_id: companies[1].id, stage: "invoiced", amount: 98000, source: "manual" },
  { id: uuid(), title: "田中様 過去のご依頼(入金済み)", customer_id: customers[0].id, stage: "paid", amount: 32000, source: "form" },
  { id: uuid(), title: "渡辺様 見送りとなった案件", customer_id: customers[4].id, stage: "lost", amount: 15000, source: "manual", lost_reason: "予算が合わなかったため" },
];
for (const d of deals) {
  p(
    `insert into deals (id, title, customer_id, company_id, stage, amount_jpy, source, lost_reason) values (${sqlStr(d.id)}, ${sqlStr(d.title)}, ${sqlStr(d.customer_id)}, ${sqlStr(d.company_id ?? null)}, ${sqlStr(d.stage)}, ${sqlNum(d.amount)}, ${sqlStr(d.source)}, ${sqlStr(d.lost_reason ?? null)});`,
  );
}
p("");

// ---------------------------------------------------------------
// 7. activities (deal ごとに2〜3件) + activity_links
// ---------------------------------------------------------------
p("-- ===== activities =====");
function addActivity(occurredAt, type, title, body, dealId, customerId) {
  const id = uuid();
  p(
    `insert into activities (id, activity_type, occurred_at, title, body) values (${sqlStr(id)}, ${sqlStr(type)}, ${ts(occurredAt)}, ${sqlStr(title)}, ${sqlStr(body)});`,
  );
  if (dealId) {
    p(`insert into activity_links (id, activity_id, deal_id) values (${sqlStr(uuid())}, ${sqlStr(id)}, ${sqlStr(dealId)});`);
  }
  if (customerId) {
    p(`insert into activity_links (id, activity_id, customer_id) values (${sqlStr(uuid())}, ${sqlStr(id)}, ${sqlStr(customerId)});`);
  }
  return id;
}

const activityScripts = [
  [
    ["2026-08-20 10:00:00", "note", "ホームページの問い合わせフォームから受信", "フィギュアの塗装について相談したいとのこと。"],
    ["2026-08-21 09:30:00", "note", "折り返しの電話をかけた", "詳細をヒアリング。写真を送ってもらう予定。"],
  ],
  [
    ["2026-08-18 14:00:00", "simulator_estimate", "概算見積りシミュレーターを利用", "メタリック塗装、小物1点で概算28,000円。"],
    ["2026-08-22 11:00:00", "note", "見積り作成を開始", "現物確認待ち。"],
  ],
  [
    ["2026-08-10 13:00:00", "call", "着信: 見積り依頼の電話", "自動車パーツの塗装について。"],
    ["2026-08-15 16:00:00", "document_event", "見積書を送付", "Q-2026-0002 を発行し郵送した。"],
  ],
  [
    ["2026-07-30 10:00:00", "note", "見積り承諾の連絡あり", "電話にて正式受注の連絡。"],
    ["2026-08-01 09:00:00", "document_event", "受注書を発行", "J-2026-0001 を発行。"],
    ["2026-08-05 15:00:00", "task_event", "作業予定を登録", "研磨・下地・塗装のブロックを作成。"],
  ],
  [
    ["2026-08-01 09:00:00", "note", "法人案件として受注", "有限会社豊後カスタムパーツ様より大口案件。"],
    ["2026-08-25 10:00:00", "work_log", "研磨作業を実施", "予定通り完了。"],
  ],
  [
    ["2026-07-01 10:00:00", "document_event", "請求書を発行", "I-2026-0001 を発行 (未入金)。"],
    ["2026-07-05 09:00:00", "email", "支払い期日のご案内メールを送付", "支払期限は7月末。"],
  ],
  [
    ["2026-06-01 10:00:00", "document_event", "請求書を発行", "I-2026-0002 を発行。"],
    ["2026-06-20 14:00:00", "note", "入金確認", "銀行振込にて全額入金を確認。"],
  ],
  [
    ["2026-07-10 10:00:00", "note", "見積り金額について相談", "予算オーバーとのこと。"],
    ["2026-07-15 11:00:00", "note", "失注として記録", "他社に依頼することになった。"],
  ],
];
deals.forEach((d, i) => {
  for (const [occurredAt, type, title, body] of activityScripts[i]) {
    addActivity(occurredAt, type, title, body, d.id, d.customer_id);
  }
});
p("");

// ---------------------------------------------------------------
// 8. tasks (10)
// ---------------------------------------------------------------
p("-- ===== tasks =====");
const tasks = [
  { title: "田中様へ折り返し電話", due: "2026-09-01", status: "open", dealId: deals[0].id, customerId: customers[0].id },
  { title: "見積り金額の再確認", due: "2026-09-03", status: "open", dealId: deals[1].id, customerId: customers[1].id },
  { title: "本日中に見積書を送付", due: "2026-09-06", status: "open", dealId: deals[2].id, customerId: customers[2].id },
  { title: "作業予定の最終確認", due: "2026-09-06", status: "open", dealId: deals[4].id, customerId: customers[5].id },
  { title: "塗料の在庫を確認", due: "2026-08-31", status: "open", dealId: null, customerId: null },
  { title: "小林様へ進捗連絡", due: "2026-09-02", status: "open", dealId: deals[3].id, customerId: customers[3].id },
  { title: "請求書の宛先を確認", due: "2026-09-04", status: "open", dealId: deals[5].id, customerId: customers[6].id },
  { title: "来週の作業割り当てを検討", due: "2026-09-10", status: "open", dealId: null, customerId: null },
  { title: "松本様への納品連絡", due: "2026-08-20", status: "done", dealId: deals[4].id, customerId: customers[5].id, completedAt: "2026-08-21 10:00:00" },
  { title: "入金確認メールの送付", due: "2026-06-21", status: "done", dealId: deals[6].id, customerId: customers[0].id, completedAt: "2026-06-21 09:00:00" },
];
for (const t of tasks) {
  p(
    `insert into tasks (id, title, due_on, status, origin, deal_id, customer_id, completed_at) values (${sqlStr(uuid())}, ${sqlStr(t.title)}, ${sqlStr(t.due)}, ${sqlStr(t.status)}, 'manual', ${sqlStr(t.dealId)}, ${sqlStr(t.customerId)}, ${t.completedAt ? ts(t.completedAt) : "null"});`,
  );
}
p("");

// ---------------------------------------------------------------
// 9. documents / document_lines / issued_documents / payments / document_sequences
// ---------------------------------------------------------------
p("-- ===== documents =====");

function taxTotals(lines) {
  // lines: [{quantity, unit_price_jpy, tax_category}]
  let subtotal = 0;
  const byCat = new Map();
  for (const l of lines) {
    const amount = Math.round(l.quantity * l.unit_price_jpy);
    l.amount_jpy = amount;
    subtotal += amount;
    byCat.set(l.tax_category, (byCat.get(l.tax_category) ?? 0) + amount);
  }
  const tax_summary = [];
  let total = subtotal;
  for (const [cat, taxable] of byCat) {
    const rate = cat === "standard_10" ? 0.1 : cat === "reduced_8" ? 0.08 : 0;
    const tax = Math.floor(taxable * rate);
    tax_summary.push({ tax_category: cat, taxable_jpy: taxable, tax_jpy: tax });
    total += tax;
  }
  return { subtotal_jpy: subtotal, tax_summary, total_jpy: total };
}

const issuerSnapshot = {
  issuer_name: invoiceIssuerValue.issuer_name,
  registration_number: invoiceIssuerValue.registration_number,
  address: companyValue.address,
  tel: companyValue.tel,
  email: companyValue.email,
  seal_storage_path: null,
  bank_account: invoiceIssuerValue.bank_account,
  transfer_fee_note: invoiceIssuerValue.transfer_fee_note,
};

function insertDocument(doc) {
  p(
    `insert into documents (id, doc_type, status, deal_id, doc_no, current_version, issue_date, transaction_date, valid_until, billing_name, billing_suffix, billing_address, site_name, site_address, notes, tax_rounding, subtotal_jpy, tax_summary, total_jpy, issuer_snapshot, issued_at, paid_at) values (${sqlStr(doc.id)}, ${sqlStr(doc.doc_type)}, ${sqlStr(doc.status)}, ${sqlStr(doc.deal_id)}, ${sqlStr(doc.doc_no)}, ${doc.current_version}, ${sqlStr(doc.issue_date)}, ${sqlStr(doc.transaction_date)}, ${sqlStr(doc.valid_until)}, ${sqlStr(doc.billing_name)}, ${sqlStr(doc.billing_suffix)}, ${sqlStr(doc.billing_address)}, ${sqlStr(doc.site_name)}, ${sqlStr(doc.site_address)}, ${sqlStr(doc.notes)}, ${sqlStr(doc.tax_rounding)}, ${doc.subtotal_jpy}, ${sqlJson(doc.tax_summary)}, ${doc.total_jpy}, ${doc.issuer_snapshot ? sqlJson(doc.issuer_snapshot) : "null"}, ${doc.issued_at ? ts(doc.issued_at) : "null"}, ${doc.paid_at ? ts(doc.paid_at) : "null"});`,
  );
}
function insertLines(documentId, lines) {
  lines.forEach((l, idx) => {
    p(
      `insert into document_lines (id, document_id, position, description, quantity, unit, unit_price_jpy, amount_jpy, tax_category, work_type_key) values (${sqlStr(uuid())}, ${sqlStr(documentId)}, ${idx}, ${sqlStr(l.description)}, ${l.quantity}, ${sqlStr(l.unit)}, ${l.unit_price_jpy}, ${l.amount_jpy}, ${sqlStr(l.tax_category)}, ${sqlStr(l.work_type_key ?? null)});`,
    );
  });
}
function insertIssuedDocument(doc, version, snapshotLines, storageSuffix) {
  const idxHex = uuid().replace(/-/g, "").slice(0, 8);
  const sha256 = uuid().replace(/-/g, "") + uuid().replace(/-/g, "")[0].repeat(0) + "0".repeat(64 - 64); // placeholder below
  const fakeSha = Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  const storagePath = `documents/${doc.id}/v${version}-${idxHex}.pdf`;
  const snapshot = {
    doc_type: doc.doc_type,
    doc_no: doc.doc_no,
    version,
    issue_date: doc.issue_date,
    transaction_date: doc.transaction_date,
    valid_until: doc.valid_until,
    billing_name: doc.billing_name,
    billing_suffix: doc.billing_suffix,
    billing_address: doc.billing_address,
    site_name: doc.site_name,
    site_address: doc.site_address,
    notes: doc.notes,
    tax_rounding: doc.tax_rounding,
    issuer: issuerSnapshot,
    lines: snapshotLines.map((l, idx) => ({
      position: idx,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unit_price_jpy: l.unit_price_jpy,
      amount_jpy: l.amount_jpy,
      tax_category: l.tax_category,
    })),
    subtotal_jpy: doc.subtotal_jpy,
    tax_summary: doc.tax_summary,
    total_jpy: doc.total_jpy,
  };
  p(
    `insert into issued_documents (id, document_id, doc_no, doc_type, version, sha256, transaction_date, counterparty, total_jpy, storage_path, content_snapshot, issued_at) values (${sqlStr(uuid())}, ${sqlStr(doc.id)}, ${sqlStr(doc.doc_no)}, ${sqlStr(doc.doc_type)}, ${version}, ${sqlStr(fakeSha)}, ${sqlStr(doc.transaction_date)}, ${sqlStr(doc.billing_name)}, ${doc.total_jpy}, ${sqlStr(storagePath)}, ${sqlJson(snapshot)}, ${ts(doc.issued_at)});`,
  );
}

// (a) quote draft — deals[1] (見積中)
{
  const lines = [
    { description: "小物フィギュア 研磨・塗装一式", quantity: 1, unit_price_jpy: 28000, unit: "式", tax_category: "standard_10" },
  ];
  const totals = taxTotals(lines);
  const doc = {
    id: uuid(), doc_type: "quote", status: "draft", deal_id: deals[1].id, doc_no: null, current_version: 0,
    issue_date: null, transaction_date: null, valid_until: null,
    billing_name: customers[1].name, billing_suffix: "様", billing_address: customers[1].address,
    site_name: null, site_address: null, notes: "ご確認のうえご連絡ください。",
    tax_rounding: "floor", ...totals, issuer_snapshot: null, issued_at: null, paid_at: null,
  };
  insertDocument(doc);
  insertLines(doc.id, lines);
}

// (b) quote issued (未承諾) — deals[2] (見積送付)
let quoteIssuedId;
{
  const lines = [
    { description: "自動車パーツ 研磨・下地・塗装一式", quantity: 1, unit_price_jpy: 40000, unit: "式", tax_category: "standard_10" },
    { description: "特急仕上げ対応", quantity: 1, unit_price_jpy: 5000, unit: "式", tax_category: "standard_10" },
  ];
  const totals = taxTotals(lines);
  quoteIssuedId = uuid();
  const doc = {
    id: quoteIssuedId, doc_type: "quote", status: "issued", deal_id: deals[2].id, doc_no: "Q-2026-0001", current_version: 1,
    issue_date: "2026-08-15", transaction_date: "2026-08-15", valid_until: "2026-09-14",
    billing_name: customers[2].name, billing_suffix: "様", billing_address: customers[2].address,
    site_name: null, site_address: null, notes: null,
    tax_rounding: "floor", ...totals, issuer_snapshot: issuerSnapshot, issued_at: "2026-08-15 10:00:00", paid_at: null,
  };
  insertDocument(doc);
  insertLines(doc.id, lines);
  insertIssuedDocument(doc, 1, lines);
}

// (c) quote issued + accepted — deals[3] (受注)
{
  const lines = [
    { description: "自動車パーツ塗装 (自動車グレード仕上げ)", quantity: 1, unit_price_jpy: 100000, unit: "式", tax_category: "standard_10" },
    { description: "梱包・配送費", quantity: 1, unit_price_jpy: 9091, unit: "式", tax_category: "standard_10" },
  ];
  const totals = taxTotals(lines);
  const doc = {
    id: uuid(), doc_type: "quote", status: "accepted", deal_id: deals[3].id, doc_no: "Q-2026-0002", current_version: 1,
    issue_date: "2026-07-25", transaction_date: "2026-07-25", valid_until: "2026-08-24",
    billing_name: customers[3].name, billing_suffix: "様", billing_address: customers[3].address,
    site_name: null, site_address: null, notes: null,
    tax_rounding: "floor", ...totals, issuer_snapshot: issuerSnapshot, issued_at: "2026-07-25 10:00:00", paid_at: null,
  };
  insertDocument(doc);
  insertLines(doc.id, lines);
  insertIssuedDocument(doc, 1, lines);
}

// (d) invoice issued (未入金) — deals[5] (請求)
{
  const lines = [
    { description: "法人向け塗装一式 (来縄モデリング様)", quantity: 1, unit_price_jpy: 89091, unit: "式", tax_category: "standard_10" },
  ];
  const totals = taxTotals(lines);
  const doc = {
    id: uuid(), doc_type: "invoice", status: "issued", deal_id: deals[5].id, doc_no: "I-2026-0001", current_version: 1,
    issue_date: "2026-07-01", transaction_date: "2026-06-28", valid_until: null,
    billing_name: companies[1].name, billing_suffix: "御中", billing_address: companies[1].address,
    site_name: "来縄モデリング様 工場", site_address: companies[1].address, notes: "お振込みは月末までにお願いします。",
    tax_rounding: "floor", ...totals, issuer_snapshot: issuerSnapshot, issued_at: "2026-07-01 10:00:00", paid_at: null,
  };
  insertDocument(doc);
  insertLines(doc.id, lines);
  insertIssuedDocument(doc, 1, lines);
}

// (e) invoice paid (入金済み、payments 1件) — deals[6] (入金済み)
{
  const lines = [
    { description: "フィギュア塗装 追加ご依頼分", quantity: 1, unit_price_jpy: 29091, unit: "式", tax_category: "standard_10" },
  ];
  const totals = taxTotals(lines);
  const doc = {
    id: uuid(), doc_type: "invoice", status: "paid", deal_id: deals[6].id, doc_no: "I-2026-0002", current_version: 1,
    issue_date: "2026-06-01", transaction_date: "2026-05-30", valid_until: null,
    billing_name: customers[0].name, billing_suffix: "様", billing_address: customers[0].address,
    site_name: null, site_address: null, notes: null,
    tax_rounding: "floor", ...totals, issuer_snapshot: issuerSnapshot, issued_at: "2026-06-01 10:00:00", paid_at: "2026-06-20 14:00:00",
  };
  insertDocument(doc);
  insertLines(doc.id, lines);
  insertIssuedDocument(doc, 1, lines);
  p(
    `insert into payments (id, document_id, paid_on, amount_jpy, method, memo) values (${sqlStr(uuid())}, ${sqlStr(doc.id)}, '2026-06-20', ${doc.total_jpy}, 'bank_transfer', '銀行振込にて確認');`,
  );
}

// document_sequences のバックフィル (今後の発行採番が衝突しないように)
p("insert into document_sequences (doc_type, fiscal_year, last_seq) values ('quote', 2026, 2) on conflict (doc_type, fiscal_year) do update set last_seq = greatest(document_sequences.last_seq, excluded.last_seq);");
p("insert into document_sequences (doc_type, fiscal_year, last_seq) values ('invoice', 2026, 2) on conflict (doc_type, fiscal_year) do update set last_seq = greatest(document_sequences.last_seq, excluded.last_seq);");
p("");

// ---------------------------------------------------------------
// 10. work_blocks (10) — 今週〜来週
// ---------------------------------------------------------------
p("-- ===== work_blocks =====");
function block(dealId, workType, title, startAt, endAt, status, plannedHours, actualHours, performedOn) {
  p(
    `insert into work_blocks (id, deal_id, work_type_id, title, status, starts_at, ends_at, planned_hours, actual_hours, performed_on, consumes_capacity) values (${sqlStr(uuid())}, ${sqlStr(dealId)}, ${sqlStr(workType.id)}, ${sqlStr(title)}, ${sqlStr(status)}, ${startAt ? ts(startAt) : "null"}, ${endAt ? ts(endAt) : "null"}, ${plannedHours}, ${actualHours ?? "null"}, ${performedOn ? sqlStr(performedOn) : "null"}, ${sqlBool(workType.consumes)});`,
  );
}
const [wtSanding, wtPrimer, wtPainting, wtDrying, wtInspection] = workTypes;
block(deals[4].id, wtSanding, "研磨作業", "2026-09-01 09:00:00", "2026-09-01 11:00:00", "done", 2, 2, "2026-09-01");
block(deals[4].id, wtPrimer, "下地作業", "2026-09-02 09:00:00", "2026-09-02 10:30:00", "done", 1.5, 1.5, "2026-09-02");
block(deals[4].id, wtPainting, "本塗装", "2026-09-08 09:00:00", "2026-09-08 12:00:00", "scheduled", 3, null, null);
block(deals[4].id, wtDrying, "乾燥", "2026-09-08 12:00:00", "2026-09-09 00:00:00", "scheduled", 12, null, null);
block(deals[4].id, wtInspection, "検品", "2026-09-09 09:00:00", "2026-09-09 09:30:00", "scheduled", 0.5, null, null);
block(deals[3].id, wtSanding, "研磨作業", "2026-09-07 13:00:00", "2026-09-07 15:00:00", "scheduled", 2, null, null);
block(deals[3].id, wtPainting, "本塗装", "2026-09-10 09:00:00", "2026-09-10 12:00:00", "scheduled", 3, null, null);
block(deals[2].id, wtSanding, "研磨作業", "2026-09-06 09:00:00", "2026-09-06 10:00:00", "in_progress", 1, null, null);
block(deals[1].id, wtPainting, "本塗装 (見積確定後)", null, null, "backlog", 3, null, null);
block(null, wtInspection, "月次の道具点検", "2026-09-12 09:00:00", "2026-09-12 10:00:00", "scheduled", 1, null, null);
p("");

// ---------------------------------------------------------------
// 11. calls (5) + call_recordings + call_jobs
// ---------------------------------------------------------------
p("-- ===== calls =====");
const calls = [
  {
    id: uuid(), call_sid: "CAdemo0000000000000000000000001", from: "+819000000101", handling: "forwarded",
    match_status: "matched", customer_id: customers[0].id, duration: 185, started: "2026-09-04 10:00:00",
  },
  {
    id: uuid(), call_sid: "CAdemo0000000000000000000000002", from: "+819000000109", handling: "voicemail",
    match_status: "created", customer_id: null, duration: 42, started: "2026-09-04 19:30:00",
  },
  {
    id: uuid(), call_sid: "CAdemo0000000000000000000000003", from: null, handling: "missed",
    match_status: "no_number", customer_id: null, duration: null, started: "2026-09-05 12:00:00",
  },
  {
    id: uuid(), call_sid: "CAdemo0000000000000000000000004", from: "+819000000110", handling: "voicemail",
    match_status: "ambiguous", customer_id: null, duration: 65, started: "2026-09-05 20:10:00",
  },
  {
    id: uuid(), call_sid: "CAdemo0000000000000000000000005", from: "+819000000103", handling: "forwarded",
    match_status: "manual", customer_id: customers[2].id, duration: 210, started: "2026-09-06 09:15:00",
  },
];
for (const c of calls) {
  p(
    `insert into calls (id, call_sid, direction, from_e164, from_raw, to_e164, twilio_status, handling, match_status, customer_id, duration_seconds, started_at, ended_at) values (${sqlStr(c.id)}, ${sqlStr(c.call_sid)}, 'inbound', ${sqlStr(c.from)}, ${sqlStr(c.from ?? "anonymous")}, '+815000000000', 'completed', ${sqlStr(c.handling)}, ${sqlStr(c.match_status)}, ${sqlStr(c.customer_id)}, ${sqlNum(c.duration)}, ${ts(c.started)}, ${c.duration ? ts(c.started) : "null"});`,
  );
}
// call_recordings + call_jobs for calls[0] (done) と calls[1] (処理中)
{
  const rec1 = uuid();
  p(
    `insert into call_recordings (id, call_id, recording_sid, source, twilio_url, storage_path, duration_seconds, channels) values (${sqlStr(rec1)}, ${sqlStr(calls[0].id)}, 'RCdemo00000000000000000000001', 'dial', 'https://api.twilio.example.com/demo/recordings/RCdemo1', ${sqlStr(`call-audio/${calls[0].id}.wav`)}, 185, 2);`,
  );
  const transcript = {
    segments: [
      { channel: 0, index: 0, text: "お世話になっております、田中です。フィギュアの塗装をお願いしたいのですが。" },
      { channel: 1, index: 1, text: "ありがとうございます。お色のご希望はございますか。" },
      { channel: 0, index: 2, text: "メタリックレッドでお願いします。" },
    ],
    full_text: "お世話になっております、田中です。フィギュアの塗装をお願いしたいのですが。ありがとうございます。お色のご希望はございますか。メタリックレッドでお願いします。",
  };
  const analysis = {
    minutes: {
      summary: "田中様よりフィギュア塗装の依頼。色はメタリックレッド希望。",
      caller_intent: "order",
      key_points: ["色はメタリックレッド希望", "納期は来月上旬希望"],
      customer_name_guess: "田中",
      callback_required: false,
      callback_note: null,
    },
    tasks: [{ title: "田中様へ見積り送付", detail: "メタリックレッド塗装の見積り", due_hint: "今週中" }],
  };
  p(
    `insert into call_jobs (id, call_id, recording_id, status, transcript, analysis) values (${sqlStr(uuid())}, ${sqlStr(calls[0].id)}, ${sqlStr(rec1)}, 'done', ${sqlJson(transcript)}, ${sqlJson(analysis)});`,
  );

  const rec2 = uuid();
  p(
    `insert into call_recordings (id, call_id, recording_sid, source, twilio_url, storage_path, duration_seconds, channels) values (${sqlStr(rec2)}, ${sqlStr(calls[1].id)}, 'RCdemo00000000000000000000002', 'voicemail', 'https://api.twilio.example.com/demo/recordings/RCdemo2', ${sqlStr(`call-audio/${calls[1].id}.wav`)}, 42, 1);`,
  );
  p(
    `insert into call_jobs (id, call_id, recording_id, status) values (${sqlStr(uuid())}, ${sqlStr(calls[1].id)}, ${sqlStr(rec2)}, 'transcribing');`,
  );
}
p("");

// ---------------------------------------------------------------
// 12. contact_inquiries (6)
// ---------------------------------------------------------------
p("-- ===== contact_inquiries =====");
const inquiries = [
  { name: "山田 太郎", email: "yamada.demo1@example.com", tel: "090-0000-0011", inquiry_type: "見積り依頼", item: "小物フィギュア", body: "塗装をお願いしたいです。", status: "new" },
  { name: "鈴木 一美", email: "suzuki.demo2@example.com", tel: null, inquiry_type: "見積り依頼", item: "自動車パーツ", body: "納期の相談をしたいです。", status: "new" },
  { name: "高橋 誠", email: "takahashi.demo3@example.com", tel: "090-0000-0033", inquiry_type: "その他", item: null, body: "取材のご相談です。", status: "new" },
  { name: "伊藤 舞", email: "ito.demo4@example.com", tel: "090-0000-0044", inquiry_type: "見積り依頼", item: "フィギュア", body: "追加で質問があります。", status: "in_progress" },
  { name: "渡辺 学", email: "watanabe.demo5b@example.com", tel: null, inquiry_type: "見積り依頼", item: "自動車パーツ", body: "写真を送りますのでご確認ください。", status: "in_progress" },
  { name: "中島 恵子", email: "nakajima.demo6@example.com", tel: "090-0000-0066", inquiry_type: "その他", item: null, body: "対応ありがとうございました。", status: "done" },
];
for (const i of inquiries) {
  p(
    `insert into contact_inquiries (id, name, email, tel, inquiry_type, item, body, status, handled_at) values (${sqlStr(uuid())}, ${sqlStr(i.name)}, ${sqlStr(i.email)}, ${sqlStr(i.tel)}, ${sqlStr(i.inquiry_type)}, ${sqlStr(i.item)}, ${sqlStr(i.body)}, ${sqlStr(i.status)}, ${i.status === "done" ? ts("2026-09-01 10:00:00") : "null"});`,
  );
}
p("");

// ---------------------------------------------------------------
// 13. posts (4) / works (3) / voices (3)
// ---------------------------------------------------------------
p("-- ===== posts =====");
const posts = [
  { slug: "demo-post-blog-1", kind: "blog", title: "積層痕を消す研磨のコツ", excerpt: "研磨のポイントを紹介します。", body: "本文サンプルです。", status: "published", published_at: "2026-08-01 09:00:00" },
  { slug: "demo-post-news-1", kind: "news", title: "夏季休業のお知らせ", excerpt: "夏季休業期間のご案内です。", body: "本文サンプルです。", status: "published", published_at: "2026-07-20 09:00:00" },
  { slug: "demo-post-reading-1", kind: "reading", title: "塗装の基礎知識", excerpt: "初めての方向けの解説です。", body: "本文サンプルです。", status: "review", published_at: null },
  { slug: "demo-post-blog-2", kind: "blog", title: "自動車グレード塗装とは", excerpt: "下書き中の記事です。", body: "本文サンプルです。", status: "draft", published_at: null },
];
for (const p2 of posts) {
  p(
    `insert into posts (id, slug, kind, title, excerpt, body, status, published_at) values (${sqlStr(uuid())}, ${sqlStr(p2.slug)}, ${sqlStr(p2.kind)}, ${sqlStr(p2.title)}, ${sqlStr(p2.excerpt)}, ${sqlStr(p2.body)}, ${sqlStr(p2.status)}, ${p2.published_at ? ts(p2.published_at) : "null"}) on conflict (slug) do nothing;`,
  );
}
p("");
p("-- ===== works =====");
const works = [
  { slug: "demo-work-1", title: "フィギュア メタリックレッド仕上げ", category: "figure", body: "施工事例サンプルです。", process_note: "研磨→下地→塗装→乾燥→検品", status: "published", published_at: "2026-08-05 09:00:00" },
  { slug: "demo-work-2", title: "自動車パーツ 自動車グレード仕上げ", category: "vehicle", body: "施工事例サンプルです。", process_note: "研磨→下地→塗装→乾燥→検品", status: "published", published_at: "2026-07-10 09:00:00" },
  { slug: "demo-work-3", title: "小物パーツ 艶消し仕上げ", category: "small-item", body: "施工事例サンプルです。", process_note: "研磨→塗装", status: "draft", published_at: null },
];
for (const w of works) {
  p(
    `insert into works (id, slug, title, category, body, process_note, status, published_at) values (${sqlStr(uuid())}, ${sqlStr(w.slug)}, ${sqlStr(w.title)}, ${sqlStr(w.category)}, ${sqlStr(w.body)}, ${sqlStr(w.process_note)}, ${sqlStr(w.status)}, ${w.published_at ? ts(w.published_at) : "null"}) on conflict (slug) do nothing;`,
  );
}
p("");
p("-- ===== voices =====");
const voices = [
  { initial: "T.I", region: "大分県", rating: 5, body: "とても丁寧な仕上がりで満足しています。", item: "フィギュア", status: "published", published_at: "2026-08-10 09:00:00" },
  { initial: "K.S", region: "福岡県", rating: 4, body: "納期も予定通りで安心できました。", item: "自動車パーツ", status: "published", published_at: "2026-07-15 09:00:00" },
  { initial: "M.Y", region: "熊本県", rating: 5, body: "相談しやすく良かったです。", item: "小物パーツ", status: "draft", published_at: null },
];
for (const v of voices) {
  p(
    `insert into voices (id, customer_initial, region, rating, body, item, status, published_at) values (${sqlStr(uuid())}, ${sqlStr(v.initial)}, ${sqlStr(v.region)}, ${v.rating}, ${sqlStr(v.body)}, ${sqlStr(v.item)}, ${sqlStr(v.status)}, ${v.published_at ? ts(v.published_at) : "null"});`,
  );
}
p("");

// ---------------------------------------------------------------
// 14. ai_usage_log (AI 利用料金ページのグラフ用)
// ---------------------------------------------------------------
p("-- ===== ai_usage_log =====");
const usageDays = ["2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22", "2026-08-29", "2026-09-05"];
for (const [i, day] of usageDays.entries()) {
  p(
    `insert into ai_usage_log (id, provider, model, kind, feature, input_tokens, output_tokens, cost_micro_usd, status, created_at) values (${sqlStr(uuid())}, 'anthropic', 'claude-demo-model', 'text', 'studio', ${1000 + i * 200}, ${400 + i * 80}, ${500000 + i * 150000}, 'ok', ${ts(day + " 09:00:00")});`,
  );
}
p(
  `insert into ai_usage_log (id, provider, model, kind, feature, image_count, cost_micro_usd, status, created_at) values (${sqlStr(uuid())}, 'anthropic', 'demo-image-model', 'image', 'sns-image', 4, 800000, 'ok', ${ts("2026-09-05 10:00:00")});`,
);
p("");

p("commit;");

console.log(out.join("\n"));

// entity IDs を別ファイルに書き出し (warmup / 報告用)
console.error(
  JSON.stringify(
    {
      companies: companies.map((c) => c.id),
      customers: customers.map((c) => c.id),
      deals: deals.map((d) => d.id),
      documents: "see stdout inserts",
      calls: calls.map((c) => c.id),
    },
    null,
    2,
  ),
);
