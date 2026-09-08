/**
 * contact フォームの「送信最小時間」判定に使う formRenderedAt の組み立て (純関数)。
 *
 * 背景 (本番不具合): 以前はクライアントの `Date.now()` をそのまま formRenderedAt として
 * 送っていた。サーバー側は `submittedAt(サーバの Date.now()) - formRenderedAt` を 3000ms と
 * 比較するため、利用者の PC の時計が数秒進んでいるだけで差分が 3000ms 未満 (時に負値) に
 * なり、十分な時間をかけて入力した正当な問い合わせが stealth discard されていた
 * (画面には成功表示が出るのに DB には残らない)。
 *
 * 対策: サーバー (page.tsx) が描画時に採った `serverRenderedAt` (epoch ms) をそのまま
 * 基準にする。これで formRenderedAt も submittedAt も同じサーバー時計の目盛りになり、
 * クライアント時計は判定に一切関与しなくなる。
 *
 * なぜ「serverRenderedAt + (performance.now() - mountPerf)」にしないのか:
 * その式は「送信した瞬間の時刻」を送ることになり、サーバー側の差分が実質ネットワーク
 * 往復時間だけになって、常に 3 秒未満 = 全件 discard になってしまう。監視すべきは
 * 「描画時刻」であり、経過時間の計測はサーバー側の submittedAt との差でのみ行う。
 * クライアントの単調時計 (performance.now) は、下記のとおり判定を「緩める」方向にしか
 * 使わない。
 *
 * キャッシュ (ISR / 静的化) で serverRenderedAt が古くなる場合は、経過時間が実際より長く
 * 見積もられる方向にしかずれない。つまり bot の早撃ちを取り逃がす可能性があるだけで、
 * 正当な利用者を黙って落とす誤判定は起きない (安全側)。
 */

/**
 * 送信時に Server Action へ渡す formRenderedAt (epoch ms、サーバー時計基準)。
 * クライアントの壁時計 (Date.now) は一切参照しない。
 */
export function buildFormRenderedAt(params: { serverRenderedAt: number }): number {
  const { serverRenderedAt } = params;
  if (!Number.isFinite(serverRenderedAt)) {
    // 想定外 (props 欠落等) は「十分昔」に倒し、正当な送信を落とさない側へフォールバックする。
    return 0;
  }
  return serverRenderedAt;
}
