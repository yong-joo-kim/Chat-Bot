// [DT-2] 음성 인식 장치 결정표(설계 §5.2 · H-T22) — 순수 함수. 사전 점검이 모은 사실로 장치·모델을 정하거나 불가·차단을 돌려준다.
// 처리 원칙(A-DX-2): 보이는 시연 = 경고 + 해당 장면 생략(진행자 확인) · 무인 점검 = 차단 · **사용자가 장치를 명시(cuda|cpu)했는데 그 장치가 불가 = 양쪽 차단**.
// 시스템 PATH에 CUDA가 있으면 venv DLL 폴더 없이도 cuda가 적재된다(DX-8) — 사전 점검은 힌트이고 **기동 시도 결과가 권위**다(실패하면 cpu로 1회 재기동).
import type { DeviceNote, SttDevice, SttModel, SttRequest } from '../scenario/plan';

/** CUDA 장치 조건(설계 §5.2 1행): 그래픽 메모리 여유 하한(MiB — turbo 관찰 상한 1,053 + 여유). */
export const STT_MIN_FREE_VRAM_MIB = 1300;

export interface SttFacts {
  /** `faster_whisper`·`av` 불러오기(PC-DX-1). */
  packageOk: boolean;
  /** 가짜 마이크 점검(PC-DX-6). */
  fakeMicOk: boolean;
  /** 합성 음성(PC-DX-7). */
  synthOk: boolean;
  gpuPresent: boolean;
  /** venv nvidia DLL 폴더 3개 또는 시스템 PATH의 CUDA(DX-8). */
  dllOk: boolean;
  /** GPU 메모리 여유(MiB · 모르면 null). */
  vramFreeMiB: number | null;
  turboCache: boolean;
  smallCache: boolean;
}

export type SttDecision =
  | { kind: 'RUN'; device: SttDevice; model: SttModel; note: DeviceNote | null }
  | { kind: 'UNAVAILABLE'; reason: string }
  | { kind: 'BLOCK'; reason: string };

/** CUDA 조건에서 빠진 것들(없으면 빈 배열). */
export function cudaMissing(f: SttFacts): string[] {
  const out: string[] = [];
  if (!f.gpuPresent) out.push('GPU 없음');
  if (!f.dllOk) out.push('CUDA DLL 폴더 없음');
  if (f.vramFreeMiB === null || f.vramFreeMiB < STT_MIN_FREE_VRAM_MIB) out.push(`그래픽 메모리 여유 ${f.vramFreeMiB === null ? '확인 못함' : `${f.vramFreeMiB}MiB`} (필요 ${STT_MIN_FREE_VRAM_MIB}MiB 이상)`);
  if (!f.turboCache) out.push('large-v3-turbo 모델 없음');
  return out;
}

export function decideStt(requested: SttRequest, f: SttFacts): SttDecision {
  // 장치와 무관한 공통 조건(불가) — 패키지·가짜 마이크·합성 음성은 어느 장치로든 필요하다
  if (!f.packageOk) return { kind: 'UNAVAILABLE', reason: '음성 인식 패키지(faster_whisper · av)를 불러오지 못했습니다' };
  if (!f.turboCache && !f.smallCache) return { kind: 'UNAVAILABLE', reason: '음성 인식 모델(large-v3-turbo · small)이 없습니다' };
  if (!f.fakeMicOk) return { kind: 'UNAVAILABLE', reason: '브라우저 가짜 마이크가 동작하지 않습니다' };
  if (!f.synthOk) return { kind: 'UNAVAILABLE', reason: '합성 음성을 만들지 못했습니다' };

  const missing = cudaMissing(f);
  if (requested === 'cuda') {
    if (missing.length > 0) return { kind: 'BLOCK', reason: missing.join(' · ') };
    return { kind: 'RUN', device: 'cuda', model: 'large-v3-turbo', note: null };
  }
  if (requested === 'cpu') {
    if (!f.smallCache) return { kind: 'BLOCK', reason: 'small 모델 없음(CPU로 turbo는 쓰지 않습니다)' };
    return { kind: 'RUN', device: 'cpu', model: 'small', note: null };
  }
  // auto
  if (missing.length === 0) return { kind: 'RUN', device: 'cuda', model: 'large-v3-turbo', note: null };
  if (f.smallCache) return { kind: 'RUN', device: 'cpu', model: 'small', note: { kind: 'SELECTED', reason: missing.join(' · ') } };
  return { kind: 'UNAVAILABLE', reason: `GPU 조건을 채우지 못했고(${missing.join(' · ')}) small 모델도 없습니다` };
}
