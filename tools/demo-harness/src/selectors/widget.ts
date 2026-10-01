// 위젯 선택자 단일 출처(NFR-DHM1 · 설계 §9.3) — 런처·입력·전송은 접근성 이름, 말풍선은 위젯 스타일의 안정 클래스(열린 Shadow DOM이라 Playwright 선택자가 관통한다).
// 문구 원천: apps/widget/src/constants/messages.ts (단위 시험 H-T9가 문자열 대조).
import type { FrameLocator, Locator } from 'playwright-core';

export const WIDGET_TEXT = {
  launcher: '상담 시작하기',
  input: '메시지 입력',
  send: '전송',
} as const;

export const widget = {
  launcher: (site: FrameLocator): Locator => site.getByLabel(WIDGET_TEXT.launcher),
  input: (site: FrameLocator): Locator => site.getByLabel(WIDGET_TEXT.input),
  sendButton: (site: FrameLocator): Locator => site.getByRole('button', { name: WIDGET_TEXT.send, exact: true }),
  botMessages: (site: FrameLocator): Locator => site.locator('.cb-msg-bot .cb-msg-text'),
  userMessages: (site: FrameLocator): Locator => site.locator('.cb-msg-user'),
  agentMessages: (site: FrameLocator): Locator => site.locator('.cb-msg-agent'),
};
