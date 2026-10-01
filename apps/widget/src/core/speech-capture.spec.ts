import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpeechCapture, type CaptureDeps, type CaptureView, type RecorderLike, type StreamLike } from './speech-capture';
import { SPEECH_MESSAGES as M } from '../constants/speech';

/** 가짜 `getUserMedia`·`MediaRecorder`·인식 호출 — 상태기계 전이를 DOM 없이 검증한다. */
function setup(opts: { getUserMedia?: () => Promise<StreamLike>; transcribe?: CaptureDeps['transcribe'] } = {}) {
  const track = { stop: vi.fn() };
  const stream: StreamLike = { getTracks: () => [track] };
  const recorders: Array<RecorderLike & { stopped: boolean; emit(bytes: number): void }> = [];
  let hiddenCb: (() => void) | undefined;
  const unwatch = vi.fn();
  const deps: CaptureDeps = {
    getUserMedia: opts.getUserMedia ?? vi.fn(async () => stream),
    createRecorder: vi.fn(() => {
      const r = {
        mimeType: 'audio/webm;codecs=opus',
        stopped: false,
        ondataavailable: null,
        onstop: null,
        onerror: null,
        start: vi.fn(),
        stop() {
          r.stopped = true;
          // MediaRecorder처럼 stop 뒤 비동기로 onstop이 온다.
          queueMicrotask(() => r.onstop?.());
        },
        emit(bytes: number) {
          r.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
        },
      } as unknown as RecorderLike & { stopped: boolean; emit(bytes: number): void };
      recorders.push(r);
      return r;
    }),
    pickMimeType: () => 'audio/webm;codecs=opus',
    transcribe: opts.transcribe ?? vi.fn(async () => ({ text: '카드 분실 신고' })),
    watchHidden: (cb) => {
      hiddenCb = cb;
      return unwatch;
    },
  };
  const views: CaptureView[] = [];
  const hooks = {
    onView: vi.fn((v: CaptureView) => void views.push(v)),
    onAnnounce: vi.fn(),
    onTranscript: vi.fn(),
    onFocus: vi.fn(),
    onStart: vi.fn(),
  };
  const capture = createSpeechCapture(deps, hooks);
  const last = (): CaptureView => views[views.length - 1];
  return { capture, deps, hooks, views, last, track, recorders, unwatch, fireHidden: () => hiddenCb?.() };
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

async function startRecording(h: ReturnType<typeof setup>): Promise<void> {
  h.capture.toggle();
  await flush();
  expect(h.last().state).toBe('RECORDING');
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('녹음 상태기계 — 정상 경로(IDLE → REQUESTING → RECORDING → UPLOADING → IDLE)', () => {
  it('시작 시 진행 중 읽기 정지 훅을 부르고, 끝내면 글자를 입력창으로 넘긴다(자동 전송 0)', async () => {
    const h = setup();
    h.capture.toggle();
    expect(h.last().state).toBe('REQUESTING');
    expect(h.hooks.onStart).toHaveBeenCalledTimes(1);
    await flush();
    expect(h.last()).toMatchObject({ state: 'RECORDING', notice: M.recording(30) });
    expect(h.hooks.onAnnounce).toHaveBeenCalledWith(M.recordingAnnounce);

    h.recorders[0].emit(1000);
    h.capture.toggle(); // 말하기 끝내기
    expect(h.last().state).toBe('UPLOADING');
    expect(h.track.stop).toHaveBeenCalled(); // 마이크 즉시 닫힘
    await flush();
    expect(h.deps.transcribe).toHaveBeenCalledTimes(1);
    expect(h.hooks.onTranscript).toHaveBeenCalledWith('카드 분실 신고');
    expect(h.last()).toMatchObject({ state: 'IDLE', notice: M.done });
    expect(h.hooks.onFocus).toHaveBeenLastCalledWith('input');
    expect(h.hooks.onAnnounce).toHaveBeenCalledWith(M.done);
  });

  it('남은 시간은 매초 글자로 갱신되고 10초 남았을 때만 1회 낭독한다', async () => {
    const h = setup();
    await startRecording(h);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.last().notice).toBe(M.recording(25));
    h.hooks.onAnnounce.mockClear();
    await vi.advanceTimersByTimeAsync(15000);
    expect(h.last().notice).toBe(M.recording(10));
    expect(h.hooks.onAnnounce).toHaveBeenCalledTimes(1);
    expect(h.hooks.onAnnounce).toHaveBeenCalledWith(M.tenLeft);
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.hooks.onAnnounce).toHaveBeenCalledTimes(1); // 매초 낭독 금지
  });

  it('30초가 되면 자동으로 끝나 인식으로 넘어가고 안내 문구를 붙인다', async () => {
    const h = setup();
    await startRecording(h);
    h.recorders[0].emit(500);
    await vi.advanceTimersByTimeAsync(30000);
    expect(h.deps.transcribe).toHaveBeenCalledTimes(1);
    expect(h.views.some((v) => v.state === 'UPLOADING' && v.notice.startsWith(M.autoEnded))).toBe(true);
  });

  it('녹음 누적이 1MB를 넘으면 자동 종료한다', async () => {
    const h = setup();
    await startRecording(h);
    h.recorders[0].emit(1024 * 1024 + 1);
    expect(h.last()).toMatchObject({ state: 'UPLOADING' });
    expect(h.last().notice.startsWith(M.sizeEnded)).toBe(true);
    expect(h.track.stop).toHaveBeenCalled();
  });

  it('REQUESTING·UPLOADING 동안 말하기를 다시 눌러도 무시된다(연타 방지)', async () => {
    const h = setup();
    h.capture.toggle();
    h.capture.toggle(); // 같은 틱 연타
    await flush();
    expect(h.deps.getUserMedia).toHaveBeenCalledTimes(1);
    expect(h.deps.createRecorder).toHaveBeenCalledTimes(1);
    h.recorders[0].emit(10);
    h.capture.toggle();
    h.capture.toggle(); // UPLOADING 중 재클릭
    await flush();
    expect(h.deps.transcribe).toHaveBeenCalledTimes(1);
  });

  it('인식 글자는 앞뒤 공백을 다듬어 넘긴다', async () => {
    const h = setup({ transcribe: vi.fn(async () => ({ text: '  안녕하세요  ' })) });
    await startRecording(h);
    h.recorders[0].emit(10);
    h.capture.toggle();
    await flush();
    expect(h.hooks.onTranscript).toHaveBeenCalledWith('안녕하세요');
  });
});

describe('취소·종료 — 마이크는 모든 경로에서 즉시 닫힌다', () => {
  it('녹음 중 취소: 요청 0 · 트랙 stop · IDLE · "녹음을 취소했어요" 1회 낭독 · 포커스 말하기', async () => {
    const h = setup();
    await startRecording(h);
    h.recorders[0].emit(10);
    expect(h.capture.cancel()).toBe(true);
    await flush();
    expect(h.deps.transcribe).not.toHaveBeenCalled();
    expect(h.track.stop).toHaveBeenCalled();
    expect(h.last()).toMatchObject({ state: 'IDLE', notice: M.recCanceled });
    expect(h.hooks.onAnnounce).toHaveBeenLastCalledWith(M.recCanceled);
    expect(h.hooks.onFocus).toHaveBeenLastCalledWith('mic');
  });

  it('인식 중 취소: 요청을 중단하고 결과를 버린다', async () => {
    let capturedSignal: AbortSignal | undefined;
    const h = setup({
      transcribe: vi.fn(
        (_blob: Blob, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            capturedSignal = signal;
            signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }),
      ) as unknown as CaptureDeps['transcribe'],
    });
    await startRecording(h);
    h.recorders[0].emit(10);
    h.capture.toggle();
    await flush();
    expect(h.last().state).toBe('UPLOADING');
    expect(h.capture.cancel()).toBe(true);
    await flush();
    expect(capturedSignal?.aborted).toBe(true);
    expect(h.hooks.onTranscript).not.toHaveBeenCalled();
    expect(h.last()).toMatchObject({ state: 'IDLE', notice: M.sttCanceled });
  });

  it('REQUESTING 중 취소하면 늦게 허용된 마이크를 바로 닫고 녹음을 만들지 않는다', async () => {
    let resolveMedia: ((s: StreamLike) => void) | undefined;
    const track = { stop: vi.fn() };
    const h = setup({ getUserMedia: () => new Promise<StreamLike>((r) => (resolveMedia = r)) });
    h.capture.toggle();
    await flush(); // getUserMedia 호출까지 진행(권한 창이 떠 있는 상태)
    expect(h.capture.cancel()).toBe(true);
    resolveMedia?.({ getTracks: () => [track] });
    await flush();
    expect(track.stop).toHaveBeenCalled();
    expect(h.deps.createRecorder).not.toHaveBeenCalled();
  });

  it('진행 중이 아니면 cancel은 false(Esc가 패널 닫기로 이어진다)', () => {
    const h = setup();
    expect(h.capture.cancel()).toBe(false);
  });

  it('창 닫기(quiet): 안내·포커스 이동 없이 조용히 정리한다', async () => {
    const h = setup();
    await startRecording(h);
    h.hooks.onAnnounce.mockClear();
    h.hooks.onFocus.mockClear();
    h.capture.cancel(true);
    expect(h.track.stop).toHaveBeenCalled();
    expect(h.last()).toMatchObject({ state: 'IDLE', notice: '' });
    expect(h.hooks.onAnnounce).not.toHaveBeenCalled();
    expect(h.hooks.onFocus).not.toHaveBeenCalled();
  });

  it('탭이 숨겨지면 녹음을 취소하고 "녹음이 중단됐어요"로 FAILED가 된다(EX-VO-18)', async () => {
    const h = setup();
    await startRecording(h);
    h.fireHidden();
    expect(h.track.stop).toHaveBeenCalled();
    expect(h.last()).toMatchObject({ state: 'FAILED', notice: M.interrupted });
    expect(h.deps.transcribe).not.toHaveBeenCalled();
  });

  it('가시성 감시는 녹음 중에만 등록되고 종료 때 해제된다', async () => {
    const h = setup();
    expect(h.unwatch).not.toHaveBeenCalled();
    await startRecording(h);
    h.recorders[0].emit(10);
    h.capture.toggle();
    expect(h.unwatch).toHaveBeenCalled();
  });
});

describe('실패 — 문구는 §8.1 표 그대로, 자동으로 사라지지 않는다', () => {
  async function failWith(kind: string | undefined, name?: string) {
    const err = Object.assign(new Error('x'), kind ? { kind } : {}, name ? { name } : {});
    const h = setup({ transcribe: vi.fn(async () => Promise.reject(err)) as unknown as CaptureDeps['transcribe'] });
    await startRecording(h);
    h.recorders[0].emit(10);
    h.capture.toggle();
    await flush();
    return h;
  }

  it.each([
    ['BUSY', M.busy, 'FAILED'],
    ['INVALID', M.invalid, 'FAILED'],
    ['TOO_LARGE', M.tooLarge, 'FAILED'],
    ['FAILED', M.failed, 'FAILED'],
    ['RATE_LIMITED', M.rateLimited, 'FAILED'],
    ['SESSION', M.sessionBad, 'FAILED'],
    ['NETWORK', M.network, 'FAILED'],
    ['UNAVAILABLE', M.unavailable, 'FAILED'], // 일시 장애일 수 있어 재시도 가능(M-3)
    ['DISABLED', M.siteBlocked, 'REMOVED'],
  ])('%s → 상태 줄 문구 + %s 상태', async (kind, text, state) => {
    const h = await failWith(kind);
    expect(h.last()).toMatchObject({ state, notice: text });
    expect(h.hooks.onAnnounce).toHaveBeenLastCalledWith(text);
    expect(h.hooks.onFocus).toHaveBeenLastCalledWith(state === 'REMOVED' ? 'input' : 'mic');
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.last().notice).toBe(text); // 자동으로 사라지지 않는다
  });

  it('알 수 없는 오류는 "음성을 글자로 바꾸지 못했어요"', async () => {
    const h = await failWith(undefined);
    expect(h.last()).toMatchObject({ state: 'FAILED', notice: M.failed });
  });

  it('말소리 없음(empty)은 입력창을 건드리지 않고 FAILED 형태로 안내한다', async () => {
    const h = setup({ transcribe: vi.fn(async () => ({ text: '', empty: true })) });
    await startRecording(h);
    h.recorders[0].emit(10);
    h.capture.toggle();
    await flush();
    expect(h.hooks.onTranscript).not.toHaveBeenCalled();
    expect(h.last()).toMatchObject({ state: 'FAILED', notice: M.empty });
    expect(h.hooks.onFocus).toHaveBeenLastCalledWith('mic');
  });

  it('인식 요청 대기 상한(15초)을 넘기면 요청을 중단하고 FAILED(무한 대기 금지)', async () => {
    const h = setup({
      transcribe: vi.fn(
        (_b: Blob, signal: AbortSignal) =>
          new Promise((_r, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('a'), { name: 'AbortError' })))),
      ) as unknown as CaptureDeps['transcribe'],
    });
    await startRecording(h);
    h.recorders[0].emit(10);
    h.capture.toggle();
    await vi.advanceTimersByTimeAsync(14999);
    expect(h.last().state).toBe('UPLOADING');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.last()).toMatchObject({ state: 'FAILED', notice: M.failed });
  });

  it('FAILED 뒤 입력을 시작하면 안내가 걷히고 다시 말하기가 가능하다', async () => {
    const h = await failWith('BUSY');
    h.capture.noteUserInput();
    expect(h.last()).toMatchObject({ state: 'IDLE', notice: '' });
  });

  it('FAILED에서 다시 누르면 새 녹음을 시작한다("다시 말하기")', async () => {
    const h = await failWith('BUSY');
    h.capture.toggle();
    await flush();
    expect(h.deps.createRecorder).toHaveBeenCalledTimes(2);
    expect(h.last().state).toBe('RECORDING');
  });

  it('권한 거부는 BLOCKED — 이 페이지에서 재요청하지 않는다(EX-VO-3)', async () => {
    const h = setup({ getUserMedia: vi.fn(async () => Promise.reject(Object.assign(new Error('d'), { name: 'NotAllowedError' }))) });
    h.capture.toggle();
    await flush();
    expect(h.last()).toMatchObject({ state: 'BLOCKED', notice: M.permDenied });
    h.capture.toggle();
    await flush();
    expect(h.deps.getUserMedia).toHaveBeenCalledTimes(1);
    expect(h.last().state).toBe('BLOCKED');
  });

  it.each([
    ['SecurityError', 'BLOCKED', M.siteBlocked],
    ['NotFoundError', 'FAILED', M.noDevice],
    ['NotReadableError', 'FAILED', M.deviceBusy],
  ])('getUserMedia %s → %s', async (name, state, text) => {
    const h = setup({ getUserMedia: vi.fn(async () => Promise.reject(Object.assign(new Error('d'), { name }))) });
    h.capture.toggle();
    await flush();
    expect(h.last()).toMatchObject({ state, notice: text });
  });

  it('마이크 제거(remove): 버튼 제거 상태가 되고 다시 시작되지 않는다', async () => {
    const h = setup();
    h.capture.remove();
    expect(h.last().state).toBe('REMOVED');
    h.capture.toggle();
    await flush();
    expect(h.deps.getUserMedia).not.toHaveBeenCalled();
  });
});

describe('고지 자리(VO-W4) — 1차는 즉시 통과', () => {
  it('ensureSpeechNoticeAcknowledged는 true를 돌려주고 화면에 고지 문구를 올리지 않는다', async () => {
    const { ensureSpeechNoticeAcknowledged } = await import('./speech-capture');
    await expect(ensureSpeechNoticeAcknowledged()).resolves.toBe(true);
  });
});
