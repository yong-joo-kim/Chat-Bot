// [DT-2] WAV(RIFF) 헤더 파서 — 합성 음성 파일의 길이·표본율·채널·비트를 확인한다(설계 §7.3 · PC-DX-7 · H-T24). 새 의존성 0.

export interface WavInfo {
  ok: boolean;
  format?: number;
  channels?: number;
  sampleRate?: number;
  bitsPerSample?: number;
  dataBytes?: number;
  durationSec?: number;
  error?: string;
}

export function parseWavHeader(buf: Buffer): WavInfo {
  if (buf.length < 44) return { ok: false, error: '파일이 너무 짧습니다' };
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return { ok: false, error: 'RIFF/WAVE 헤더가 아닙니다' };
  let pos = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number; byteRate: number } | null = null;
  let dataBytes = -1;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ' && pos + 8 + 16 <= buf.length) {
      fmt = { format: buf.readUInt16LE(pos + 8), channels: buf.readUInt16LE(pos + 10), sampleRate: buf.readUInt32LE(pos + 12), byteRate: buf.readUInt32LE(pos + 16), bits: buf.readUInt16LE(pos + 22) };
    } else if (id === 'data') {
      // 스트리밍으로 만든 WAV는 data 크기가 0 또는 0xFFFFFFFF일 수 있다 — 실제 남은 길이로 대체한다
      dataBytes = size === 0 || size === 0xffffffff || pos + 8 + size > buf.length ? buf.length - (pos + 8) : size;
      break;
    }
    pos += 8 + size + (size % 2);
  }
  if (!fmt) return { ok: false, error: 'fmt 청크가 없습니다' };
  if (dataBytes < 0) return { ok: false, error: 'data 청크가 없습니다' };
  const durationSec = fmt.byteRate > 0 ? dataBytes / fmt.byteRate : 0;
  return { ok: true, format: fmt.format, channels: fmt.channels, sampleRate: fmt.sampleRate, bitsPerSample: fmt.bits, dataBytes, durationSec };
}
