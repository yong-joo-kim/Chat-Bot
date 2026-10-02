// 위젯 선택자 단일 출처(NFR-DHM1 · 설계 §9.3) — 런처·입력·전송은 접근성 이름, 말풍선은 위젯 스타일의 안정 클래스(열린 Shadow DOM이라 Playwright 선택자가 관통한다).
// 문구 원천: apps/widget/src/constants/messages.ts (단위 시험 H-T9가 문자열 대조).
import type { FrameLocator, Locator } from 'playwright-core';

export const WIDGET_TEXT = {
  launcher: '상담 시작하기',
  input: '메시지 입력',
  send: '전송',
  // [DT-2] 음성(눌러서 말하기 · 답변 듣기) — `apps/widget/src/constants/speech.ts`
  micIdle: '말하기',
  micStop: '말하기 끝내기',
  micBusy: '글자로 바꾸는 중…',
  listen: '이 답변 듣기',
  listenStop: '듣기 멈추기',
  autoRead: '답변 소리로 듣기',
  voiceDone: '글자로 바꿨어요. 내용을 확인하고 고친 뒤 전송해 주세요.',
  voiceUnavailable: '이 기기에는 한국어 읽기 음성이 없어 소리로 들려드릴 수 없어요.',
  // [DT-2] 선제 안내 말풍선 — `apps/widget/src/constants/proactive.ts`
  paDismiss: '안내 닫기',
  paOptOut: '이번 방문 동안 안내 끄기',
} as const;

export const widget = {
  launcher: (site: FrameLocator): Locator => site.getByLabel(WIDGET_TEXT.launcher),
  input: (site: FrameLocator): Locator => site.getByLabel(WIDGET_TEXT.input),
  sendButton: (site: FrameLocator): Locator => site.getByRole('button', { name: WIDGET_TEXT.send, exact: true }),
  botMessages: (site: FrameLocator): Locator => site.locator('.cb-msg-bot .cb-msg-text'),
  userMessages: (site: FrameLocator): Locator => site.locator('.cb-msg-user'),
  agentMessages: (site: FrameLocator): Locator => site.locator('.cb-msg-agent'),
  // [DT-2] 말하기 버튼은 보이는 글자가 상태별로 바뀐다(이름 정확 일치) — 위젯 id `#cb-mic`은 존재 확인에만 쓴다
  micByName: (site: FrameLocator, name: string): Locator => site.getByRole('button', { name, exact: true }),
  micAny: (site: FrameLocator): Locator => site.locator('#cb-mic'),
  voiceText: (site: FrameLocator): Locator => site.locator('.cb-voice-text'),
  listenButtons: (site: FrameLocator): Locator => site.getByRole('button', { name: WIDGET_TEXT.listen }),
  stopListenButtons: (site: FrameLocator): Locator => site.getByRole('button', { name: WIDGET_TEXT.listenStop }),
  autoReadSwitch: (site: FrameLocator): Locator => site.getByRole('switch', { name: WIDGET_TEXT.autoRead }),
  // 선제 말풍선 루트 클래스는 위젯 스타일의 안정 클래스(`cb-msg-*`와 같은 근거)
  paBubble: (site: FrameLocator): Locator => site.locator('.cb-pa-bubble'),
  paButton: (site: FrameLocator, label: string): Locator => site.locator('.cb-pa-bubble').getByRole('button', { name: label, exact: true }),
};
