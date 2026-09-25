import { normalizeText } from '@chat-bot/shared-types';
import type { DesignIssue, DesignIssueCode, DialogueBundle } from '@chat-bot/shared-types';
import { TOPIC_LIMITS, TOPIC_FILTER_COMMON } from '@chat-bot/shared-types';
import { collectAssetRefs } from '../../dialogue-common/lib/asset-ref-graph';
import type { AssetRef, AssetRefKind } from '../../dialogue-common/lib/asset-ref-graph';

/**
 * 토픽 점검 규칙 4종(topic-system-설계.md §7.2) — API 계층 순수 함수. 엔진 결과 **뒤에** 합친다
 * (`dialog-nodes.service.ts` `validate()`). DB·Nest 무의존.
 */

export interface TopicRow {
  id: string;
  name: string;
  enabled: boolean;
}

export const ENTRY_POINT_KINDS = new Set<AssetRefKind>(['NODE', 'INTENT', 'FAQ']);

/** 규칙 ①의 대상 간선(topic-system-설계.md §7.2 표) — `topic-impact.ts`가 재사용한다. */
export const INACTIVE_REF_EDGES = new Set(['NODE_INTENT', 'NODE_MOVE', 'NODE_BUTTON', 'NODE_API_BRANCH', 'NODE_SURVEY_COMPLETE', 'HOMONYM_INTENT', 'HANDOFF_END_BUTTON']);
/** 설문 간선은 규칙 ②에서 제외한다(설문은 토픽 비소속). */
const SURVEY_EDGES = new Set(['NODE_SURVEY', 'NODE_SURVEY_COMPLETE']);

function refKindToResourceType(kind: AssetRefKind): DesignIssue['resourceType'] | null {
  switch (kind) {
    case 'NODE':
      return 'NODE';
    case 'INTENT':
      return 'INTENT';
    case 'KEYWORD':
      return 'KEYWORD';
    case 'CONTEXT':
      return 'CONTEXT';
    case 'FAQ':
      return 'FAQ';
    case 'HOMONYM':
      return 'HOMONYM';
    default:
      // SURVEY · HANDOFF_SETTING은 resourceType 유니온 밖이다 — 이 규칙의 "출발 자산" 보고 대상이 아니다.
      return null;
  }
}

export interface EntityInfo {
  kind: AssetRefKind;
  id: string;
  name: string;
  topicId: string | null;
}

export function buildEntityIndex(bundle: DialogueBundle): Map<string, EntityInfo> {
  const index = new Map<string, EntityInfo>();
  for (const i of bundle.intents) index.set(i.id, { kind: 'INTENT', id: i.id, name: i.name, topicId: i.topicId ?? null });
  for (const k of bundle.keywords) index.set(k.id, { kind: 'KEYWORD', id: k.id, name: k.name, topicId: k.topicId ?? null });
  for (const h of bundle.homonyms) index.set(h.id, { kind: 'HOMONYM', id: h.id, name: h.word, topicId: h.topicId ?? null });
  for (const c of bundle.contexts) index.set(c.id, { kind: 'CONTEXT', id: c.id, name: c.name, topicId: c.topicId ?? null });
  for (const n of bundle.dialogNodes) index.set(n.id, { kind: 'NODE', id: n.id, name: n.name, topicId: n.topicId ?? null });
  for (const f of bundle.faqs) index.set(f.id, { kind: 'FAQ', id: f.id, name: f.question, topicId: f.topicId ?? null });
  for (const s of bundle.surveys ?? []) index.set(s.id, { kind: 'SURVEY', id: s.id, name: s.name, topicId: null });
  return index;
}

export function topicLabel(topicId: string | null, topicMap: Map<string, TopicRow>): { name: string; enabled: boolean } {
  if (!topicId) return { name: '공통', enabled: true };
  const t = topicMap.get(topicId);
  return t ? { name: t.name, enabled: t.enabled } : { name: '삭제된 토픽', enabled: false };
}

function truncateTop<T>(items: T[], sortFn: (a: T, b: T) => number, limit: number): { items: T[]; total: number } {
  const sorted = [...items].sort(sortFn);
  return { items: sorted.slice(0, limit), total: sorted.length };
}

export function validateTopicBoundaries(
  bundle: DialogueBundle,
  topics: readonly TopicRow[],
  ctx: { handoffEndButtonNodeId?: string | null } = {},
): { issues: DesignIssue[]; ruleTotals?: Partial<Record<DesignIssueCode, number>> } {
  if (topics.length === 0) return { issues: [] };

  const topicMap = new Map(topics.map((t) => [t.id, t]));
  const entities = buildEntityIndex(bundle);
  const refs = collectAssetRefs(bundle, { handoffEndButtonNodeId: ctx.handoffEndButtonNodeId });

  const isLive = (topicId: string | null): boolean => !topicId || (topicMap.get(topicId)?.enabled ?? false);

  const ruleTotals: Partial<Record<DesignIssueCode, number>> = {};
  const issues: DesignIssue[] = [];

  // ① INACTIVE_TOPIC_REFERENCE — live 범위 → 비활성 토픽 진입점
  const rule1: DesignIssue[] = [];
  const rule1Keys = new Set<string>(); // ②에서 제외할 (from,to,edge) 키
  for (const ref of refs) {
    if (!INACTIVE_REF_EDGES.has(ref.edge)) continue;
    const from = entities.get(ref.fromId);
    const to = entities.get(ref.toId);
    if (!from || !to) continue;
    if (!ENTRY_POINT_KINDS.has(to.kind)) continue;
    if (!isLive(from.topicId)) continue; // 출발이 live 범위여야 한다
    if (isLive(to.topicId)) continue; // 도착이 비활성 토픽이어야 한다
    const fromResourceType = refKindToResourceType(from.kind);
    if (!fromResourceType) continue;
    const fromTopic = topicLabel(from.topicId, topicMap);
    const toTopic = topicLabel(to.topicId, topicMap);
    rule1Keys.add(`${ref.fromId}::${ref.toId}::${ref.edge}`);
    rule1.push({
      code: 'INACTIVE_TOPIC_REFERENCE',
      severity: 'WARNING',
      resourceType: fromResourceType,
      resourceId: from.id,
      resourceName: from.name,
      message: `${from.name}(${fromTopic.name}) → ${to.name}(${toTopic.name} · 비활성)`,
      topicRef: {
        edge: ref.edge,
        sourceTopicName: fromTopic.name,
        targetResourceType: to.kind,
        targetResourceId: to.id,
        targetResourceName: to.name,
        targetTopicId: to.topicId,
        targetTopicName: toTopic.name,
      },
    });
  }
  const rule1Top = truncateTop(rule1, (a, b) => (a.resourceName ?? '').localeCompare(b.resourceName ?? ''), TOPIC_LIMITS.boundaryIssuesPerRule);
  if (rule1Top.total > rule1Top.items.length) ruleTotals.INACTIVE_TOPIC_REFERENCE = rule1Top.total;
  issues.push(...rule1Top.items);

  // ② CROSS_TOPIC_REFERENCE — 서로 다른 토픽 키 · 도착이 공통 아님 · ①로 보고되지 않은 간선 · 설문 간선 제외
  const rule2: DesignIssue[] = [];
  for (const ref of refs) {
    if (SURVEY_EDGES.has(ref.edge)) continue;
    if (rule1Keys.has(`${ref.fromId}::${ref.toId}::${ref.edge}`)) continue;
    const from = entities.get(ref.fromId);
    const to = entities.get(ref.toId);
    if (!from || !to) continue;
    const fromKey = from.topicId ?? TOPIC_FILTER_COMMON;
    const toKey = to.topicId ?? TOPIC_FILTER_COMMON;
    if (fromKey === toKey) continue;
    if (toKey === TOPIC_FILTER_COMMON) continue;
    const fromResourceType = refKindToResourceType(from.kind);
    if (!fromResourceType) continue;
    const fromTopic = topicLabel(from.topicId, topicMap);
    const toTopic = topicLabel(to.topicId, topicMap);
    rule2.push({
      code: 'CROSS_TOPIC_REFERENCE',
      severity: 'INFO',
      resourceType: fromResourceType,
      resourceId: from.id,
      resourceName: from.name,
      message: `${from.name}(${fromTopic.name}) → ${to.name}(${toTopic.name})`,
      topicRef: {
        edge: ref.edge,
        sourceTopicName: fromTopic.name,
        targetResourceType: to.kind,
        targetResourceId: to.id,
        targetResourceName: to.name,
        targetTopicId: to.topicId,
        targetTopicName: toTopic.name,
      },
    });
  }
  const rule2Top = truncateTop(rule2, (a, b) => (a.resourceName ?? '').localeCompare(b.resourceName ?? ''), TOPIC_LIMITS.boundaryIssuesPerRule);
  if (rule2Top.total > rule2Top.items.length) ruleTotals.CROSS_TOPIC_REFERENCE = rule2Top.total;
  issues.push(...rule2Top.items);

  // ③ CROSS_TOPIC_DUPLICATE_EXAMPLE — 정규화 예문 1개를 토픽 키가 다른 두 의도가 가짐
  const byExample = new Map<string, Array<{ id: string; name: string; topicId: string | null }>>();
  for (const intent of bundle.intents) {
    for (const example of intent.examples) {
      const key = normalizeText(example);
      const list = byExample.get(key) ?? [];
      list.push({ id: intent.id, name: intent.name, topicId: intent.topicId ?? null });
      byExample.set(key, list);
    }
  }
  const rule3: DesignIssue[] = [];
  const seenPairs = new Set<string>();
  for (const [, owners] of byExample) {
    for (let a = 0; a < owners.length; a += 1) {
      for (let b = a + 1; b < owners.length; b += 1) {
        const oa = owners[a];
        const ob = owners[b];
        const keyA = oa.topicId ?? TOPIC_FILTER_COMMON;
        const keyB = ob.topicId ?? TOPIC_FILTER_COMMON;
        if (keyA === keyB) continue; // 같은 키끼리는 기존 저장 경고 영역
        const pairKey = [oa.id, ob.id].sort().join('::');
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        const topicA = topicLabel(oa.topicId, topicMap);
        const topicB = topicLabel(ob.topicId, topicMap);
        rule3.push({
          code: 'CROSS_TOPIC_DUPLICATE_EXAMPLE',
          severity: 'INFO',
          resourceType: 'INTENT',
          resourceId: oa.id,
          resourceName: oa.name,
          message: `'${oa.name}'(${topicA.name})와(과) '${ob.name}'(${topicB.name})의 예문이 중복됩니다.`,
          topicRef: {
            // [L-2 코드리뷰 대응] 이 관계는 노드→의도 참조가 아니라 의도↔의도 예문 중복(파생 분석
            // 결과)이다 — `NODE_INTENT`(실제 그래프 간선, `TopicRefEdge`)를 재사용하면 프런트가 "노드→
            // 의도" 아이콘/링크로 잘못 그릴 수 있어 전용 값을 쓴다. `DesignIssueTopicRefSchema.edge`는
            // 자유 문자열(z.string())이라 `TopicRefEdge`(13종 구조적 간선) 확장 없이 표현 가능하다.
            edge: 'INTENT_DUPLICATE_EXAMPLE',
            sourceTopicName: topicA.name,
            targetResourceType: 'INTENT',
            targetResourceId: ob.id,
            targetResourceName: ob.name,
            targetTopicId: ob.topicId,
            targetTopicName: topicB.name,
          },
        });
      }
    }
  }
  const rule3Top = truncateTop(rule3, (a, b) => (a.resourceName ?? '').localeCompare(b.resourceName ?? ''), TOPIC_LIMITS.boundaryIssuesPerRule);
  if (rule3Top.total > rule3Top.items.length) ruleTotals.CROSS_TOPIC_DUPLICATE_EXAMPLE = rule3Top.total;
  issues.push(...rule3Top.items);

  // ④ NO_LIVE_ENTRY_POINT — live 범위의 활성 NORMAL 노드(조건 ≥1) + 활성 FAQ = 0
  const liveNodeCount = bundle.dialogNodes.filter(
    (n) => isLive(n.topicId ?? null) && n.enabled && n.nodeType === 'NORMAL' && n.intentIds.length + n.keywordIds.length + (n.contextVariableId ? 1 : 0) >= 1,
  ).length;
  const liveFaqCount = bundle.faqs.filter((f) => isLive(f.topicId ?? null) && f.enabled).length;
  if (liveNodeCount + liveFaqCount === 0) {
    issues.push({
      code: 'NO_LIVE_ENTRY_POINT',
      severity: 'WARNING',
      resourceType: 'CHATBOT',
      message: '활성 상태에서 응답할 수 있는 노드·FAQ가 없습니다.',
    });
  }

  return { issues, ...(Object.keys(ruleTotals).length > 0 ? { ruleTotals } : {}) };
}
