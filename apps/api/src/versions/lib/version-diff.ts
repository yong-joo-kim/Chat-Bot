import { normalizeText } from '@chat-bot/shared-types';
import type { VersionAssetKind, VersionChangeKind, VersionDiffSummary, VersionFieldDiff } from '@chat-bot/shared-types';
import type { SnapshotEnvelope } from './snapshot-envelope';
import { omitKeys, stableStringify } from './snapshot-canonical';

/**
 * 순수 함수 `diffSnapshots(base, target)`(§7.2) — DB·Nest 무의존. 저장하지 않는다(AC-H2-7).
 * "항목 비교 필드" 판정(`itemEquals`)은 복원 계획(`restore-plan.ts`)과 공유한다 — 차이 화면의
 * "변경"과 복원이 실제로 쓰는 "변경"이 한 규칙이다.
 */

export interface DiffEntity {
  id: string;
  [key: string]: unknown;
}

export interface DiffItem {
  id: string;
  kind: VersionAssetKind;
  change: VersionChangeKind;
  name: string;
  recreated?: { counterpartId: string };
  changedFields?: string[];
}

export interface DiffResult {
  summary: VersionDiffSummary;
  items: DiffItem[];
}

const NAME_FIELD: Record<Exclude<VersionAssetKind, 'ANSWER_SETTING' | 'PROFILE'>, string> = {
  INTENT: 'name',
  KEYWORD: 'name',
  HOMONYM: 'word',
  CONTEXT: 'name',
  NODE: 'name',
  FAQ: 'question',
};

function nameOf(kind: VersionAssetKind, entity: DiffEntity): string {
  if (kind === 'ANSWER_SETTING') return '답변 설정';
  if (kind === 'PROFILE') return '챗봇 프로필';
  const field = NAME_FIELD[kind];
  return String(entity[field] ?? '');
}

/**
 * id/createdAt/updatedAt을 제외하고, 조인 배열은 정렬한 뒤 비교한다(§8.4 `itemEquals`와 공유 규칙).
 * 제외 규칙 자체(`omitKeys`)는 `snapshot-canonical.ts`의 해시 비교(`toHashComparable`)와 공유한다(M-2).
 */
export function comparableOf(kind: VersionAssetKind, entity: DiffEntity): unknown {
  const rest = omitKeys(entity, ['id', 'createdAt', 'updatedAt']);
  if (kind === 'NODE') {
    const node = rest as { intentIds?: string[]; keywordIds?: string[] };
    return {
      ...rest,
      intentIds: [...(node.intentIds ?? [])].sort(),
      keywordIds: [...(node.keywordIds ?? [])].sort(),
    };
  }
  return rest;
}

export function itemEquals(kind: VersionAssetKind, a: DiffEntity, b: DiffEntity): boolean {
  return stableStringify(comparableOf(kind, a)) === stableStringify(comparableOf(kind, b));
}

/**
 * REF_SET 필드(노드 `intentIds`/`keywordIds`)의 id → 이름 해석기(§7.3, FR-H2-8, H-1).
 * "이름은 target → base 순으로 해석, 양쪽에 없으면 null"(§7.3) — target에서 먼저 찾고 없으면 base,
 * 둘 다 없으면 null("(현재 없음)" 표기는 화면의 몫).
 */
export type RefNameResolver = (refKind: 'INTENT' | 'KEYWORD', id: string) => string | null;

export function buildRefNameResolver(base: SnapshotEnvelope, target: SnapshotEnvelope): RefNameResolver {
  const targetIntents = new Map(target.assets.intents.map((i) => [i.id, i.name]));
  const baseIntents = new Map(base.assets.intents.map((i) => [i.id, i.name]));
  const targetKeywords = new Map(target.assets.keywords.map((k) => [k.id, k.name]));
  const baseKeywords = new Map(base.assets.keywords.map((k) => [k.id, k.name]));

  return (refKind, id) => {
    if (refKind === 'INTENT') return targetIntents.get(id) ?? baseIntents.get(id) ?? null;
    return targetKeywords.get(id) ?? baseKeywords.get(id) ?? null;
  };
}

function diffEntityList(
  kind: Exclude<VersionAssetKind, 'ANSWER_SETTING' | 'PROFILE'>,
  baseList: readonly DiffEntity[],
  targetList: readonly DiffEntity[],
): { items: DiffItem[]; added: number; removed: number; modified: number } {
  const baseMap = new Map(baseList.map((e) => [e.id, e]));
  const targetMap = new Map(targetList.map((e) => [e.id, e]));
  const items: DiffItem[] = [];
  let added = 0;
  let removed = 0;
  let modified = 0;

  for (const [id, entity] of baseMap) {
    if (!targetMap.has(id)) {
      items.push({ id, kind, change: 'REMOVED', name: nameOf(kind, entity) });
      removed += 1;
    }
  }
  for (const [id, entity] of targetMap) {
    const baseEntity = baseMap.get(id);
    if (!baseEntity) {
      items.push({ id, kind, change: 'ADDED', name: nameOf(kind, entity) });
      added += 1;
      continue;
    }
    if (!itemEquals(kind, baseEntity, entity)) {
      const changedFields = Object.keys(comparableOf(kind, entity) as Record<string, unknown>).filter((field) => {
        const beforeVal = (comparableOf(kind, baseEntity) as Record<string, unknown>)[field];
        const afterVal = (comparableOf(kind, entity) as Record<string, unknown>)[field];
        return stableStringify(beforeVal) !== stableStringify(afterVal);
      });
      items.push({ id, kind, change: 'MODIFIED', name: nameOf(kind, entity), changedFields });
      modified += 1;
    }
  }

  // FR-H2-10: 같은 종류 REMOVED/ADDED 쌍 중 정규화 키가 같으면 "재생성됨" 힌트를 양방향으로 붙인다.
  const nameField = NAME_FIELD[kind];
  const removedItems = items.filter((i) => i.change === 'REMOVED');
  const addedItems = items.filter((i) => i.change === 'ADDED');
  for (const removedItem of removedItems) {
    const removedEntity = baseMap.get(removedItem.id)!;
    const removedKey = normalizeText(String(removedEntity[nameField] ?? ''));
    for (const addedItem of addedItems) {
      if (addedItem.recreated) continue;
      const addedEntity = targetMap.get(addedItem.id)!;
      const addedKey = normalizeText(String(addedEntity[nameField] ?? ''));
      if (removedKey && removedKey === addedKey) {
        removedItem.recreated = { counterpartId: addedItem.id };
        addedItem.recreated = { counterpartId: removedItem.id };
        break;
      }
    }
  }

  return { items, added, removed, modified };
}

export function diffSnapshots(
  base: SnapshotEnvelope,
  target: SnapshotEnvelope,
  baseIntegrityWarningCount: number,
  targetIntegrityWarningCount: number,
): DiffResult {
  const allItems: DiffItem[] = [];
  const rows: VersionDiffSummary['rows'] = [];
  let totalChanged = 0;

  const kinds: Array<[Exclude<VersionAssetKind, 'ANSWER_SETTING' | 'PROFILE'>, DiffEntity[], DiffEntity[]]> = [
    ['INTENT', base.assets.intents as unknown as DiffEntity[], target.assets.intents as unknown as DiffEntity[]],
    ['KEYWORD', base.assets.keywords as unknown as DiffEntity[], target.assets.keywords as unknown as DiffEntity[]],
    ['HOMONYM', base.assets.homonyms as unknown as DiffEntity[], target.assets.homonyms as unknown as DiffEntity[]],
    ['CONTEXT', base.assets.contexts as unknown as DiffEntity[], target.assets.contexts as unknown as DiffEntity[]],
    ['NODE', base.assets.dialogNodes as unknown as DiffEntity[], target.assets.dialogNodes as unknown as DiffEntity[]],
    ['FAQ', base.assets.faqs as unknown as DiffEntity[], target.assets.faqs as unknown as DiffEntity[]],
  ];

  for (const [kind, baseList, targetList] of kinds) {
    const result = diffEntityList(kind, baseList, targetList);
    allItems.push(...result.items);
    rows.push({ kind, added: result.added, removed: result.removed, modified: result.modified });
    totalChanged += result.added + result.removed + result.modified;
  }

  // ANSWER_SETTING — id = chatbotId 1항목(행 없음 = 항목 없음)
  {
    const baseHas = base.answerSetting !== null;
    const targetHas = target.answerSetting !== null;
    let added = 0;
    let removed = 0;
    let modified = 0;
    if (!baseHas && targetHas) {
      allItems.push({ id: target.chatbotId, kind: 'ANSWER_SETTING', change: 'ADDED', name: '답변 설정' });
      added = 1;
    } else if (baseHas && !targetHas) {
      allItems.push({ id: base.chatbotId, kind: 'ANSWER_SETTING', change: 'REMOVED', name: '답변 설정' });
      removed = 1;
    } else if (baseHas && targetHas && stableStringify(base.answerSetting) !== stableStringify(target.answerSetting)) {
      allItems.push({ id: target.chatbotId, kind: 'ANSWER_SETTING', change: 'MODIFIED', name: '답변 설정' });
      modified = 1;
    }
    rows.push({ kind: 'ANSWER_SETTING', added, removed, modified });
    totalChanged += added + removed + modified;
  }

  // PROFILE — id = chatbotId 1항목
  {
    let modified = 0;
    if (stableStringify(base.profile) !== stableStringify(target.profile)) {
      allItems.push({ id: target.chatbotId, kind: 'PROFILE', change: 'MODIFIED', name: '챗봇 프로필' });
      modified = 1;
    }
    rows.push({ kind: 'PROFILE', added: 0, removed: 0, modified });
    totalChanged += modified;
  }

  // INTEGRITY_WARNING — 항목 목록은 없다(요약 건수만). added=target 건수, removed=base 건수로 표기한다.
  rows.push({ kind: 'INTEGRITY_WARNING', added: targetIntegrityWarningCount, removed: baseIntegrityWarningCount, modified: 0 });

  const identical = totalChanged === 0;

  return {
    summary: { rows, totalChanged, identical },
    items: allItems,
  };
}

/**
 * 항목 상세(§7.3) — 필드 단위 차이. `refNameResolver`가 없으면 REF_SET 이름은 전부 `null`이다
 * (하위호환 — 호출자가 넘기지 않아도 동작은 한다, H-1 이전 동작과 동일).
 */
export function diffItemFields(
  kind: VersionAssetKind,
  before: DiffEntity | undefined,
  after: DiffEntity | undefined,
  refNameResolver?: RefNameResolver,
): VersionFieldDiff[] {
  const beforeComparable = (before ? comparableOf(kind, before) : {}) as Record<string, unknown>;
  const afterComparable = (after ? comparableOf(kind, after) : {}) as Record<string, unknown>;
  const fields = new Set([...Object.keys(beforeComparable), ...Object.keys(afterComparable)]);
  const diffs: VersionFieldDiff[] = [];

  const VALUE_SET_FIELDS = new Set(['examples', 'synonyms', 'altQuestions', 'cancelKeywords']);
  const REF_SET_FIELDS = new Set(['intentIds', 'keywordIds']);
  const STRUCT_FIELDS = new Set(['outputs', 'slots', 'meanings', 'skin']);

  for (const field of fields) {
    const beforeVal = beforeComparable[field];
    const afterVal = afterComparable[field];
    if (stableStringify(beforeVal) === stableStringify(afterVal)) continue;

    if (VALUE_SET_FIELDS.has(field)) {
      const beforeArr = (beforeVal as string[] | undefined) ?? [];
      const afterArr = (afterVal as string[] | undefined) ?? [];
      const beforeSet = new Set(beforeArr);
      const afterSet = new Set(afterArr);
      const added = afterArr.filter((v) => !beforeSet.has(v));
      const removed = beforeArr.filter((v) => !afterSet.has(v));
      const reorderedOnly = added.length === 0 && removed.length === 0;
      diffs.push({ field, type: 'VALUE_SET', added, removed, reorderedOnly });
      continue;
    }
    if (REF_SET_FIELDS.has(field)) {
      const beforeArr = (beforeVal as string[] | undefined) ?? [];
      const afterArr = (afterVal as string[] | undefined) ?? [];
      const beforeSet = new Set(beforeArr);
      const afterSet = new Set(afterArr);
      const refKind: 'INTENT' | 'KEYWORD' = field === 'intentIds' ? 'INTENT' : 'KEYWORD';
      const resolveName = (id: string): string | null => (refNameResolver ? refNameResolver(refKind, id) : null);
      diffs.push({
        field,
        type: 'REF_SET',
        added: afterArr.filter((id) => !beforeSet.has(id)).map((id) => ({ id, name: resolveName(id) })),
        removed: beforeArr.filter((id) => !afterSet.has(id)).map((id) => ({ id, name: resolveName(id) })),
      });
      continue;
    }
    if (STRUCT_FIELDS.has(field)) {
      diffs.push({ field, type: 'STRUCT', before: beforeVal ?? null, after: afterVal ?? null });
      continue;
    }
    diffs.push({ field, type: 'SCALAR', before: beforeVal ?? null, after: afterVal ?? null });
  }

  return diffs;
}
