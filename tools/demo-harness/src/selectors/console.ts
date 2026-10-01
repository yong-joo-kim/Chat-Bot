// 관리 콘솔 선택자 단일 출처(NFR-DHM1 · 설계 §9.3 · §10) — 보이는 문구/접근성 이름 기반, data-testid 0.
// 문구는 apps/web/src/constants/*.messages.ts 에서 복사한 값이며 단위 시험 H-T9가 원문과 대조한다(제품 소스는 import하지 않는다).
// 같은 이름 버튼이 2개인 곳(화면 버튼 vs 확인 대화상자)은 대화상자 범위(`dialog(...)`)로 한정한다.
import type { FrameLocator, Locator } from 'playwright-core';

export const CONSOLE_TEXT = {
  common: { save: '저장', cancel: '취소', confirm: '확인', close: '닫기' },
  intents: { newExampleLabel: '새 예문 입력', addExample: '추가' },
  nodes: { totalLabel: (n: number) => `총 ${n}건` },
  answerSettings: {
    semanticLabel: '의미 매칭 사용',
    saveSuccess: '저장되었습니다. 다음 턴부터 적용됩니다.',
  },
  simulator: { composerLabel: '메시지 입력', send: '전송', showTrace: '판정 근거 보기' },
} as const;

export const consoleUi = {
  /** 열린 대화상자(제품 자체 ConfirmDialog·편집 모달). */
  dialog: (c: FrameLocator): Locator => c.getByRole('dialog').last(),
  /** 목록의 이름 버튼(의도 이름은 버튼으로 렌더된다). */
  nameButton: (c: FrameLocator, name: string): Locator => c.getByRole('button', { name, exact: true }).first(),
  toast: (c: FrameLocator, text: string): Locator => c.getByText(text, { exact: false }).first(),
};
