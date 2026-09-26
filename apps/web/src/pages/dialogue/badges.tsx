import type { ConditionSummary, DialogNodeType, DialogOutputType, FaqCategory, HomonymPolicy } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';

/** 노드 목록/편집의 유형 배지(ui-spec §2.3). 텍스트+아이콘 병기(UIUX §1). */
export function NodeTypeBadge({ type }: { type: DialogNodeType }): JSX.Element {
  const config: Record<DialogNodeType, { icon: string; label: string; bg: string; fg: string }> = {
    NORMAL: { icon: '●', label: MESSAGES.dialogue.nodeForm.typeNormal, bg: '#F3F4F6', fg: '#374151' },
    START: { icon: '▶', label: MESSAGES.dialogue.nodeForm.typeStart, bg: '#DCFCE7', fg: '#166534' },
    FALLBACK: { icon: '⤺', label: MESSAGES.dialogue.nodeForm.typeFallback, bg: '#FEF3C7', fg: '#92400E' },
  };
  const cfg = config[type];
  return (
    <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <span aria-hidden="true">{cfg.icon}</span> {cfg.label}
    </span>
  );
}

export function MatchModeBadge({ mode }: { mode: 'ANY' | 'ALL' }): JSX.Element {
  const label = mode === 'ANY' ? MESSAGES.dialogue.nodeForm.matchModeAny : MESSAGES.dialogue.nodeForm.matchModeAll;
  return (
    <span className="dialogue-badge dialogue-badge--neutral" title={MESSAGES.dialogue.nodeForm.matchModeHelp}>
      {label}
    </span>
  );
}

export function HomonymPolicyBadge({ policy }: { policy: HomonymPolicy }): JSX.Element {
  const label =
    policy === 'ASK'
      ? MESSAGES.dialogue.homonyms.policyAsk
      : policy === 'DEFAULT_MEANING'
        ? MESSAGES.dialogue.homonyms.policyDefault
        : MESSAGES.dialogue.homonyms.policyIgnore;
  return <span className="dialogue-badge dialogue-badge--neutral">{label}</span>;
}

const FAQ_CATEGORY_COLORS: Record<FaqCategory, { bg: string; fg: string }> = {
  FAQ: { bg: '#DBEAFE', fg: '#1D4ED8' },
  SMALL_TALK: { bg: '#EDE9FE', fg: '#5B21B6' },
  SELF_SERVICE: { bg: '#DCFCE7', fg: '#166534' },
  ERROR_RESPONSE: { bg: '#FEE2E2', fg: '#991B1B' },
};

export function FaqCategoryBadge({ category }: { category: FaqCategory }): JSX.Element {
  const cfg = FAQ_CATEGORY_COLORS[category];
  return (
    <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      {MESSAGES.dialogue.faqs.categories[category]}
    </span>
  );
}

/** 이번 Phase에 정의만 하고 실행하지 않는 아웃풋(FR-5-15) 안내 배지. */
export function UnsupportedOutputBadge(): JSX.Element {
  return (
    <span className="dialogue-badge dialogue-badge--info">
      <span aria-hidden="true">ⓘ</span> {MESSAGES.dialogue.unsupportedOutputNotice}
    </span>
  );
}

/** 노드 목록 행의 조건 요약 칩(ui-spec §2.3). */
export function ConditionSummaryChips({ summary }: { summary: ConditionSummary }): JSX.Element {
  const hasAny = summary.intents.length > 0 || summary.keywords.length > 0 || summary.context;
  if (!hasAny) return <span className="field-hint">{MESSAGES.dialogue.nodes.conditionNone}</span>;
  return (
    <div className="condition-summary-chips">
      {summary.intents.map((r) => (
        <span key={r.id} className="condition-chip condition-chip--intent">
          의도: {r.name}
        </span>
      ))}
      {summary.keywords.map((r) => (
        <span key={r.id} className="condition-chip condition-chip--keyword">
          키워드: {r.name}
        </span>
      ))}
      {summary.context && (
        <span className="condition-chip condition-chip--context">컨텍스트: {summary.context.name}</span>
      )}
    </div>
  );
}

const OUTPUT_ICONS: Record<DialogOutputType, string> = {
  TEXT: '¶',
  CARD: '▭',
  IMAGE: '▨',
  BUTTON: '▦',
  LINK: '↗',
  PAUSE: '‖',
  PHONE_CALL: '☎',
  CONTEXT_FORM: '☰',
  DIALOG_MOVE: '↪',
  SCENARIO: '◈',
  SURVEY: '▥',
  API_CONDITION: '⇄',
  // [신규 No.41] 13번째 아웃풋 타입 아이콘 — "🔗 업무 요청"(ui-spec §3.8 `FlowPreviewPanel` 배지와 같은 아이콘).
  WORKFLOW: '🔗',
};

/** 노드 목록 행의 아웃풋 요약(아이콘+개수, ui-spec §2.3). */
export function OutputTypeIconList({ outputTypes }: { outputTypes: DialogOutputType[] }): JSX.Element {
  const counts = new Map<DialogOutputType, number>();
  outputTypes.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
  if (counts.size === 0) return <span className="field-hint">—</span>;
  return (
    <span className="output-type-icon-list">
      {[...counts.entries()].map(([type, n]) => (
        <span key={type} title={MESSAGES.dialogue.outputTypes[type]}>
          {OUTPUT_ICONS[type]}×{n}
        </span>
      ))}
    </span>
  );
}

/** 의도/키워드/컨텍스트 목록의 "노드 n건에서 사용 중" 배지. */
export function LinkedNodeCountBadge({ count }: { count: number }): JSX.Element {
  return (
    <span className={`dialogue-badge dialogue-badge--neutral${count === 0 ? ' dialogue-badge--dim' : ''}`}>
      {MESSAGES.dialogue.intents.linkedNodesCount(count)}
    </span>
  );
}
