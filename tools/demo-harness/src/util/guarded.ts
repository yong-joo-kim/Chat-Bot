// 정리 단계 보호막(L-1) — 호출 하나가 던져도 뒤따르는 정리(Ollama 해제·자식 종료)가 건너뛰어지지 않게 한다.
export async function guarded<T>(fn: () => T | Promise<T>, fallback: T, onError: (e: Error) => void): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    try {
      onError(e as Error);
    } catch {
      // 오류 보고 자체의 실패는 무시한다 — 정리 계속이 우선
    }
    return fallback;
  }
}
