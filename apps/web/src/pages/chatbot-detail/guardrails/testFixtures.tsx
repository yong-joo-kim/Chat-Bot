import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import type {
  ApprovalPolicyStatus,
  GuardrailEventItem,
  GuardrailOverview,
  GuardrailRule,
  GuardrailRuleListResponse,
  GuardrailSettingsResponse,
  ProdSwitchApprovalSummary,
} from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { makeChatbot } from '../../../test/fixtures';
import type { GuardrailContext, GuardrailShared } from './guardrailContext';

export const CHATBOT_ID = '22222222-2222-4222-8222-222222222222';
export const RULE_ID_1 = 'a0000000-0000-4000-8000-000000000001';
export const RULE_ID_2 = 'a0000000-0000-4000-8000-000000000002';
export const RULE_ID_3 = 'a0000000-0000-4000-8000-000000000003';
export const REQUEST_ID = 'b0000000-0000-4000-8000-000000000001';
export const VERSION_A = 'c0000000-0000-4000-8000-00000000000a';
export const VERSION_B = 'c0000000-0000-4000-8000-00000000000b';

export function makeRule(overrides: Partial<GuardrailRule> = {}): GuardrailRule {
  return {
    id: RULE_ID_1,
    chatbotId: CHATBOT_ID,
    name: '투자 권유',
    category: 'FINANCIAL_ADVICE',
    expressions: ['수익 보장', '원금 보장'],
    matchType: 'CONTAINS',
    appliesTo: 'OUTBOUND',
    action: 'MONITOR',
    replacementText: null,
    enabled: true,
    sortOrder: 0,
    expressionCount: 2,
    replacementBannedHit: false,
    recentHits7d: 12,
    updatedByEmail: 'admin@example.com',
    createdAt: new Date('2026-09-30T00:00:00.000Z'),
    updatedAt: new Date('2026-09-30T00:00:00.000Z'),
    ...overrides,
  };
}

export const RULES: GuardrailRule[] = [
  makeRule(),
  makeRule({ id: RULE_ID_2, name: '위기 표현', category: 'CRISIS_SELF_HARM', appliesTo: 'INBOUND', action: 'REPLACE', replacementText: '도움이 필요하시면 전문 기관에 연락해 주세요.', recentHits7d: 0, sortOrder: 1, replacementBannedHit: true }),
  makeRule({ id: RULE_ID_3, name: '지시 무시', category: 'PROMPT_INJECTION', appliesTo: 'INBOUND', action: 'NO_RAG', enabled: false, expressionCount: 4, recentHits7d: 0, sortOrder: 2 }),
];

export function makeMeta(overrides: Partial<GuardrailRuleListResponse['meta']> = {}): GuardrailRuleListResponse['meta'] {
  return {
    ragActive: true,
    serverEnabled: true,
    limits: { maxRules: 50, maxExpressions: 2000, usedRules: 3, usedExpressions: 18 },
    ...overrides,
  };
}

export function makeSettings(overrides: Partial<GuardrailSettingsResponse> = {}): GuardrailSettingsResponse {
  return { piiExit: { kinds: ['RRN', 'CARD'], preserveDates: true }, isDefault: true, governanceFloor: [], serverEnabled: true, ...overrides };
}

export function makeOverview(overrides: Partial<GuardrailOverview> = {}): GuardrailOverview {
  return {
    from: '2026-09-24',
    to: '2026-09-30',
    serverEnabled: true,
    totals: { inboundHits: 12, outboundHits: 8, replaced: 5, noRag: 2, monitored: 9, maskedAnswers: 14, errorFallbacks: 0 },
    rules: [
      { ruleId: RULE_ID_1, ruleName: '투자 권유', category: 'FINANCIAL_ADVICE', currentAction: 'MONITOR', currentEnabled: true, deleted: false, inboundHits: 0, outboundHits: 8, changedHits: 0 },
      { ruleId: 'deleted-rule', ruleName: '옛 규칙', category: 'OTHER', currentAction: null, currentEnabled: null, deleted: true, inboundHits: 3, outboundHits: 0, changedHits: 3 },
    ],
    pii: [{ kind: 'RRN', answers: 2, count: 3 }],
    rag: { delivered: 100, replaced: 5, masked: 14, fallbackOnError: 0, replacedRatio: 0.115 },
    alerts: [{ switchLogId: 'd0000000-0000-4000-8000-000000000001', at: new Date('2026-09-30T05:00:00.000Z'), actorEmail: 'kim@example.com', fromVersionNo: 13, toVersionNo: 12 }],
    hitl: { envModeOn: true, approvalRequired: true },
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<GuardrailEventItem> = {}): GuardrailEventItem {
  return {
    id: 'e0000000-0000-4000-8000-000000000001',
    createdAt: new Date('2026-09-30T05:02:00.000Z'),
    messageId: 'msg-1',
    stage: 'OUTBOUND',
    kind: 'RULE',
    ruleId: RULE_ID_1,
    ruleName: '투자 권유',
    category: 'FINANCIAL_ADVICE',
    ruleAction: 'MONITOR',
    appliedAction: 'MONITOR',
    decisive: true,
    effect: 'NONE',
    piiKind: null,
    piiCount: null,
    errorCode: null,
    conversation: { userMessage: '수익 보장되나요?', botResponse: '네, 수익을 보장합니다.', textPurged: false },
    ...overrides,
  };
}

export function makeApproval(overrides: Partial<ProdSwitchApprovalSummary> = {}): ProdSwitchApprovalSummary {
  return {
    id: REQUEST_ID,
    chatbotId: CHATBOT_ID,
    chatbotName: '주문 상담봇',
    action: 'PROD_SWITCH',
    status: 'PENDING',
    outcome: null,
    failureCode: null,
    closedReason: null,
    target: { versionId: VERSION_B, versionNo: 13 },
    base: { versionId: VERSION_A, versionNo: 12 },
    deployScheduleId: null,
    scheduledAt: null,
    gateVerdict: 'PASS',
    warningCodes: ['LEGACY_TIEBREAK', 'TOPIC_MISSING'],
    diffChangedCount: 14,
    reason: '10월 안내문 교체',
    decisionNote: null,
    requestedBy: { id: 'user-kim', email: 'kim@example.com', active: true },
    decidedBy: null,
    decidedAt: null,
    expiresAt: new Date(Date.now() + 23 * 3_600_000 + 12 * 60_000),
    createdAt: new Date('2026-09-30T05:02:00.000Z'),
    canApprove: true,
    canCancel: false,
    executedAt: null,
    ...overrides,
  };
}

export function makePolicyStatus(overrides: Partial<ApprovalPolicyStatus> = {}): ApprovalPolicyStatus {
  return {
    policy: { required: true, ttlHours: 24 },
    envModeOn: true,
    eligibleApproverCount: 3,
    otherApproverCount: 2,
    offLocked: false,
    pending: null,
    recent: [],
    ...overrides,
  };
}

interface RenderOptions {
  /** 라우트 패턴(기본 `/chatbots/:chatbotId/guardrails/rules`). */
  routePath?: string;
  /** 초기 URL. */
  url?: string;
  guardrail?: Partial<GuardrailShared>;
  chatbotStatus?: 'ACTIVE' | 'ARCHIVED';
  extraRoutes?: ReactNode;
}

/** 셸이 내려주는 Outlet context를 흉내 내어 하위 화면을 격리 렌더한다. */
export function renderGuardrailPage(element: ReactNode, opts: RenderOptions = {}): ReturnType<typeof render> & { context: GuardrailContext } {
  const { routePath = '/chatbots/:chatbotId/guardrails/rules', url, guardrail, chatbotStatus = 'ACTIVE', extraRoutes } = opts;
  const context = {
    chatbot: makeChatbot({ id: CHATBOT_ID, status: chatbotStatus }),
    reload: async () => undefined,
    setUnsavedGuard: () => undefined,
    learningSummary: null,
    refreshLearningSummary: () => undefined,
    environmentStatus: null,
    refreshEnvironmentStatus: () => undefined,
    workflowAttention: null,
    guardrail: {
      rules: RULES,
      meta: makeMeta(),
      loading: false,
      error: false,
      reload: async () => undefined,
      setRules: () => undefined,
      canWrite: true,
      ...guardrail,
    },
  } as unknown as GuardrailContext;
  const initial = url ?? routePath.replace(':chatbotId', CHATBOT_ID).replace(':ruleId', RULE_ID_1);
  const result = render(
    <MemoryRouter initialEntries={[initial]}>
      <ToastProvider>
        <Routes>
          <Route element={<Outlet context={context} />}>
            <Route path={routePath} element={element} />
          </Route>
          {extraRoutes}
          <Route path="*" element={<p>다른 화면</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
  return { ...result, context };
}
