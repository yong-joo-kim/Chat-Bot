import type { ImportConflict, ImportRowError } from '@chat-bot/shared-types';
import { normalizeText } from '@chat-bot/shared-types';
import type { ParsedFaqRow, ParsedNameValueRow } from './import-row-parser';

export interface ExistingNameValueRecord {
  id: string;
  name: string;
  nameNormalized: string;
  values: string[];
}

export interface NameValuePlanItem {
  name: string;
  nameNormalized: string;
  /** 파일에서 새로 추가되는 값만 담는다(기존 DB에 이미 있는 값은 dedupe되어 제외됨). */
  values: string[];
  /** `values`와 같은 순서로 대응하는 원본 파일 행 번호(1-base, 헤더 제외). 커밋 결과와 검증 리포트를 행 단위로 맞추는 데 쓴다. */
  sourceRows: number[];
  description?: string;
  existingId?: string;
}

export interface NameValuePlan {
  items: NameValuePlanItem[];
  totalRows: number;
  newItems: number;
  updatedItems: number;
  newValues: number;
  duplicatedRows: number;
}

/**
 * 의도/키워드 공용 대량 업로드 계획 산출(순수 함수, FR-6-22). 파일 내 중복 및 기존 DB에 이미 있는
 * 값은 `duplicatedRows`로 집계하고 무시한다(EX-I-3). 실제 DB 반영은 커밋 단계의 서비스 책임이다.
 */
export function planNameValueImport(
  parsedRows: ParsedNameValueRow[],
  existing: ExistingNameValueRecord[],
): NameValuePlan {
  const existingByNorm = new Map(existing.map((e) => [e.nameNormalized, e]));
  const groups = new Map<string, NameValuePlanItem & { seenValues: Set<string> }>();
  let duplicatedRows = 0;

  for (const r of parsedRows) {
    const norm = normalizeText(r.name);
    let group = groups.get(norm);
    if (!group) {
      const existingRecord = existingByNorm.get(norm);
      group = {
        name: r.name,
        nameNormalized: norm,
        values: [],
        sourceRows: [],
        description: r.description,
        existingId: existingRecord?.id,
        seenValues: new Set(existingRecord?.values.map(normalizeText) ?? []),
      };
      groups.set(norm, group);
    }
    const valueNorm = normalizeText(r.value);
    if (!valueNorm || group.seenValues.has(valueNorm)) {
      duplicatedRows += 1;
      continue;
    }
    group.seenValues.add(valueNorm);
    group.values.push(r.value);
    group.sourceRows.push(r.row);
  }

  const items: NameValuePlanItem[] = [...groups.values()].map(({ seenValues: _seen, ...rest }) => rest);
  const newItems = items.filter((i) => !i.existingId).length;
  const updatedItems = items.filter((i) => i.existingId).length;
  const newValues = items.reduce((sum, i) => sum + i.values.length, 0);

  return { items, totalRows: parsedRows.length, newItems, updatedItems, newValues, duplicatedRows };
}

/**
 * 키워드 동의어 교차 충돌 검사(FR-6-16). 업로드 항목의 name+values가 *다른* 기존 키워드의
 * name/동의어와 겹치면 충돌로 보고한다(키워드는 모호성을 허용하지 않는다).
 */
export function findSynonymConflicts(items: NameValuePlanItem[], others: ExistingNameValueRecord[]): ImportConflict[] {
  const conflicts: ImportConflict[] = [];
  for (const item of items) {
    const terms = [item.nameNormalized, ...item.values.map(normalizeText)];
    for (const other of others) {
      if (other.id === item.existingId) continue;
      const otherTerms = new Set([other.nameNormalized, ...other.values.map(normalizeText)]);
      const hit = terms.find((t) => otherTerms.has(t));
      if (hit) {
        conflicts.push({ value: hit, ownerId: other.id, ownerName: other.name });
        break;
      }
    }
  }
  return conflicts;
}

/**
 * 동의어 충돌 항목을 행 오류(SYNONYM_CONFLICT)로도 승격해 `errorPolicy` 정책이 그대로 적용되게 한다.
 *
 * 커밋 단계(`keywords.service.ts` `importCommit`)는 충돌 용어가 하나라도 있는 키워드 묶음 전체를
 * 통째로 건너뛴다(FR-6-16 — 모호성 비허용). 여기서도 같은 기준(묶음 단위)으로 오류를 산출해야
 * 검증 리포트의 `errors[]`와 실제 커밋 결과가 어긋나지 않는다 — 묶음 내 비충돌 동의어 행도 함께
 * "그룹 전체 스킵" 오류로 보고한다. `item.sourceRows`는 파일 중복으로 이미 제외된 행은 포함하지
 * 않으므로(별도로 `duplicatedRows`에 집계) 이중 계산되지 않는다.
 */
export function conflictsToRowErrors(
  conflicts: ImportConflict[],
  parsedRows: ParsedNameValueRow[],
  items: NameValuePlanItem[],
): ImportRowError[] {
  const conflictValues = new Set(conflicts.map((c) => c.value));
  const conflictedItems = items.filter((item) =>
    [item.nameNormalized, ...item.values.map(normalizeText)].some((t) => conflictValues.has(t)),
  );

  const rowsByNumber = new Map(parsedRows.map((r) => [r.row, r]));
  const errors: ImportRowError[] = [];
  for (const item of conflictedItems) {
    const isNameConflict = conflictValues.has(item.nameNormalized);
    for (let i = 0; i < item.sourceRows.length; i += 1) {
      const rowNumber = item.sourceRows[i];
      const value = item.values[i];
      const row = rowsByNumber.get(rowNumber);
      const isDirectValueConflict = conflictValues.has(normalizeText(value));
      errors.push({
        row: rowNumber,
        column: 'value',
        value: row?.value ?? value,
        code: 'SYNONYM_CONFLICT',
        message:
          isNameConflict || isDirectValueConflict
            ? '다른 키워드에서 이미 사용 중인 이름/동의어입니다.'
            : '같은 키워드 묶음에 충돌하는 동의어가 있어 이 행도 함께 건너뜁니다(그룹 전체 스킵).',
      });
    }
  }
  return errors.sort((a, b) => a.row - b.row);
}

export interface FaqPlanItem {
  category: string;
  question: string;
  questionNormalized: string;
  answer: string;
  altQuestions: string[];
  existingId?: string;
  sourceRows: number[];
}

export interface FaqPlan {
  items: FaqPlanItem[];
  totalRows: number;
  newItems: number;
  updatedItems: number;
  newValues: number;
  duplicatedRows: number;
}

export interface ExistingFaqRecord {
  id: string;
  question: string;
  questionNormalized: string;
  altQuestions: string[];
}

/** FAQ 행 그룹핑(같은 category+question은 대체질문 반복 행) + 계획 산출(FR-9-9). */
export function planFaqImport(parsedRows: ParsedFaqRow[], existing: ExistingFaqRecord[]): FaqPlan {
  const existingByNorm = new Map(existing.map((e) => [`${e.questionNormalized}`, e]));
  const groups = new Map<string, FaqPlanItem & { seenAlt: Set<string> }>();
  let duplicatedRows = 0;

  for (const r of parsedRows) {
    const qNorm = normalizeText(r.question);
    const key = `${r.category}::${qNorm}`;
    let group = groups.get(key);
    if (!group) {
      const existingRecord = existingByNorm.get(qNorm);
      group = {
        category: r.category,
        question: r.question,
        questionNormalized: qNorm,
        answer: r.answer,
        altQuestions: [],
        existingId: existingRecord?.id,
        sourceRows: [],
        seenAlt: new Set(existingRecord?.altQuestions.map(normalizeText) ?? []),
      };
      groups.set(key, group);
    }
    group.sourceRows.push(r.row);
    if (r.answer && !group.answer) group.answer = r.answer;
    if (r.altQuestion) {
      const altNorm = normalizeText(r.altQuestion);
      if (group.seenAlt.has(altNorm) || altNorm === qNorm) {
        duplicatedRows += 1;
      } else {
        group.seenAlt.add(altNorm);
        group.altQuestions.push(r.altQuestion);
      }
    }
  }

  const items: FaqPlanItem[] = [...groups.values()].map(({ seenAlt: _seen, ...rest }) => rest);
  const newItems = items.filter((i) => !i.existingId).length;
  const updatedItems = items.filter((i) => i.existingId).length;
  const newValues = items.reduce((sum, i) => sum + i.altQuestions.length, 0);

  return { items, totalRows: parsedRows.length, newItems, updatedItems, newValues, duplicatedRows };
}
