// 오케스트레이터 공용 오류 — 준비 단계 실패(3요소)와 중단. index.ts와 full-prepare.ts가 순환 의존 없이 함께 쓴다.
export class AbortedError extends Error {
  constructor() {
    super('중단됨');
    this.name = 'AbortedError';
  }
}

export class PrepareError extends Error {
  constructor(
    message: string,
    public readonly why: string,
    public readonly how: string,
  ) {
    super(message);
    this.name = 'PrepareError';
  }
}
