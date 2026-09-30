import type { Harness } from './ai-guardrails.harness';

/**
 * 운영 전환 2인 승인 통합 시험 공용 준비 함수 — 챗봇 · 환경 모드 켜기 · v1(운영) · v2(스테이징) · 승인 정책 켜기.
 */
export interface ApprovalBot {
  id: string;
  slug: string;
  keyword: string;
  nodeId: string;
  v1Id: string;
  v2Id: string;
}

export async function enableEnvironment(h: Harness, chatbotId: string): Promise<{ prodVersionId: string }> {
  const preview = await h.admin<{ draftContentHash: string }>('POST', `/chatbots/${chatbotId}/environment/enable/preview`);
  if (preview.status !== 200) throw new Error(`enable/preview 실패: ${preview.status}`);
  const res = await h.admin<{ prod: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/enable`, { expectedDraftHash: preview.body.draftContentHash });
  if (res.status !== 201) throw new Error(`enable 실패: ${res.status} ${JSON.stringify(res.body)}`);
  return { prodVersionId: res.body.prod.versionId };
}

export async function setNodeText(h: Harness, chatbotId: string, nodeId: string, text: string): Promise<void> {
  const res = await h.admin('PATCH', `/chatbots/${chatbotId}/dialog-nodes/${nodeId}`, { outputs: [{ type: 'TEXT', payload: { text } }] });
  if (res.status !== 200) throw new Error(`노드 수정 실패: ${res.status}`);
}

/** 초안 편집 → 스테이징 승격 → 승격된 버전 id. */
export async function promoteStaging(h: Harness, chatbotId: string): Promise<string> {
  const status = await h.admin<{ staging: { versionId: string } | null }>('GET', `/chatbots/${chatbotId}/environment`);
  const promoted = await h.admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
    expectedStagingVersionId: status.body.staging?.versionId ?? null,
  });
  if (promoted.status !== 201 && promoted.status !== 200) throw new Error(`promote 실패: ${promoted.status} ${JSON.stringify(promoted.body)}`);
  return promoted.body.staging.versionId;
}

export async function setupApprovalBot(h: Harness, prefix: string, opts: { policy?: boolean } = {}): Promise<ApprovalBot> {
  const bot = await h.createChatbot(prefix);
  const keyword = `승인키워드${bot.id.slice(0, 6)}`;
  const kw = await h.admin<{ id: string }>('POST', `/chatbots/${bot.id}/keywords`, { name: keyword, synonyms: [] });
  const node = await h.admin<{ id: string }>('POST', `/chatbots/${bot.id}/dialog-nodes`, { name: '응답', nodeType: 'NORMAL', keywordIds: [kw.body.id], outputs: [{ type: 'TEXT', payload: { text: '응답-v1' } }] });
  const { prodVersionId: v1Id } = await enableEnvironment(h, bot.id);
  await setNodeText(h, bot.id, node.body.id, '응답-v2');
  const v2Id = await promoteStaging(h, bot.id);
  if (opts.policy !== false) {
    const on = await h.admin('PUT', `/chatbots/${bot.id}/environment/approval`, { required: true, ttlHours: 24 });
    if (on.status !== 200) throw new Error(`정책 켜기 실패: ${on.status} ${JSON.stringify(on.body)}`);
  }
  return { ...bot, keyword, nodeId: node.body.id, v1Id, v2Id };
}

/** 미리보기 → 요청 본문(전환). */
export async function switchRequestBody(h: Harness, chatbotId: string, targetVersionId: string, kind: 'SWITCH' | 'ROLLBACK' = 'SWITCH'): Promise<Record<string, unknown>> {
  const preview = await h.admin<{ expectedProdVersionId: string; warnings: unknown[] }>('POST', `/chatbots/${chatbotId}/environment/prod/preview`, { kind, targetVersionId });
  return {
    action: kind === 'SWITCH' ? 'PROD_SWITCH' : 'PROD_ROLLBACK',
    targetVersionId,
    expectedProdVersionId: preview.body.expectedProdVersionId,
    acknowledgeWarnings: true,
  };
}
