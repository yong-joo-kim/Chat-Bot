/**
 * [신규 No.32] 요청 스트림 상한 읽기(voice-ai-설계.md §5.3 8단계 · C-2) — 이 API의 본문 파서는 JSON·urlencoded 2종뿐이라
 * `audio/*` 본문은 요청 스트림으로 남는다. 바이트 상한과 수신 시간 상한을 걸고 **메모리에서만** 모은다(디스크 0 — VO-3).
 * 초과하면 읽기를 즉시 멈춘다(그 이후 청크는 버려진다). 순수 — Nest·DB 무의존.
 */
export interface ReadableLike {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'error', listener: (err: unknown) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'aborted', listener: () => void): unknown;
  removeListener(event: string, listener: (...args: never[]) => void): unknown;
  pause?(): unknown;
}

export type BoundedBodyResult =
  | { readonly kind: 'OK'; readonly body: Buffer }
  | { readonly kind: 'EMPTY' }
  | { readonly kind: 'TOO_LARGE' }
  | { readonly kind: 'TIMEOUT' }
  | { readonly kind: 'ABORTED' };

export function readBoundedBody(stream: ReadableLike, maxBytes: number, timeoutMs: number): Promise<BoundedBodyResult> {
  return new Promise<BoundedBodyResult>((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const onData = (chunk: Buffer | string): void => {
      if (settled) return;
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      total += buf.length;
      if (total > maxBytes) {
        chunks.length = 0;
        finish({ kind: 'TOO_LARGE' });
        return;
      }
      chunks.push(buf);
    };
    const onEnd = (): void => {
      if (total === 0) finish({ kind: 'EMPTY' });
      else finish({ kind: 'OK', body: Buffer.concat(chunks, total) });
    };
    const onFail = (): void => {
      chunks.length = 0;
      finish({ kind: 'ABORTED' });
    };
    const timer = setTimeout(() => {
      chunks.length = 0;
      finish({ kind: 'TIMEOUT' });
    }, timeoutMs);

    function finish(result: BoundedBodyResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 'error' 리스너는 남겨 둔다 — 제거하면 이후 오류 이벤트가 처리되지 않은 예외가 된다(이미 settled라 무시된다).
      stream.removeListener('data', onData as (...args: never[]) => void);
      if (result.kind !== 'OK' && result.kind !== 'EMPTY') stream.pause?.();
      resolve(result);
    }
    // 'end' 없이 닫히면(연결 끊김) 중단으로 본다. 'end' 뒤의 'close'는 이미 settled라 무시된다.
    function onClose(): void {
      onFail();
    }

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onFail);
    stream.on('close', onClose);
    stream.on('aborted', onFail);
  });
}
