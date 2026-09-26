import type { ButtonItem, DialogOutput, DialogOutputType } from './dialogue';

/**
 * [신규 No.46] 채널 강등 순수 함수 — **zod 무의존**(RM-4). `api`(어댑터·인박스 시뮬레이션)와
 * 콘솔(채널별 미리보기·저장 경고)이 공유한다. 위젯은 import하지 않는다(서버가 강등 — R-8).
 * `channel-rich-messages-설계.md` §7 — 3단 사다리(원형 → 대체 컴포넌트 → 텍스트).
 */

export const OUTPUT_PROFILE_SOURCES = ['MEASURED', 'ASSUMED', 'DEFAULT'] as const;
export type OutputProfileSource = (typeof OUTPUT_PROFILE_SOURCES)[number];

export interface ChannelOutputProfile {
  readonly source: OutputProfileSource;
  /** 표시 지원 타입(항상 `TEXT` 포함 — 불변식 I-6). */
  readonly types: readonly DialogOutputType[];
  readonly carouselMaxCards: number;
  readonly carouselCardMaxButtons: number;
  /** 기존 `CARD`용(캐러셀 카드와 분리 — R-4). */
  readonly cardMaxButtons: number;
  readonly quickReply: { readonly supported: boolean; readonly max: number };
  readonly buttonActions: readonly ('MESSAGE' | 'LINK' | 'NODE')[];
  /** 카드·캐러셀 카드 이미지(`IMAGE` 아웃풋 자체는 `types`로 판정). */
  readonly image: boolean;
  readonly textLimits: { readonly title: number; readonly description: number; readonly buttonLabel: number };
}

export const DEGRADE_CHANGE_KINDS = [
  'CAROUSEL_TO_CARDS',
  'CAROUSEL_TO_TEXT',
  'CARDS_TRUNCATED',
  'BUTTONS_TRUNCATED',
  'QUICK_REPLY_TO_BUTTON',
  'BUTTON_TO_TEXT',
  'OUTPUT_TO_TEXT',
  'OUTPUT_REMOVED',
  'IMAGE_REMOVED',
  'TEXT_TRUNCATED',
  'ACTION_LOST',
] as const;
export type DegradeChangeKind = (typeof DEGRADE_CHANGE_KINDS)[number];

export interface DegradeChange {
  outputIndex: number;
  kind: DegradeChangeKind;
  detail?: string;
}

export interface DegradeResult {
  outputs: DialogOutput[];
  changes: DegradeChange[];
}

/** `TextOutputPayloadSchema` 상한과 같다. */
export const DEGRADE_TEXT_MAX = 1000;

function truncateChars(s: string, max: number): { text: string; truncated: boolean } {
  const chars = Array.from(s);
  if (chars.length <= max) return { text: s, truncated: false };
  const sliced = chars.slice(0, Math.max(0, max - 1)).join('');
  return { text: `${sliced}…`, truncated: true };
}

function changeKey(outputIndex: number, kind: DegradeChangeKind, detail?: string): string {
  return `${outputIndex}|${kind}|${detail ?? ''}`;
}

function pushChange(changes: DegradeChange[], seen: Set<string>, outputIndex: number, kind: DegradeChangeKind, detail?: string): void {
  const key = changeKey(outputIndex, kind, detail);
  if (seen.has(key)) return;
  seen.add(key);
  changes.push(detail !== undefined ? { outputIndex, kind, detail } : { outputIndex, kind });
}

interface ButtonProcessOptions {
  maxButtons?: number;
  actions: readonly ('MESSAGE' | 'LINK' | 'NODE')[];
  labelLimit: number;
}

function processButtons(
  buttons: readonly ButtonItem[],
  opts: ButtonProcessOptions,
  outputIndex: number,
  changes: DegradeChange[],
  seen: Set<string>,
): { buttons: ButtonItem[]; changed: boolean } {
  let changed = false;
  let working: readonly ButtonItem[] = buttons;

  if (opts.maxButtons !== undefined && working.length > opts.maxButtons) {
    const before = working.length;
    working = working.slice(0, opts.maxButtons);
    changed = true;
    pushChange(changes, seen, outputIndex, 'BUTTONS_TRUNCATED', `${before}→${opts.maxButtons}`);
  }

  const filtered: ButtonItem[] = [];
  for (const b of working) {
    if (!opts.actions.includes(b.action)) {
      changed = true;
      pushChange(changes, seen, outputIndex, 'ACTION_LOST', b.action);
      continue;
    }
    filtered.push(b);
  }

  const relabeled = filtered.map((b) => {
    const { text, truncated } = truncateChars(b.label, opts.labelLimit);
    if (!truncated) return b;
    changed = true;
    pushChange(changes, seen, outputIndex, 'TEXT_TRUNCATED', 'buttonLabel');
    return { ...b, label: text };
  });

  return { buttons: changed ? relabeled : (buttons as ButtonItem[]), changed };
}

interface CardLikePayload {
  title: string;
  description?: string;
  imageUrl?: string;
  altText?: string;
  buttons?: ButtonItem[];
}

interface CardProcessOptions {
  maxButtons: number;
  actions: readonly ('MESSAGE' | 'LINK' | 'NODE')[];
  image: boolean;
  textLimits: ChannelOutputProfile['textLimits'];
}

function processCardLike<T extends CardLikePayload>(
  card: T,
  opts: CardProcessOptions,
  outputIndex: number,
  changes: DegradeChange[],
  seen: Set<string>,
): { card: T; changed: boolean } {
  let changed = false;
  let title = card.title;
  let description = card.description;
  let imageUrl = card.imageUrl;
  let altText = card.altText;
  let buttons = card.buttons;

  if (card.buttons && card.buttons.length > 0) {
    const result = processButtons(card.buttons, { maxButtons: opts.maxButtons, actions: opts.actions, labelLimit: opts.textLimits.buttonLabel }, outputIndex, changes, seen);
    if (result.changed) {
      changed = true;
      buttons = result.buttons.length > 0 ? result.buttons : undefined;
    }
  }

  if (imageUrl && !opts.image) {
    changed = true;
    pushChange(changes, seen, outputIndex, 'IMAGE_REMOVED');
    const prefix = `[이미지: ${altText ?? ''}] `;
    description = `${prefix}${description ?? ''}`;
    imageUrl = undefined;
    altText = undefined;
  }

  const titleResult = truncateChars(title, opts.textLimits.title);
  if (titleResult.truncated) {
    changed = true;
    pushChange(changes, seen, outputIndex, 'TEXT_TRUNCATED', 'title');
    title = titleResult.text;
  }

  if (description !== undefined) {
    const descResult = truncateChars(description, opts.textLimits.description);
    if (descResult.truncated) {
      changed = true;
      pushChange(changes, seen, outputIndex, 'TEXT_TRUNCATED', 'description');
      description = descResult.text;
    }
  }

  if (!changed) return { card, changed: false };

  const next = {
    ...card,
    title,
    ...(description !== undefined ? { description } : {}),
    ...(imageUrl !== undefined ? { imageUrl } : { imageUrl: undefined }),
    ...(altText !== undefined ? { altText } : { altText: undefined }),
    buttons,
  } as T;
  return { card: next, changed: true };
}

function degradeCarousel(
  o: Extract<DialogOutput, { type: 'CAROUSEL' }>,
  profile: ChannelOutputProfile,
  index: number,
  changes: DegradeChange[],
  seen: Set<string>,
): DialogOutput | DialogOutput[] {
  const payload = o.payload;

  if (profile.types.includes('CAROUSEL')) {
    let cards = payload.cards;
    let changed = false;
    if (cards.length > profile.carouselMaxCards) {
      const before = cards.length;
      cards = cards.slice(0, profile.carouselMaxCards);
      changed = true;
      pushChange(changes, seen, index, 'CARDS_TRUNCATED', `${before}→${profile.carouselMaxCards}`);
    }
    const newCards = cards.map((c) => {
      const r = processCardLike(c, { maxButtons: profile.carouselCardMaxButtons, actions: profile.buttonActions, image: profile.image, textLimits: profile.textLimits }, index, changes, seen);
      if (r.changed) changed = true;
      return r.card;
    });
    if (!changed) return o;
    return { type: 'CAROUSEL', payload: { version: 1, ...(payload.text !== undefined ? { text: payload.text } : {}), cards: newCards } };
  }

  if (profile.types.includes('CARD')) {
    // 카드 수 제한 없음(EX-RM-12) — 원래 카드 수와 결과 CARD 수는 항상 같다. 그래도
    // `CARDS_TRUNCATED`(같은 outputIndex)와 구분되도록 `${from}→${to}` 형식을 싣는다(콘솔 "카드 N장 중 앞 M장만 보입니다" 문구용).
    const cardCount = payload.cards.length;
    pushChange(changes, seen, index, 'CAROUSEL_TO_CARDS', `${cardCount}→${cardCount}`);
    const out: DialogOutput[] = [];
    if (payload.text) out.push({ type: 'TEXT', payload: { text: payload.text } });
    for (const c of payload.cards) {
      const r = processCardLike(c, { maxButtons: profile.cardMaxButtons, actions: profile.buttonActions, image: profile.image, textLimits: profile.textLimits }, index, changes, seen);
      out.push({ type: 'CARD', payload: r.card });
    }
    return out;
  }

  // ③ 텍스트 단계
  pushChange(changes, seen, index, 'CAROUSEL_TO_TEXT');
  const lines: string[] = [];
  if (payload.text) lines.push(payload.text);
  let hadImage = false;
  let hadNode = false;
  payload.cards.forEach((c, i) => {
    const descPreview = c.description !== undefined ? truncateChars(c.description, 50).text : undefined;
    lines.push(`${i + 1}) ${c.title}${descPreview !== undefined ? ` — ${descPreview}` : ''}`);
    if (c.imageUrl) hadImage = true;
    for (const b of c.buttons ?? []) {
      if (b.action === 'LINK') lines.push(`   ${b.label}: ${b.value}`);
      else if (b.action === 'MESSAGE') lines.push(`   · ${b.label}`);
      else hadNode = true;
    }
  });
  if (hadImage) pushChange(changes, seen, index, 'IMAGE_REMOVED');
  if (hadNode) pushChange(changes, seen, index, 'ACTION_LOST', 'NODE');
  const { text, truncated } = truncateChars(lines.join('\n'), DEGRADE_TEXT_MAX);
  if (truncated) pushChange(changes, seen, index, 'TEXT_TRUNCATED');
  return { type: 'TEXT', payload: { text } };
}

function degradeQuickReplyButton(
  o: Extract<DialogOutput, { type: 'BUTTON' }>,
  profile: ChannelOutputProfile,
  index: number,
  changes: DegradeChange[],
  seen: Set<string>,
): DialogOutput | null {
  const payload = o.payload;

  if (profile.quickReply.supported) {
    const r = processButtons(payload.buttons, { maxButtons: profile.quickReply.max, actions: profile.buttonActions, labelLimit: profile.textLimits.buttonLabel }, index, changes, seen);
    if (!r.changed) return o;
    return { type: 'BUTTON', payload: { ...payload, buttons: r.buttons } };
  }

  if (profile.types.includes('BUTTON')) {
    pushChange(changes, seen, index, 'QUICK_REPLY_TO_BUTTON');
    const { display: _display, ...rest } = payload;
    const r = processButtons(rest.buttons, { actions: profile.buttonActions, labelLimit: profile.textLimits.buttonLabel }, index, changes, seen);
    return { type: 'BUTTON', payload: { ...rest, buttons: r.buttons } };
  }

  // ③ 텍스트 단계
  pushChange(changes, seen, index, 'BUTTON_TO_TEXT');
  const lines: string[] = [];
  if (payload.text) lines.push(payload.text);
  const messageLabels = payload.buttons.filter((b) => b.action === 'MESSAGE').map((b) => b.label);
  if (payload.buttons.some((b) => b.action === 'NODE')) pushChange(changes, seen, index, 'ACTION_LOST', 'NODE');
  if (messageLabels.length > 0) lines.push(`다음 중 입력해 주세요: ${messageLabels.join(' / ')}`);
  if (lines.length === 0) {
    pushChange(changes, seen, index, 'OUTPUT_REMOVED');
    return null;
  }
  return { type: 'TEXT', payload: { text: lines.join('\n') } };
}

function degradeButton(
  o: Extract<DialogOutput, { type: 'BUTTON' }>,
  profile: ChannelOutputProfile,
  index: number,
  changes: DegradeChange[],
  seen: Set<string>,
): DialogOutput | null {
  const payload = o.payload;

  if (profile.types.includes('BUTTON')) {
    const r = processButtons(payload.buttons, { actions: profile.buttonActions, labelLimit: profile.textLimits.buttonLabel }, index, changes, seen);
    if (!r.changed) return o;
    if (r.buttons.length === 0) {
      pushChange(changes, seen, index, 'BUTTON_TO_TEXT');
      if (payload.text) return { type: 'TEXT', payload: { text: payload.text } };
      pushChange(changes, seen, index, 'OUTPUT_REMOVED');
      return null;
    }
    return { type: 'BUTTON', payload: { ...payload, buttons: r.buttons } };
  }

  pushChange(changes, seen, index, 'BUTTON_TO_TEXT');
  pushChange(changes, seen, index, 'ACTION_LOST', 'BUTTONS');
  return { type: 'TEXT', payload: { text: payload.text ? `[버튼] ${payload.text}` : '[버튼]' } };
}

function degradeCard(
  o: Extract<DialogOutput, { type: 'CARD' }>,
  profile: ChannelOutputProfile,
  index: number,
  changes: DegradeChange[],
  seen: Set<string>,
): DialogOutput {
  const payload = o.payload;
  if (profile.types.includes('CARD')) {
    const r = processCardLike(payload, { maxButtons: profile.cardMaxButtons, actions: profile.buttonActions, image: profile.image, textLimits: profile.textLimits }, index, changes, seen);
    return r.changed ? { type: 'CARD', payload: r.card } : o;
  }
  pushChange(changes, seen, index, 'OUTPUT_TO_TEXT', 'CARD');
  if (payload.imageUrl) pushChange(changes, seen, index, 'IMAGE_REMOVED');
  if ((payload.buttons ?? []).some((b) => b.action === 'LINK' || b.action === 'NODE')) {
    pushChange(changes, seen, index, 'ACTION_LOST');
  }
  return { type: 'TEXT', payload: { text: `[카드] ${payload.title}` } };
}

function degradeImage(o: Extract<DialogOutput, { type: 'IMAGE' }>, profile: ChannelOutputProfile, index: number, changes: DegradeChange[], seen: Set<string>): DialogOutput {
  if (profile.types.includes('IMAGE')) return o;
  pushChange(changes, seen, index, 'OUTPUT_TO_TEXT', 'IMAGE');
  pushChange(changes, seen, index, 'IMAGE_REMOVED');
  return { type: 'TEXT', payload: { text: `[이미지] ${o.payload.altText}` } };
}

function degradeLink(o: Extract<DialogOutput, { type: 'LINK' }>, profile: ChannelOutputProfile, index: number, changes: DegradeChange[], seen: Set<string>): DialogOutput {
  if (profile.types.includes('LINK')) {
    const { text: label, truncated } = truncateChars(o.payload.label, profile.textLimits.buttonLabel);
    if (!truncated) return o;
    pushChange(changes, seen, index, 'TEXT_TRUNCATED', 'buttonLabel');
    return { type: 'LINK', payload: { ...o.payload, label } };
  }
  pushChange(changes, seen, index, 'OUTPUT_TO_TEXT', 'LINK');
  pushChange(changes, seen, index, 'ACTION_LOST', 'LINK');
  return { type: 'TEXT', payload: { text: `[링크] ${o.payload.label}` } };
}

function degradePhoneCall(o: Extract<DialogOutput, { type: 'PHONE_CALL' }>, profile: ChannelOutputProfile, index: number, changes: DegradeChange[], seen: Set<string>): DialogOutput {
  if (profile.types.includes('PHONE_CALL')) return o;
  pushChange(changes, seen, index, 'OUTPUT_TO_TEXT', 'PHONE_CALL');
  pushChange(changes, seen, index, 'ACTION_LOST', 'PHONE');
  return { type: 'TEXT', payload: { text: `[전화] ${o.payload.label}` } };
}

function degradePause(o: Extract<DialogOutput, { type: 'PAUSE' }>, profile: ChannelOutputProfile, index: number, changes: DegradeChange[], seen: Set<string>): DialogOutput | null {
  if (profile.types.includes('PAUSE')) return o;
  pushChange(changes, seen, index, 'OUTPUT_REMOVED');
  return null;
}

function degradeUnsupported(index: number, changes: DegradeChange[], seen: Set<string>): DialogOutput {
  pushChange(changes, seen, index, 'OUTPUT_TO_TEXT');
  return { type: 'TEXT', payload: { text: '[지원하지 않는 응답]' } };
}

function degradeOne(o: DialogOutput, profile: ChannelOutputProfile, index: number, changes: DegradeChange[], seen: Set<string>): DialogOutput | DialogOutput[] | null {
  switch (o.type) {
    case 'TEXT':
      return o;
    case 'CAROUSEL':
      return degradeCarousel(o, profile, index, changes, seen);
    case 'BUTTON':
      return o.payload.display === 'QUICK_REPLY' ? degradeQuickReplyButton(o, profile, index, changes, seen) : degradeButton(o, profile, index, changes, seen);
    case 'CARD':
      return degradeCard(o, profile, index, changes, seen);
    case 'IMAGE':
      return degradeImage(o, profile, index, changes, seen);
    case 'LINK':
      return degradeLink(o, profile, index, changes, seen);
    case 'PHONE_CALL':
      return degradePhoneCall(o, profile, index, changes, seen);
    case 'PAUSE':
      return degradePause(o, profile, index, changes, seen);
    case 'CONTEXT_FORM':
    case 'DIALOG_MOVE':
    case 'SCENARIO':
    case 'SURVEY':
    case 'API_CONDITION':
    case 'WORKFLOW':
      return degradeUnsupported(index, changes, seen);
    default: {
      const unreachable: never = o;
      return unreachable;
    }
  }
}

/**
 * 3단 사다리 강등(FR-RM4-1). 예외를 던지지 않는다(NFR-RMR3) · 바뀌지 않은 아웃풋은 입력과 같은
 * 참조를 돌려준다(I-2) · 결과는 항상 `DialogOutputSchema`를 통과한다(I-1, 이 함수는 zod 무의존이라
 * 직접 검증하지 않지만 사다리 규칙이 스키마 한도 안에서만 값을 만든다).
 */
export function degradeForProfile(outputs: readonly DialogOutput[], profile: ChannelOutputProfile): DegradeResult {
  const changes: DegradeChange[] = [];
  const seen = new Set<string>();
  const resultOutputs: DialogOutput[] = [];
  outputs.forEach((o, index) => {
    const r = degradeOne(o, profile, index, changes, seen);
    if (r === null) return;
    if (Array.isArray(r)) resultOutputs.push(...r);
    else resultOutputs.push(r);
  });
  return { outputs: resultOutputs, changes };
}
