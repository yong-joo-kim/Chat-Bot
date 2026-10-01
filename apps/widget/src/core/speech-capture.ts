import { SPEECH_ERROR_NOTICE, SPEECH_LIMITS, SPEECH_MESSAGES as M, type SpeechClientErrorKind } from '../constants/speech';

/**
 * [신규 No.32] 눌러서 말하기 녹음 상태기계(설계 §9.3 · voice-ai-ui-spec §4.2) — DOM 무의존. `getUserMedia`·
 * `MediaRecorder`·인식 호출·가시성 감시는 주입한다(시험은 가짜). 녹음 바이트는 `Blob` 메모리에만 있고 업로드·취소
 * 직후 참조를 끊는다 — 저장소(localStorage·sessionStorage·IndexedDB)에 쓰지 않는다(FR-VO6-7).
 * 모든 종료·취소 경로에서 마이크 트랙을 즉시 `stop()`한다. 인식 글자는 `onTranscript`로 넘길 뿐 자동 전송하지 않는다.
 */
export type CaptureState = 'IDLE' | 'REQUESTING' | 'RECORDING' | 'UPLOADING' | 'FAILED' | 'BLOCKED' | 'REMOVED';

export interface CaptureView {
  state: CaptureState;
  /** RECORDING 중 남은 초(글자로만 표시 — 라이브 영역 아님). */
  remaining: number;
  /** 상태 줄 문구(없으면 ''). */
  notice: string;
}

export interface RecorderLike {
  mimeType?: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}
export interface StreamLike {
  getTracks(): { stop(): void }[];
}

export interface CaptureDeps {
  getUserMedia(): Promise<StreamLike>;
  createRecorder(stream: StreamLike, mimeType: string | undefined): RecorderLike;
  pickMimeType(): string | undefined;
  /** 실패는 `{ kind: SpeechClientErrorKind }`를 가진 오류로 던진다(`public-client.ts`의 `SpeechClientError`). */
  transcribe(blob: Blob, signal: AbortSignal): Promise<{ text: string; empty?: boolean }>;
  /** 문서가 숨겨질 때 `cb` 호출 — 녹음 중에만 등록하고 반환 함수로 해제한다. */
  watchHidden(cb: () => void): () => void;
}

export interface CaptureHooks {
  onView(view: CaptureView): void;
  /** `#cb-status`(polite) 1회 낭독. */
  onAnnounce(text: string): void;
  onTranscript(text: string): void;
  onFocus(target: 'mic' | 'input'): void;
  /** 녹음 시작 직전 — 진행 중 읽기를 멈춘다(FR-VO1-11). */
  onStart(): void;
}

/**
 * 첫 사용 고지 단일 호출 지점(DD-133 · VO-W4). **1차는 즉시 통과** — 법무 확인 전이라 화면에 고지·임시 문구를
 * 올리지 않는다. 법무가 구현을 요청하면 이 함수만 인라인 안내 블록 표시로 교체한다.
 */
export async function ensureSpeechNoticeAcknowledged(): Promise<boolean> {
  return true;
}

export interface SpeechCapture {
  /** 말하기 버튼: IDLE·FAILED → 시작 / RECORDING → 종료(인식으로) / 그 밖 → 무시. */
  toggle(): void;
  /** Esc·취소 버튼 — 진행 중(REQUESTING·RECORDING·UPLOADING)이면 취소하고 true. `quiet`(창 닫기)면 안내·포커스 이동 없이 조용히. */
  cancel(quiet?: boolean): boolean;
  /** 입력창에 글자를 치기 시작 — 실패·완료 안내를 걷는다(BLOCKED는 유지). */
  noteUserInput(): void;
  /** 마이크를 영구 제거 상태로(사이트 비활성 등). */
  remove(): void;
  /** 녹음 준비·녹음 중 — 답변 듣기 비활성 판단용. */
  isRecording(): boolean;
}

/** `getUserMedia` 오류 이름 → [상태, 문구]. 표에 없으면 장치 사용 불가(다른 앱 점유 등). */
const DEVICE_ERRORS: Record<string, ['FAILED' | 'BLOCKED', string]> = {
  NotAllowedError: ['BLOCKED', M.permDenied],
  PermissionDeniedError: ['BLOCKED', M.permDenied],
  SecurityError: ['BLOCKED', M.siteBlocked],
  NotFoundError: ['FAILED', M.noDevice],
  DevicesNotFoundError: ['FAILED', M.noDevice],
  OverconstrainedError: ['FAILED', M.noDevice],
};

export function createSpeechCapture(deps: CaptureDeps, hooks: CaptureHooks): SpeechCapture {
  let state: CaptureState = 'IDLE';
  let notice = '';
  let remaining: number = SPEECH_LIMITS.maxRecordSeconds;
  let token = 0;
  let stream: StreamLike | null = null;
  let recorder: RecorderLike | null = null;
  let chunks: Blob[] = [];
  let bytes = 0;
  let intervalId: ReturnType<typeof setInterval> | undefined;
  let deadlineId: ReturnType<typeof setTimeout> | undefined;
  let unwatch: (() => void) | undefined;
  let abortCtl: AbortController | undefined;

  function emit(next: CaptureState, text = ''): void {
    state = next;
    notice = text;
    hooks.onView({ state, remaining, notice });
  }

  const stopTracks = (s: StreamLike | null): void => s?.getTracks().forEach((t) => t.stop());

  /** 마이크·타이머·요청·버퍼를 전부 정리하고 세대를 올려 늦게 도착하는 콜백을 무효화한다. */
  function teardown(): void {
    token += 1;
    clearInterval(intervalId);
    clearTimeout(deadlineId);
    unwatch?.();
    unwatch = undefined;
    if (recorder) {
      Object.assign(recorder, { ondataavailable: null, onstop: null, onerror: null });
      try {
        recorder.stop();
      } catch {
        // inactive
      }
      recorder = null;
    }
    stopTracks(stream);
    stream = null;
    chunks = [];
    abortCtl?.abort();
  }

  /** 안내를 상태 줄에 두고 `#cb-status`로 1회 낭독한 뒤 포커스를 옮긴다(실패·차단·제거). */
  function fail(text: string, next: 'FAILED' | 'BLOCKED' | 'REMOVED' = 'FAILED'): void {
    emit(next, text);
    hooks.onAnnounce(text);
    hooks.onFocus(next === 'REMOVED' ? 'input' : 'mic');
  }

  async function upload(t: number, type: string): Promise<void> {
    recorder = null;
    const blob = new Blob(chunks, { type });
    chunks = [];
    if (blob.size === 0) return fail(M.invalid);
    const ctl = (abortCtl = new AbortController());
    let timedOut = false;
    deadlineId = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, SPEECH_LIMITS.uploadDeadlineMs);
    try {
      const res = await deps.transcribe(blob, ctl.signal);
      if (t !== token) return;
      clearTimeout(deadlineId);
      const text = (res.text ?? '').trim();
      if (res.empty || !text) return fail(M.empty);
      emit('IDLE', M.done);
      hooks.onTranscript(text);
      hooks.onAnnounce(M.done);
      hooks.onFocus('input');
    } catch (e) {
      if (t !== token) return;
      clearTimeout(deadlineId);
      const kind = timedOut ? undefined : (e as { kind?: SpeechClientErrorKind }).kind;
      fail(kind ? SPEECH_ERROR_NOTICE[kind] : M.failed, kind === 'DISABLED' ? 'REMOVED' : 'FAILED'); // UNAVAILABLE은 일시 장애일 수 있어 재시도 가능(M-3)
    }
  }

  function finishRecording(reason: 'manual' | 'time' | 'size'): void {
    if (state !== 'RECORDING' || !recorder) return;
    clearInterval(intervalId);
    unwatch?.();
    unwatch = undefined;
    const note = reason === 'time' ? M.autoEnded : reason === 'size' ? M.sizeEnded : '';
    const text = note ? `${note} ${M.uploading}` : M.uploading;
    emit('UPLOADING', text);
    hooks.onAnnounce(text);
    try {
      recorder.stop();
    } catch {
      recorder.onstop?.(); // onstop이 오지 않으면 직접 업로드로 이어간다
    }
    stopTracks(stream); // 마이크 즉시 닫힘(FR-VO6-7)
    stream = null;
  }

  async function start(): Promise<void> {
    const t = ++token;
    hooks.onStart();
    remaining = SPEECH_LIMITS.maxRecordSeconds;
    emit('REQUESTING', M.preparing);
    if (!(await ensureSpeechNoticeAcknowledged())) return t === token ? emit('IDLE') : undefined;
    if (t !== token) return;
    let s: StreamLike;
    try {
      s = await deps.getUserMedia();
    } catch (e) {
      const [next, text] = DEVICE_ERRORS[(e as { name?: string })?.name ?? ''] ?? ['FAILED', M.deviceBusy];
      if (t === token) fail(text, next);
      return;
    }
    if (t !== token) return stopTracks(s); // 요청 중 취소됨 — 늦게 허용된 마이크를 바로 닫는다
    stream = s;
    const mime = deps.pickMimeType();
    const broken = (): void => {
      teardown();
      fail(M.deviceBusy);
    };
    let rec: RecorderLike;
    try {
      rec = deps.createRecorder(s, mime);
      recorder = rec;
      rec.ondataavailable = (e) => {
        if (t !== token || !e.data?.size) return;
        chunks.push(e.data);
        bytes += e.data.size;
        if (bytes > SPEECH_LIMITS.maxAudioBytes) finishRecording('size');
      };
      rec.onstop = () => {
        if (t === token && state === 'UPLOADING') void upload(t, rec.mimeType || mime || 'audio/webm');
      };
      rec.onerror = () => t === token && broken();
      bytes = 0;
      chunks = [];
      rec.start(1000);
    } catch {
      return broken();
    }
    emit('RECORDING', M.recording(remaining));
    hooks.onAnnounce(M.recordingAnnounce);
    intervalId = setInterval(() => {
      if (t !== token || state !== 'RECORDING') return;
      remaining -= 1;
      if (remaining <= 0) return finishRecording('time');
      if (remaining === SPEECH_LIMITS.tenLeftSeconds) hooks.onAnnounce(M.tenLeft);
      emit('RECORDING', M.recording(remaining));
    }, 1000);
    // 가시성 감시는 녹음 중에만 등록한다(부팅 리스너 추가 0).
    unwatch = deps.watchHidden(() => {
      if (t !== token || state !== 'RECORDING') return;
      teardown();
      fail(M.interrupted);
    });
  }

  const isBusy = (): boolean => state === 'REQUESTING' || state === 'RECORDING' || state === 'UPLOADING';

  return {
    toggle() {
      if (state === 'RECORDING') finishRecording('manual');
      else if (state === 'IDLE' || state === 'FAILED') void start();
    },
    cancel(quiet = false) {
      if (!isBusy()) return false;
      const text = quiet ? '' : state === 'UPLOADING' ? M.sttCanceled : M.recCanceled;
      teardown();
      emit('IDLE', text);
      if (!quiet) {
        hooks.onAnnounce(text);
        hooks.onFocus('mic');
      }
      return true;
    },
    noteUserInput() {
      if (state === 'FAILED' || (state === 'IDLE' && notice)) emit('IDLE');
    },
    remove() {
      teardown();
      emit('REMOVED', notice);
    },
    isRecording: () => state === 'REQUESTING' || state === 'RECORDING',
  };
}

/** 브라우저 기본 주입(시험은 가짜를 넘긴다) — 녹음 형식은 첫 지원: webm/opus → mp4 → 브라우저 기본. */
export function defaultCaptureDeps(transcribe: CaptureDeps['transcribe']): CaptureDeps {
  return {
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }) as Promise<StreamLike>,
    createRecorder: (stream, mimeType) =>
      new MediaRecorder(stream as MediaStream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: SPEECH_LIMITS.audioBitsPerSecond,
      }) as unknown as RecorderLike,
    pickMimeType: () =>
      ['audio/webm;codecs=opus', 'audio/mp4'].find((t) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(t)),
    transcribe,
    watchHidden: (cb) => {
      const handler = (): void => {
        if (document.hidden) cb();
      };
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    },
  };
}
