import type { Result } from "@/modules/platform/contracts";

/**
 * WAV 解析・チャネル分離・時間分割 (canonical: docs/design/crm-suite/04-telephony.md §6.5.2 手順3、
 * §10-11/17、§3.2 定数表)。純 TS のみ (ffmpeg 不使用 — §1.3)。
 *
 * 処理の流れ (segmentCallRecording):
 *   1. RIFF/fmt チャンク解析 (audioFormat: 1=PCM16 / 7=μ-law のみ対応。他は KMB-E822)
 *   2. μ-law → PCM16 展開 (G.711 標準アルゴリズムから都度計算。256 エントリ LUT の手書き不要)
 *   3. stereo (numChannels=2) はサンプル単位でデインターリーブして ch0/ch1 の mono に分離
 *      (偶数インデックス=ch0/奇数=ch1 — 標準的なインターリーブ順。mono はそのまま 1 チャネル)
 *   4. SEGMENT_MAX_SECONDS (600 秒) 窓 + SEGMENT_OVERLAP_SECONDS (2 秒) オーバーラップで
 *      PCM フレーム (サンプル) 単位のスライス — バイト境界ではない
 *   5. 各セグメントを PCM16 mono WAV として再エンコード
 *   6. TRANSCRIBE_MAX_BYTES (25MB) 最終ガード (超過は KMB-E822。理論上到達しない防御)
 *
 * 例外は投げない — 不正 RIFF/未知フォーマット/上限超過はすべて Result のエラーで返す。
 */

// ---- internal 定数 (04-telephony.md §3.2 の配置規約: contracts.ts には置かない) ----
export const SEGMENT_MAX_SECONDS = 600;
export const SEGMENT_OVERLAP_SECONDS = 2;
export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;

export type AudioSegment = {
  channel: 0 | 1;
  index: number;
  wavBytes: Uint8Array;
};

const RIFF_HEADER_MIN_BYTES = 12; // "RIFF" + size(4) + "WAVE"
const CHUNK_HEADER_BYTES = 8; // id(4) + size(4)
const FMT_CHUNK_MIN_BYTES = 16; // audioFormat/numChannels/sampleRate/byteRate/blockAlign/bitsPerSample

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_MULAW = 7;
const OUTPUT_BITS_PER_SAMPLE = 16;
const OUTPUT_BYTES_PER_SAMPLE = 2;

type FmtChunk = {
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
};

type ParsedWav = {
  fmt: FmtChunk;
  dataOffset: number;
  dataLength: number;
};

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * RIFF/WAVE ヘッダを走査し fmt / data チャンクを見つける (§6.5.2 手順1)。
 * 不正な RIFF ヘッダ (マジック不一致・チャンク欠落・チャンクがバッファ長を超える) は
 * 例外を投げず KMB-E822 の Result エラーとして返す。
 */
function parseWavHeader(bytes: Uint8Array): Result<ParsedWav> {
  if (bytes.length < RIFF_HEADER_MIN_BYTES) {
    return { ok: false, code: "KMB-E822", detail: "不正なWAVファイルです (ヘッダが短すぎます)" };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffId = readAscii(bytes, 0, 4);
  const waveId = readAscii(bytes, 8, 4);
  if (riffId !== "RIFF" || waveId !== "WAVE") {
    return {
      ok: false,
      code: "KMB-E822",
      detail: `不正なWAVファイルです (RIFF/WAVEマジックが見つかりません: riff="${riffId}" wave="${waveId}")`,
    };
  }

  let offset = RIFF_HEADER_MIN_BYTES;
  let fmt: FmtChunk | null = null;
  let dataOffset: number | null = null;
  let dataLength: number | null = null;

  while (offset + CHUNK_HEADER_BYTES <= bytes.length && (fmt === null || dataOffset === null)) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataStart = offset + CHUNK_HEADER_BYTES;

    if (chunkId === "fmt ") {
      if (chunkDataStart + FMT_CHUNK_MIN_BYTES > bytes.length) {
        return { ok: false, code: "KMB-E822", detail: "不正なWAVファイルです (fmtチャンクが短すぎます)" };
      }
      fmt = {
        audioFormat: view.getUint16(chunkDataStart + 0, true),
        numChannels: view.getUint16(chunkDataStart + 2, true),
        sampleRate: view.getUint32(chunkDataStart + 4, true),
        bitsPerSample: view.getUint16(chunkDataStart + 14, true),
      };
    } else if (chunkId === "data") {
      dataOffset = chunkDataStart;
      dataLength = Math.max(0, Math.min(chunkSize, bytes.length - chunkDataStart));
    }

    // RIFF 規約: チャンクは偶数バイト境界へパディングされる
    const paddedSize = chunkSize + (chunkSize % 2);
    const nextOffset = chunkDataStart + paddedSize;
    if (nextOffset <= offset) {
      // 理論上到達しない防御 (chunkSize>=0 のため常に前進するはずだが、無限ループ化を防ぐ)
      return { ok: false, code: "KMB-E822", detail: "不正なWAVファイルです (チャンクサイズが不正です)" };
    }
    offset = nextOffset;
  }

  if (fmt === null) {
    return { ok: false, code: "KMB-E822", detail: "不正なWAVファイルです (fmtチャンクが見つかりません)" };
  }
  if (dataOffset === null || dataLength === null) {
    return { ok: false, code: "KMB-E822", detail: "不正なWAVファイルです (dataチャンクが見つかりません)" };
  }
  if (fmt.audioFormat !== WAVE_FORMAT_PCM && fmt.audioFormat !== WAVE_FORMAT_MULAW) {
    return {
      ok: false,
      code: "KMB-E822",
      detail: `未対応の音声フォーマットです (audioFormat=${fmt.audioFormat}。対応は 1=PCM16 / 7=μ-law のみ)`,
    };
  }
  if (fmt.numChannels !== 1 && fmt.numChannels !== 2) {
    return {
      ok: false,
      code: "KMB-E822",
      detail: `未対応のチャンネル数です (numChannels=${fmt.numChannels}。対応は mono/stereo のみ)`,
    };
  }
  if (fmt.sampleRate <= 0) {
    return { ok: false, code: "KMB-E822", detail: `不正なサンプルレートです (sampleRate=${fmt.sampleRate})` };
  }

  return { ok: true, value: { fmt, dataOffset, dataLength } };
}

/**
 * G.711 μ-law (8bit) → PCM16 (signed) の標準変換式 (ITU-T G.711 準拠の公開実装と同型)。
 * 256 エントリの LUT を手書きせず、標準アルゴリズムから都度計算する
 * (呼び出し回数はサンプル数のみ — 8kHz × 最大 10 分でも高々 480 万回で許容範囲)。
 */
function muLawByteToPcm16(muLawByte: number): number {
  const BIAS = 0x84;
  const inverted = ~muLawByte & 0xff;
  const sign = inverted & 0x80;
  const exponent = (inverted & 0x70) >> 4;
  const mantissa = inverted & 0x0f;
  let magnitude = ((mantissa << 3) + BIAS) << exponent;
  magnitude -= BIAS;
  return sign !== 0 ? -magnitude : magnitude;
}

/**
 * data チャンクの生バイト列を、フォーマットによらず「インターリーブされた PCM16 サンプル列」
 * (Int16Array) に統一する (§6.5.2 手順1-2)。PCM16 はそのまま読み替え、μ-law は 1 バイト =
 * 1 サンプルとして展開する。未対応フォーマット/ビット深度は KMB-E822。
 */
function decodeToInterleavedPcm16(dataBytes: Uint8Array, fmt: FmtChunk): Result<Int16Array> {
  if (fmt.audioFormat === WAVE_FORMAT_PCM) {
    if (fmt.bitsPerSample !== OUTPUT_BITS_PER_SAMPLE) {
      return {
        ok: false,
        code: "KMB-E822",
        detail: `未対応のビット深度です (PCM, bitsPerSample=${fmt.bitsPerSample}。対応は16bitのみ)`,
      };
    }
    const sampleCount = Math.floor(dataBytes.length / OUTPUT_BYTES_PER_SAMPLE);
    const view = new DataView(dataBytes.buffer, dataBytes.byteOffset, dataBytes.byteLength);
    const out = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      out[i] = view.getInt16(i * OUTPUT_BYTES_PER_SAMPLE, true);
    }
    return { ok: true, value: out };
  }

  if (fmt.audioFormat === WAVE_FORMAT_MULAW) {
    const sampleCount = dataBytes.length; // 1 byte = 1 sample (μ-law)
    const out = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      out[i] = muLawByteToPcm16(dataBytes[i]);
    }
    return { ok: true, value: out };
  }

  // parseWavHeader が既に audioFormat を 1/7 に絞っているため到達しない防御分岐。
  return { ok: false, code: "KMB-E822", detail: `未対応の音声フォーマットです (audioFormat=${fmt.audioFormat})` };
}

/**
 * インターリーブされた PCM16 サンプル列をチャネル別 (mono の場合は 1 本、stereo の場合は 2 本)
 * に分離する (§6.5.2 手順3。偶数インデックス=ch0/奇数=ch1 の標準的なインターリーブ順)。
 */
function deinterleaveChannels(interleaved: Int16Array, numChannels: 1 | 2): Int16Array[] {
  if (numChannels === 1) return [interleaved];

  const frameCount = Math.floor(interleaved.length / 2);
  const ch0 = new Int16Array(frameCount);
  const ch1 = new Int16Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    ch0[i] = interleaved[i * 2];
    ch1[i] = interleaved[i * 2 + 1];
  }
  return [ch0, ch1];
}

/**
 * 1 チャネル分の PCM16 サンプル列を SEGMENT_MAX_SECONDS 窓 + SEGMENT_OVERLAP_SECONDS
 * オーバーラップでスライスする (§6.5.2 手順3)。サンプル (フレーム) 単位のスライスであり、
 * バイト境界での分割は行わない。総サンプル数が 1 窓に収まる場合は無分割 1 セグメント。
 */
function sliceIntoSegments(samples: Int16Array, sampleRate: number): Int16Array[] {
  const windowSamples = SEGMENT_MAX_SECONDS * sampleRate;
  const overlapSamples = SEGMENT_OVERLAP_SECONDS * sampleRate;
  const stepSamples = windowSamples - overlapSamples;
  const total = samples.length;

  if (total <= windowSamples) {
    return [samples];
  }

  const segments: Int16Array[] = [];
  let start = 0;
  for (;;) {
    const end = Math.min(start + windowSamples, total);
    segments.push(samples.subarray(start, end));
    if (end >= total) break;
    start += stepSamples;
  }
  return segments;
}

/** PCM16 mono サンプル列を .wav バイト列 (44byte 標準ヘッダ + data) として再エンコードする。 */
function encodeWavPcm16Mono(samples: Int16Array, sampleRate: number): Uint8Array {
  const blockAlign = OUTPUT_BYTES_PER_SAMPLE; // mono
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * OUTPUT_BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt チャンクサイズ (拡張フィールドなし)
  view.setUint16(20, WAVE_FORMAT_PCM, true);
  view.setUint16(22, 1, true); // numChannels = mono (チャネルは既に分離済み)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, OUTPUT_BITS_PER_SAMPLE, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * OUTPUT_BYTES_PER_SAMPLE, samples[i], true);
  }

  return new Uint8Array(buffer);
}

/**
 * 録音 1 本分の WAV バイト列を、AI 転写に渡せるセグメント配列に分解する
 * (canonical: 04-telephony.md §6.5.2)。呼び出し元 (worker.ts の handleTranscribing) は
 * 返り値のセグメントを channel 昇順・index 昇順で直列に aiProvidersFacade.transcribe へ渡す。
 */
export function segmentCallRecording(wavBytes: Uint8Array): Result<AudioSegment[]> {
  const parsed = parseWavHeader(wavBytes);
  if (!parsed.ok) return parsed;
  const { fmt, dataOffset, dataLength } = parsed.value;

  const dataBytes = wavBytes.subarray(dataOffset, dataOffset + dataLength);
  const decoded = decodeToInterleavedPcm16(dataBytes, fmt);
  if (!decoded.ok) return decoded;

  const numChannels: 1 | 2 = fmt.numChannels === 2 ? 2 : 1;
  const channels = deinterleaveChannels(decoded.value, numChannels);

  const segments: AudioSegment[] = [];
  for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
    const sliced = sliceIntoSegments(channels[channelIndex], fmt.sampleRate);
    for (let segmentIndex = 0; segmentIndex < sliced.length; segmentIndex++) {
      const wavBytesOut = encodeWavPcm16Mono(sliced[segmentIndex], fmt.sampleRate);
      if (wavBytesOut.byteLength > TRANSCRIBE_MAX_BYTES) {
        // 理論上到達しない防御 (§6.5.2 手順3 末尾) — SEGMENT_MAX_SECONDS 窓の設計値では
        // 通常発生しないが、異常に高いサンプルレート等の入力に備えて明示的にガードする。
        return {
          ok: false,
          code: "KMB-E822",
          detail:
            `セグメントが上限を超えています (channel=${channelIndex}, index=${segmentIndex}, ` +
            `bytes=${wavBytesOut.byteLength}, limit=${TRANSCRIBE_MAX_BYTES})`,
        };
      }
      segments.push({
        channel: channelIndex === 1 ? 1 : 0,
        index: segmentIndex,
        wavBytes: wavBytesOut,
      });
    }
  }

  return { ok: true, value: segments };
}
