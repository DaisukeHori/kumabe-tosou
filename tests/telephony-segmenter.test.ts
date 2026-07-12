import { describe, expect, it } from "vitest";

import {
  SEGMENT_MAX_SECONDS,
  SEGMENT_OVERLAP_SECONDS,
  TRANSCRIBE_MAX_BYTES,
  segmentCallRecording,
} from "@/modules/telephony/internal/segmenter";

/**
 * internal/segmenter.ts の単体テスト (canonical: docs/design/crm-suite/04-telephony.md §6.5.2 手順3、
 * §10-11/17、§3.2 定数表)。issue-58 計画書 成果物3 の分岐網羅目標:
 * mono無分割 / stereoデインターリーブ (既知波形L/R検証) / μ-law LUT展開 /
 * 10分窓+2秒オーバーラップ境界フレーム / 25MB最終ガード (定数export+境界越えデータを直接生成) /
 * 未知audioFormatはE822 / 不正RIFFヘッダ。
 */

// ============================================================
// WAV バイト列組み立てヘルパ (テスト専用。segmenter.ts の実装とは独立に書く)
// ============================================================

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function buildWav(opts: {
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataBytes: Uint8Array;
}): Uint8Array {
  const { audioFormat, numChannels, sampleRate, bitsPerSample, dataBytes } = opts;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = dataBytes.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, audioFormat, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  bytes.set(dataBytes, 44);
  return bytes;
}

function pcm16DataBytes(samples: readonly number[]): Uint8Array {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  samples.forEach((s, i) => view.setInt16(i * 2, s, true));
  return new Uint8Array(buffer);
}

function interleave(left: readonly number[], right: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < left.length; i++) {
    out.push(left[i], right[i]);
  }
  return out;
}

function buildPcm16MonoWav(samples: readonly number[], sampleRate: number): Uint8Array {
  return buildWav({
    audioFormat: 1,
    numChannels: 1,
    sampleRate,
    bitsPerSample: 16,
    dataBytes: pcm16DataBytes(samples),
  });
}

function buildPcm16StereoWav(left: readonly number[], right: readonly number[], sampleRate: number): Uint8Array {
  return buildWav({
    audioFormat: 1,
    numChannels: 2,
    sampleRate,
    bitsPerSample: 16,
    dataBytes: pcm16DataBytes(interleave(left, right)),
  });
}

function buildMuLawMonoWav(bytes: readonly number[], sampleRate: number): Uint8Array {
  return buildWav({
    audioFormat: 7,
    numChannels: 1,
    sampleRate,
    bitsPerSample: 8,
    dataBytes: new Uint8Array(bytes),
  });
}

/** segmenter.ts の出力 (encodeWavPcm16Mono と同じ固定 44byte ヘッダ) から PCM16 サンプル列を読み戻す。 */
function readMonoPcm16Samples(wavBytes: Uint8Array): number[] {
  const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);
  const dataSize = view.getUint32(40, true);
  const count = dataSize / 2;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(view.getInt16(44 + i * 2, true));
  return out;
}

/**
 * G.711 μ-law → PCM16 の標準デコード式 (SoX / 各種公開実装で広く使われる参照式。実装ファイル
 * segmenter.ts の muLawByteToPcm16 とは独立に書き起こした「既知の正しい値」参照実装)。
 */
function referenceMuLawToPcm16(byte: number): number {
  const BIAS = 0x84;
  const inverted = ~byte & 0xff;
  let t = ((inverted & 0x0f) << 3) + BIAS;
  t <<= (inverted & 0x70) >> 4;
  return (inverted & 0x80) !== 0 ? BIAS - t : t - BIAS;
}

// ============================================================
// テスト本体
// ============================================================

describe("segmentCallRecording: mono (§6.5.2 手順3)", () => {
  it("mono・窓に収まる長さは無分割で1セグメントを返す (channel=0, index=0)", () => {
    const samples = [0, 100, -100, 32767, -32768, 42];
    const wav = buildPcm16MonoWav(samples, 8000);

    const result = segmentCallRecording(wav);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({ channel: 0, index: 0 });
    expect(readMonoPcm16Samples(result.value[0].wavBytes)).toEqual(samples);
  });
});

describe("segmentCallRecording: stereo デインターリーブ (既知波形 L/R 検証、§6.5.2 手順3)", () => {
  it("stereo は ch0 (発信者=L) / ch1 (こちら=R) に正しく分離される (偶数=ch0/奇数=ch1 の標準インターリーブ順)", () => {
    const left = [1000, 2000, 3000, 4000, 5000];
    const right = [-1000, -2000, -3000, -4000, -5000];
    const wav = buildPcm16StereoWav(left, right, 8000);

    const result = segmentCallRecording(wav);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);

    const ch0 = result.value.find((s) => s.channel === 0);
    const ch1 = result.value.find((s) => s.channel === 1);
    expect(ch0).toBeDefined();
    expect(ch1).toBeDefined();
    expect(ch0?.index).toBe(0);
    expect(ch1?.index).toBe(0);
    expect(readMonoPcm16Samples(ch0!.wavBytes)).toEqual(left);
    expect(readMonoPcm16Samples(ch1!.wavBytes)).toEqual(right);
  });
});

describe("segmentCallRecording: μ-law → PCM16 展開 (256エントリLUT相当、§6.5.2 手順1-2)", () => {
  it("既知の正の無音値 (0xFF) は 0 に展開される (ITU-T G.711 / RFC 3551 で広く知られる μ-law 正の無音値)", () => {
    const wav = buildMuLawMonoWav([0xff], 8000);
    const result = segmentCallRecording(wav);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readMonoPcm16Samples(result.value[0].wavBytes)).toEqual([0]);
  });

  it("代表的なバイト値の集合が標準デコード式 (参照実装) と一致する", () => {
    const testBytes = [0x00, 0x0f, 0x3f, 0x7f, 0x80, 0xa5, 0xc0, 0xe1, 0xff];
    const wav = buildMuLawMonoWav(testBytes, 8000);

    const result = segmentCallRecording(wav);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const decoded = readMonoPcm16Samples(result.value[0].wavBytes);
    expect(decoded).toEqual(testBytes.map(referenceMuLawToPcm16));
  });

  it("全256バイト値が例外なく妥当な PCM16 範囲内の値に展開される (LUT の網羅性)", () => {
    const allBytes = Array.from({ length: 256 }, (_, i) => i);
    const wav = buildMuLawMonoWav(allBytes, 8000);

    const result = segmentCallRecording(wav);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const decoded = readMonoPcm16Samples(result.value[0].wavBytes);
    expect(decoded).toHaveLength(256);
    for (const v of decoded) {
      expect(v).toBeGreaterThanOrEqual(-32768);
      expect(v).toBeLessThanOrEqual(32767);
    }
    expect(decoded).toEqual(allBytes.map(referenceMuLawToPcm16));
  });
});

describe("segmentCallRecording: 10分窓 + 2秒オーバーラップの境界フレーム (§6.5.2 手順3、サンプル単位スライス)", () => {
  it("窓を超える長さは (窓-オーバーラップ) 刻みでスライスされ、隣接セグメントがオーバーラップ分だけ重複する", () => {
    // 小さい sampleRate で窓サイズを実用的な件数に縮小しつつ、実際に export された定数
    // (SEGMENT_MAX_SECONDS/SEGMENT_OVERLAP_SECONDS) から窓/オーバーラップのサンプル数を導出する
    // (定数値そのものをテストに埋め込まない — 定数が変わってもテストの意図は保たれる)。
    const sampleRate = 10;
    const windowSamples = SEGMENT_MAX_SECONDS * sampleRate;
    const overlapSamples = SEGMENT_OVERLAP_SECONDS * sampleRate;
    const stepSamples = windowSamples - overlapSamples;

    // 窓ちょうど+1サンプルだけ超過させ、ちょうど2セグメントになる最小構成にする。
    const totalSamples = windowSamples + 1;
    const samples = Array.from({ length: totalSamples }, (_, i) => i % 30000); // int16 範囲内の既知パターン
    const wav = buildPcm16MonoWav(samples, sampleRate);

    const result = segmentCallRecording(wav);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toMatchObject({ channel: 0, index: 0 });
    expect(result.value[1]).toMatchObject({ channel: 0, index: 1 });

    const seg0 = readMonoPcm16Samples(result.value[0].wavBytes);
    const seg1 = readMonoPcm16Samples(result.value[1].wavBytes);

    expect(seg0).toHaveLength(windowSamples);
    expect(seg0).toEqual(samples.slice(0, windowSamples));

    expect(seg1).toHaveLength(totalSamples - stepSamples);
    expect(seg1).toEqual(samples.slice(stepSamples));

    // オーバーラップ検証: seg0 の末尾 overlapSamples 件と seg1 の先頭 overlapSamples 件が一致する。
    expect(seg0.slice(seg0.length - overlapSamples)).toEqual(seg1.slice(0, overlapSamples));
  });

  it("窓ちょうどの長さは無分割 (境界の off-by-one 確認: total===window は分割しない)", () => {
    const sampleRate = 10;
    const windowSamples = SEGMENT_MAX_SECONDS * sampleRate;
    const samples = Array.from({ length: windowSamples }, (_, i) => i % 1000);
    const wav = buildPcm16MonoWav(samples, sampleRate);

    const result = segmentCallRecording(wav);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(readMonoPcm16Samples(result.value[0].wavBytes)).toHaveLength(windowSamples);
  });
});

describe("segmentCallRecording: 25MB 最終ガード (§6.5.2 手順3末尾、理論上到達しない防御 — 定数exportして境界越えデータを直接生成)", () => {
  it("再エンコード後のセグメントが TRANSCRIBE_MAX_BYTES を超えると KMB-E822 を返す", () => {
    // 1 セグメントに収まる (=分割されない) sampleRate を選びつつ、そのセグメントの再エンコード後
    // バイト数 (44 + samples*2) が TRANSCRIBE_MAX_BYTES を超えるサンプル数を直接生成する。
    // 音声内容は無音 (全0) で十分 — ガードはサイズのみで判定されるため。
    const sampleRate = 24_000;
    const windowSamples = SEGMENT_MAX_SECONDS * sampleRate; // 14,400,000 — 単一セグメントに収まる上限
    const totalSamples = Math.floor(TRANSCRIBE_MAX_BYTES / 2) + 1_000; // 再エンコード後に必ず閾値超過
    expect(totalSamples).toBeLessThan(windowSamples); // 前提: 分割されず単一セグメントになること

    const dataSize = totalSamples * 2;
    const buffer = new ArrayBuffer(44 + dataSize); // ArrayBuffer は 0 初期化済み (= 無音データ)
    const view = new DataView(buffer);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataSize, true);
    const wav = new Uint8Array(buffer);

    const result = segmentCallRecording(wav);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E822");
  });
});

describe("segmentCallRecording: 未知 audioFormat → KMB-E822 (§6.5.2 手順1)", () => {
  it("audioFormat=3 (IEEE float、非対応) は KMB-E822 を返す", () => {
    const wav = buildWav({
      audioFormat: 3,
      numChannels: 1,
      sampleRate: 8000,
      bitsPerSample: 32,
      dataBytes: new Uint8Array(16),
    });

    const result = segmentCallRecording(wav);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E822");
  });

  it("audioFormat=6 (A-law、非対応) は KMB-E822 を返す", () => {
    const wav = buildWav({
      audioFormat: 6,
      numChannels: 1,
      sampleRate: 8000,
      bitsPerSample: 8,
      dataBytes: new Uint8Array(8),
    });

    const result = segmentCallRecording(wav);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E822");
  });

  it("numChannels=3 (mono/stereo以外、非対応) は KMB-E822 を返す", () => {
    const wav = buildWav({
      audioFormat: 1,
      numChannels: 3,
      sampleRate: 8000,
      bitsPerSample: 16,
      dataBytes: new Uint8Array(12),
    });

    const result = segmentCallRecording(wav);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E822");
  });

  it("PCM で bitsPerSample=8 (16bit以外、非対応) は KMB-E822 を返す", () => {
    const wav = buildWav({
      audioFormat: 1,
      numChannels: 1,
      sampleRate: 8000,
      bitsPerSample: 8,
      dataBytes: new Uint8Array(8),
    });

    const result = segmentCallRecording(wav);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E822");
  });

  it("sampleRate=0 (不正な値) は KMB-E822 を返す", () => {
    const wav = buildWav({
      audioFormat: 1,
      numChannels: 1,
      sampleRate: 0,
      bitsPerSample: 16,
      dataBytes: new Uint8Array(8),
    });

    const result = segmentCallRecording(wav);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E822");
  });
});

describe("segmentCallRecording: 不正な RIFF ヘッダ (§6.5.2 手順1、例外を投げず Result で返す)", () => {
  it("ヘッダが短すぎる (12byte未満) は KMB-E822 を返す", () => {
    const result = segmentCallRecording(new Uint8Array([1, 2, 3, 4]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E822");
  });

  it("RIFF/WAVE マジックが一致しない (例: RIFX) は KMB-E822 を返す", () => {
    const wav = buildPcm16MonoWav([1, 2, 3], 8000);
    wav[0] = "X".charCodeAt(0); // "RIFF" → "XIFF"
    const result = segmentCallRecording(wav);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E822");
  });

  it("fmt チャンクが存在しない (data チャンクのみ) は KMB-E822 を返す", () => {
    const buffer = new ArrayBuffer(20);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 12, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "data");
    view.setUint32(16, 0, true);

    const result = segmentCallRecording(bytes);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E822");
  });

  it("data チャンクが存在しない (fmt チャンクのみ) は KMB-E822 を返す", () => {
    const buffer = new ArrayBuffer(36);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 28, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 16000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);

    const result = segmentCallRecording(bytes);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E822");
  });

  it("fmt チャンクの宣言サイズがバッファ長を超える (壊れたチャンクサイズ) は KMB-E822 を返す", () => {
    const buffer = new ArrayBuffer(20);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 12, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true); // fmt チャンクは16byte必要だが実バッファはここまでで尽きる

    const result = segmentCallRecording(bytes);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E822");
  });
});
