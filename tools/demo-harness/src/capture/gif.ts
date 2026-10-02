// 짧은 GIF(설계 §15) — 지정 단계 동안 500ms 간격 스크린샷(최대 12장 · 6초)을 모아 순수 JS(pngjs + gifenc)로 인코딩한다. 외부 인코더 0.
// 프레임 수집은 공연 중(화면 캡처만), 인코딩은 보고서 단계에서 해 공연 지연을 만들지 않는다.
import { PNG } from 'pngjs';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { sleepMs } from '../util/wait-for';

export const GIF_FRAME_INTERVAL_MS = 500;
export const GIF_MAX_FRAMES = 12;
export const GIF_WIDTH = 960;

/** 한 단계의 연속 스크린샷 수집기. `stop()`은 수집 루프를 끝내고 마지막 화면 1장을 더 담는다. */
export class GifClip {
  readonly frames: Buffer[] = [];
  private stopped = false;
  private readonly loop: Promise<void>;

  constructor(
    readonly stepId: string,
    private readonly shoot: () => Promise<Buffer>,
    private readonly signal?: AbortSignal,
  ) {
    this.loop = this.run();
  }

  private async run(): Promise<void> {
    while (!this.stopped && this.frames.length < GIF_MAX_FRAMES - 1 && !this.signal?.aborted) {
      try {
        this.frames.push(await this.shoot());
      } catch {
        /* 한 장 실패는 건너뛴다(화면 이동 중 등) */
      }
      await sleepMs(GIF_FRAME_INTERVAL_MS, this.signal);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.loop;
    if (this.frames.length < GIF_MAX_FRAMES) {
      try {
        this.frames.push(await this.shoot());
      } catch {
        /* 마지막 장 실패는 무시 */
      }
    }
  }
}

/** PNG를 디코딩해 가로 `width`로 줄인다(박스 평균 — 글자가 뭉개지지 않게). */
export function decodeAndScale(png: Buffer, width: number): { data: Uint8Array; width: number; height: number } {
  const src = PNG.sync.read(png);
  if (src.width <= width) return { data: new Uint8Array(src.data), width: src.width, height: src.height };
  const scale = src.width / width;
  const height = Math.max(1, Math.round(src.height / scale));
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.min(src.height, Math.max(y0 + 1, Math.floor((y + 1) * scale)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(src.width, Math.max(x0 + 1, Math.floor((x + 1) * scale)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * src.width + xx) * 4;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          n++;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = 255;
    }
  }
  return { data: out, width, height };
}

/** 프레임(PNG 버퍼) 목록을 GIF 한 개로 인코딩한다. 프레임마다 256색 팔레트. 프레임이 없으면 null. */
export function encodeGif(frames: readonly Buffer[], opts: { width?: number; delayMs?: number } = {}): Buffer | null {
  if (frames.length === 0) return null;
  const enc = GIFEncoder();
  const delay = opts.delayMs ?? GIF_FRAME_INTERVAL_MS;
  for (const f of frames) {
    const img = decodeAndScale(f, opts.width ?? GIF_WIDTH);
    const palette = quantize(img.data, 256, { format: 'rgb565' });
    const index = applyPalette(img.data, palette, 'rgb565');
    enc.writeFrame(index, img.width, img.height, { palette, delay, repeat: 0 });
  }
  enc.finish();
  return Buffer.from(enc.bytes());
}
