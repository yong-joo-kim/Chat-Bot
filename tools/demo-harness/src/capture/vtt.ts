// WebVTT 자막 파일 생성(설계 §15 · ui-spec §4.3 "WebVTT 동기화") — 영상에는 자막이 번인되어 있고, 이 파일은 접근 가능한 텍스트 대안이다.
// 시각 = 화면에 자막이 실제로 표시된 시각 - 녹화 시작 시각(영상 앞부분의 대기 화면을 반영). 큐는 겹치지 않고 각 큐는 2.0초 이상이다.

export const MIN_CUE_MS = 2000;

export type CaptionKind = 'normal' | 'fallback';

export interface CaptionEvent {
  /** 에포크 ms(화면에 표시한 시각). */
  atMs: number;
  stepId: string;
  lines: string[];
  notice?: string;
  badges?: string[];
  /** [DT-2] 사실 칩(`GPU 사용` 등) — VTT에는 `NOTE 사실 칩:` 한 줄로 남긴다. */
  facts?: string[];
  kind?: CaptionKind;
}

interface TimelineItem {
  atMs: number;
  type: 'caption' | 'segment' | 'pause' | 'resume';
  caption?: CaptionEvent;
  note?: string;
}

export interface Cue {
  id: string;
  startMs: number;
  endMs: number;
  text: string[];
}

/** `HH:MM:SS.mmm` — WebVTT 시각 형식. */
export function formatVttTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const f = t % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(f, 3)}`;
}

/** 자막 표시·구간 시작·일시정지 이벤트를 모아 큐 목록과 VTT 문자열을 만든다. */
export class CaptionTimeline {
  private readonly items: TimelineItem[] = [];

  constructor(private readonly recStartMs: number) {}

  addSegment(atMs: number, chip: string, title: string): void {
    this.items.push({ atMs, type: 'segment', note: `${chip} ${title}` });
  }

  addCaption(e: CaptionEvent): void {
    this.items.push({ atMs: e.atMs, type: 'caption', caption: e });
  }

  /** 검증 통과 뒤 배지가 붙은 경우 — 같은 단계의 가장 최근 자막에 배지를 기록한다(새 큐를 만들지 않는다). */
  setBadges(stepId: string, badges: string[], facts: string[] = []): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const c = this.items[i].caption;
      if (this.items[i].type === 'caption' && c && c.stepId === stepId) {
        c.badges = badges;
        if (facts.length > 0) c.facts = facts;
        return;
      }
    }
  }

  /** [DT-2] 소리 설명 노트(영상에는 소리가 없다 — 예: `[합성 음성] …`). 시각은 에포크 ms. 큐를 만들지 않고 NOTE 블록으로만 낸다. */
  addSoundNote(atMs: number, text: string): void {
    this.items.push({ atMs, type: 'segment', note: `소리: ${text}` });
  }

  addPause(atMs: number): void {
    this.items.push({ atMs, type: 'pause' });
  }

  addResume(atMs: number): void {
    this.items.push({ atMs, type: 'resume' });
  }

  /** 겹치지 않는 큐 목록(시각은 녹화 시작 기준 ms). 일시정지는 "잠시 멈춤" 큐. */
  cues(endAtMs: number): Cue[] {
    const sorted = [...this.items].sort((a, b) => a.atMs - b.atMs);
    // 큐를 만드는 이벤트(자막 · 일시정지)만 뽑아 "다음 이벤트가 시작될 때까지" 유지한다(빈 시간 없음 — 자막이 이어짐)
    const makers = sorted.filter((i) => i.type === 'caption' || i.type === 'pause');
    const out: Cue[] = [];
    for (let i = 0; i < makers.length; i++) {
      const cur = makers[i];
      const next = makers[i + 1];
      let start = Math.max(0, cur.atMs - this.recStartMs);
      const prev = out[out.length - 1];
      if (prev && start < prev.endMs) start = prev.endMs;
      let end = (next ? next.atMs : endAtMs) - this.recStartMs;
      if (end - start < MIN_CUE_MS) end = start + MIN_CUE_MS;
      if (cur.type === 'pause') {
        out.push({ id: `pause-${out.length + 1}`, startMs: start, endMs: end, text: ['잠시 멈춤'] });
        continue;
      }
      const c = cur.caption!;
      const text = [...c.lines];
      if (c.notice) text.push(`[시연 안내] ${c.notice}`);
      out.push({ id: c.kind === 'fallback' ? `${c.stepId}-fallback` : c.stepId, startMs: start, endMs: end, text: text.slice(0, 3) });
    }
    return out;
  }

  /** WebVTT 전체 문자열(헤더 · 구간 NOTE · 큐). */
  build(endAtMs: number): string {
    const cues = this.cues(endAtMs);
    const sorted = [...this.items].sort((a, b) => a.atMs - b.atMs);
    const segments = sorted.filter((i) => i.type === 'segment');
    const lines: string[] = ['WEBVTT', 'Kind: captions', 'Language: ko', ''];
    let si = 0;
    for (const cue of cues) {
      // 이 큐가 시작하기 전(또는 같은 시각)에 시작한 구간의 NOTE 블록을 먼저 낸다
      while (si < segments.length && segments[si].atMs - this.recStartMs <= cue.startMs) {
        lines.push(`NOTE ${segments[si].note}`, '');
        si++;
      }
      const badges = this.badgeNote(cue.id);
      if (badges) lines.push(`NOTE 배지: ${badges}`, '');
      const facts = this.factNote(cue.id);
      if (facts) lines.push(`NOTE 사실 칩: ${facts}`, '');
      lines.push(cue.id, `${formatVttTime(cue.startMs)} --> ${formatVttTime(cue.endMs)}`, ...cue.text, '');
    }
    while (si < segments.length) {
      lines.push(`NOTE ${segments[si].note}`, '');
      si++;
    }
    return lines.join('\n');
  }

  private factNote(cueId: string): string | null {
    const e = this.items.find((i) => i.type === 'caption' && (i.caption!.kind === 'fallback' ? `${i.caption!.stepId}-fallback` : i.caption!.stepId) === cueId);
    const f = e?.caption?.facts;
    return f && f.length > 0 ? f.join(', ') : null;
  }

  private badgeNote(cueId: string): string | null {
    const e = this.items.find((i) => i.type === 'caption' && (i.caption!.kind === 'fallback' ? `${i.caption!.stepId}-fallback` : i.caption!.stepId) === cueId);
    const b = e?.caption?.badges;
    return b && b.length > 0 ? b.join(', ') : null;
  }
}
