// [DT-2] 풀 투어 단계가 쓰는 실행 환경(음성·생성·GPU·다운로드·결과 기록) — 오케스트레이터가 만들어 StepContext.full로 넘긴다.
// 이 파일은 타입만 둔다(시나리오 ↔ 오케스트레이터 순환 의존 방지).
import type { StageFacts } from '../stage/facts';

/** 음성 확인 기록(보고서 "음성 확인" 절 · result.json `speech`). */
export interface SpeechRecord {
  expected: string;
  keywords: string[];
  gateTranscript: string | null;
  gateRatio: number | null;
  transcript: string | null;
  matchRatio: number | null;
  keywordsOk: boolean | null;
  intentOk: boolean | null;
  wavSec: number;
  wavBytes: number;
  recordedMime: string | null;
  /** BROWSER = 위젯이 가상 마이크로 녹음 · TYPED_FALLBACK = 같은 문장 타이핑 대체 · MOCK = 모의 인식(무인 점검). */
  source: 'BROWSER' | 'TYPED_FALLBACK' | 'MOCK';
  /** PLAYED = 기기 안 음성으로 읽음 · NO_VOICE = 기기에 한국어 음성 없음 · ERROR = 재생 오류. */
  listen: 'PLAYED' | 'NO_VOICE' | 'ERROR' | null;
  /** 관객용 스피커 재생(SV-03) 결과. */
  speaker: 'PLAYED' | 'FAILED' | 'SKIPPED' | null;
}

/** 로컬 생성 기록(사전·실시간). */
export interface GenerationRecord {
  providerId: string;
  degraded: boolean;
  fallbackFrom: string | null;
  candidates: number;
  elapsedMs: number;
  source: 'PREPARED' | 'LIVE';
  intentName: string;
}

export interface DownloadRecord {
  stepId: string;
  file: string;
  bytes: number;
  via: 'BROWSER' | 'API';
  auditRows: number | null;
  signature: string;
}

export interface VramEvent {
  at: string;
  event: string;
  usedMiB: number | null;
  totalMiB: number | null;
}

/** 공연·준비 중 쌓이는 풀 투어 결과(변경 가능). */
export interface FullRecord {
  speech: SpeechRecord | null;
  prepared: GenerationRecord | null;
  live: GenerationRecord | null;
  loadMs: number | null;
  unloaded: boolean | null;
  downloads: DownloadRecord[];
  proactive: { shown: number; clicked: number; optedOut: number } | null;
  vram: VramEvent[];
  /** 단계가 남기는 추가 정직성(종류 · 단계 · 문구). */
  honesty: Array<{ stepId: string | null; kind: string; text: string }>;
  /** 배지 표시 내역(단계 · 표시 · 미표시 이유) — 내부판 보고서. */
  badgeNotes: Array<{ stepId: string; shown: string[]; hidden: Array<{ badge: string; why: string }> }>;
  /** 음성 확인 이전 기준값(SV-08 +1 검증). */
  voiceStatsBaseline: { requested: number; ok: number } | null;
  /** 마이크 사용 횟수(한 실행 한 문장 — DX-1로 완화됐으나 기록은 남긴다). */
  micOpened: number;
}

export interface GpuStopResult {
  ok: boolean;
  beforeMiB: number | null;
  afterMiB: number | null;
  waitedMs: number;
  reason?: string;
}

export interface GpuLoadResult {
  ok: boolean;
  loadMs: number;
  reason?: string;
}

/** ⑩ 진입 시 순차 적재 제어(SE-01·SE-04) — 오케스트레이터가 프로세스·Ollama·VRAM 관찰기를 묶어 제공한다. */
export interface GpuControl {
  /** 음성 인식 자식 종료 → 회수 확인(음성 자식이 없으면 즉시 ok). */
  stopSpeech(): Promise<GpuStopResult>;
  /** Ollama 모델 적재(빈 요청) + `/api/ps` 확인. */
  loadOllama(): Promise<GpuLoadResult>;
  /** Ollama 모델 해제 + 확인 → 생성 자식 종료. */
  unloadOllama(): Promise<{ ok: boolean; reason?: string }>;
  snapshot(): { usedMiB: number | null; totalMiB: number | null };
  mark(event: string): void;
}

export interface VoiceRunInfo {
  mode: 'real' | 'mock';
  wavPath: string;
  wavSec: number;
  wavBytes: number;
  expected: string;
  keywords: string[];
  gateTranscript: string | null;
  gateRatio: number | null;
  /** 스피커 재생용 URL(무대 서버 경로). */
  audioUrl: string;
  device: string | null;
  modelLabel: string | null;
}

export interface PreparedGeneration {
  intentId: string;
  intentName: string;
  record: GenerationRecord;
}

export interface FullStepEnv {
  voice: VoiceRunInfo | null;
  gpu: GpuControl;
  record: FullRecord;
  stageFacts: StageFacts;
  prepared: PreparedGeneration | null;
  downloadsDir: string;
  /** 하네스 소유 `#voice-play` 버튼을 쓸 수 있는지(보이는 시연 · voice real). */
  speakerEnabled: boolean;
  /** 영상 자막(VTT)에 소리 설명 노트를 남긴다(영상에는 소리가 없다 — 소리 설명의 시각 대안). 보이는 시연만 의미가 있다. */
  soundNote(text: string): void;
  /** 이 브라우저의 기기 안 한국어 읽기 음성 수(PC-DX-8 · 모르면 null) — SV-05 안내 줄의 근거. */
  koreanVoices: number | null;
  /** 모형 D의 slug · 선제 안내 규칙 정보(G-DX-3이 확인한 값). */
  proactive: { dwellSec: number; text: string; buttons: string[] } | null;
}
