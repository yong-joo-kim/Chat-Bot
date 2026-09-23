import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { normalizeText } from '@chat-bot/shared-types';
import { serializeSkin } from '../../chatbots/lib/skin.util';
import type { RestorePlan } from '../lib/restore-plan';

const TEMP_KEY_PREFIX = '\u001Frestore:';
const CHUNK_SIZE = 500;

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface ApplyResult {
  /** 분류기 `deleteMany` 결과 건수(0 또는 1 — PK가 `chatbotId` 1개다) — 호출자가 `classifierDeleted`
   * 응답 필드를 실제 삭제 여부로 정확히 채우는 데 쓴다(M-3, AC-H3-13). */
  classifierDeletedCount: number;
}

/**
 * ★ 대화 자산 9테이블 + `Chatbot` 4필드 + 분류기 삭제를 쓰는 **유일한 파일**(§8.4, NFR-HS3).
 * `planRestore()`가 만든 계획을 S1~S9 순서대로 적용한다. 원시 SQL 0건(NFR-HM6) — 이름 교환은
 * 임시 키(S3)로 해결한다. 쓰기 값은 **원본(slim) 값**이다(§5.5 — zod 변환값을 쓰지 않는다).
 */
@Injectable()
export class VersionRestoreApplier {
  async apply(tx: Prisma.TransactionClient, chatbotId: string, plan: RestorePlan): Promise<ApplyResult> {
    // S1 — 조인 삭제(대상에 없는 의도/키워드를 참조하는 조인은 반드시 포함된다)
    for (const batch of chunk(plan.nodeIntentPairs.toDelete, CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      await tx.dialogNodeIntent.deleteMany({ where: { OR: batch.map((p) => ({ nodeId: p.nodeId, intentId: p.intentId })) } });
    }
    for (const batch of chunk(plan.nodeKeywordPairs.toDelete, CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      await tx.dialogNodeKeyword.deleteMany({ where: { OR: batch.map((p) => ({ nodeId: p.nodeId, keywordId: p.keywordId })) } });
    }

    // S2 — 노드 삭제(컨텍스트 삭제보다 먼저 — 노드가 contextVariableId로 컨텍스트를 붙잡는다)
    for (const batch of chunk(plan.nodes.toDelete, CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      await tx.dialogNode.deleteMany({ where: { id: { in: batch } } });
    }

    // S3 — 임시 키 부여(이름 교환 중간 충돌 방지) + 삭제될 컨텍스트를 참조하던 유지 노드의 FK 해제
    for (const id of plan.rekeyIds.intents) await tx.intent.update({ where: { id }, data: { nameNormalized: TEMP_KEY_PREFIX + id } });
    for (const id of plan.rekeyIds.keywords) await tx.keyword.update({ where: { id }, data: { nameNormalized: TEMP_KEY_PREFIX + id } });
    for (const id of plan.rekeyIds.homonyms) await tx.homonymDictionary.update({ where: { id }, data: { wordNormalized: TEMP_KEY_PREFIX + id } });
    for (const id of plan.rekeyIds.contexts) await tx.contextVariable.update({ where: { id }, data: { nameNormalized: TEMP_KEY_PREFIX + id } });
    for (const id of plan.rekeyIds.nodes) await tx.dialogNode.update({ where: { id }, data: { nameNormalized: TEMP_KEY_PREFIX + id } });
    for (const id of plan.rekeyIds.faqs) await tx.faqEntry.update({ where: { id }, data: { questionNormalized: TEMP_KEY_PREFIX + id } });
    for (const id of plan.nodeContextClearIds) await tx.dialogNode.update({ where: { id }, data: { contextVariableId: null } });

    // S4 — 삭제: 의도·키워드·동음이의어·컨텍스트·FAQ(S1~S3로 모든 FK 참조가 해제됨)
    for (const batch of chunk(plan.intents.toDelete, CHUNK_SIZE)) if (batch.length > 0) await tx.intent.deleteMany({ where: { id: { in: batch } } });
    for (const batch of chunk(plan.keywords.toDelete, CHUNK_SIZE)) if (batch.length > 0) await tx.keyword.deleteMany({ where: { id: { in: batch } } });
    for (const batch of chunk(plan.homonyms.toDelete, CHUNK_SIZE)) if (batch.length > 0) await tx.homonymDictionary.deleteMany({ where: { id: { in: batch } } });
    for (const batch of chunk(plan.contexts.toDelete, CHUNK_SIZE)) if (batch.length > 0) await tx.contextVariable.deleteMany({ where: { id: { in: batch } } });
    for (const batch of chunk(plan.faqs.toDelete, CHUNK_SIZE)) if (batch.length > 0) await tx.faqEntry.deleteMany({ where: { id: { in: batch } } });

    // S5 — 생성(원래 id·createdAt) → 갱신(전 필드 + 최종 정규화 키): 의도·키워드·동음이의어·컨텍스트·FAQ
    for (const item of plan.intents.toCreate) {
      await tx.intent.create({
        data: {
          id: item.id,
          chatbotId,
          name: item.name,
          nameNormalized: normalizeText(item.name),
          description: item.description ?? null,
          examples: JSON.stringify(item.examples),
          createdAt: item.createdAt,
        },
      });
    }
    for (const item of plan.intents.toUpdate) {
      await tx.intent.update({
        where: { id: item.id },
        data: { name: item.name, nameNormalized: normalizeText(item.name), description: item.description ?? null, examples: JSON.stringify(item.examples) },
      });
    }

    for (const item of plan.keywords.toCreate) {
      await tx.keyword.create({
        data: {
          id: item.id,
          chatbotId,
          name: item.name,
          nameNormalized: normalizeText(item.name),
          description: item.description ?? null,
          synonyms: JSON.stringify(item.synonyms),
          createdAt: item.createdAt,
        },
      });
    }
    for (const item of plan.keywords.toUpdate) {
      await tx.keyword.update({
        where: { id: item.id },
        data: { name: item.name, nameNormalized: normalizeText(item.name), description: item.description ?? null, synonyms: JSON.stringify(item.synonyms) },
      });
    }

    for (const item of plan.homonyms.toCreate) {
      await tx.homonymDictionary.create({
        data: {
          id: item.id,
          chatbotId,
          word: item.word,
          wordNormalized: normalizeText(item.word),
          description: item.description ?? null,
          meanings: JSON.stringify(item.meanings),
          policy: item.policy,
          clarifyPrompt: item.clarifyPrompt ?? null,
          defaultMeaningIndex: item.defaultMeaningIndex ?? null,
          createdAt: item.createdAt,
        },
      });
    }
    for (const item of plan.homonyms.toUpdate) {
      await tx.homonymDictionary.update({
        where: { id: item.id },
        data: {
          word: item.word,
          wordNormalized: normalizeText(item.word),
          description: item.description ?? null,
          meanings: JSON.stringify(item.meanings),
          policy: item.policy,
          clarifyPrompt: item.clarifyPrompt ?? null,
          defaultMeaningIndex: item.defaultMeaningIndex ?? null,
        },
      });
    }

    for (const item of plan.contexts.toCreate) {
      await tx.contextVariable.create({
        data: {
          id: item.id,
          chatbotId,
          name: item.name,
          nameNormalized: normalizeText(item.name),
          description: item.description ?? null,
          slots: JSON.stringify(item.slots),
          completionMessage: item.completionMessage ?? null,
          cancelKeywords: JSON.stringify(item.cancelKeywords),
          sessionTimeoutMinutes: item.sessionTimeoutMinutes,
          createdAt: item.createdAt,
        },
      });
    }
    for (const item of plan.contexts.toUpdate) {
      await tx.contextVariable.update({
        where: { id: item.id },
        data: {
          name: item.name,
          nameNormalized: normalizeText(item.name),
          description: item.description ?? null,
          slots: JSON.stringify(item.slots),
          completionMessage: item.completionMessage ?? null,
          cancelKeywords: JSON.stringify(item.cancelKeywords),
          sessionTimeoutMinutes: item.sessionTimeoutMinutes,
        },
      });
    }

    for (const item of plan.faqs.toCreate) {
      await tx.faqEntry.create({
        data: {
          id: item.id,
          chatbotId,
          category: item.category,
          question: item.question,
          questionNormalized: normalizeText(item.question),
          answer: item.answer,
          altQuestions: JSON.stringify(item.altQuestions),
          enabled: item.enabled,
          createdAt: item.createdAt,
        },
      });
    }
    for (const item of plan.faqs.toUpdate) {
      await tx.faqEntry.update({
        where: { id: item.id },
        data: {
          category: item.category,
          question: item.question,
          questionNormalized: normalizeText(item.question),
          answer: item.answer,
          altQuestions: JSON.stringify(item.altQuestions),
          enabled: item.enabled,
        },
      });
    }

    // S6 — 노드 생성 → 갱신(최종 contextVariableId·이름 포함, 참조 컨텍스트는 S5에서 이미 존재)
    for (const item of plan.nodes.toCreate) {
      await tx.dialogNode.create({
        data: {
          id: item.id,
          chatbotId,
          name: item.name,
          nameNormalized: normalizeText(item.name),
          description: item.description ?? null,
          nodeType: item.nodeType,
          matchMode: item.matchMode,
          enabled: item.enabled,
          priority: item.priority,
          contextVariableId: item.contextVariableId ?? null,
          outputs: JSON.stringify(item.outputs),
          createdAt: item.createdAt,
        },
      });
    }
    for (const item of plan.nodes.toUpdate) {
      await tx.dialogNode.update({
        where: { id: item.id },
        data: {
          name: item.name,
          nameNormalized: normalizeText(item.name),
          description: item.description ?? null,
          nodeType: item.nodeType,
          matchMode: item.matchMode,
          enabled: item.enabled,
          priority: item.priority,
          contextVariableId: item.contextVariableId ?? null,
          outputs: JSON.stringify(item.outputs),
        },
      });
    }

    // S7 — 조인 생성
    for (const batch of chunk(plan.nodeIntentPairs.toCreate, CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      await tx.dialogNodeIntent.createMany({ data: batch.map((p) => ({ nodeId: p.nodeId, intentId: p.intentId })) });
    }
    for (const batch of chunk(plan.nodeKeywordPairs.toCreate, CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      await tx.dialogNodeKeyword.createMany({ data: batch.map((p) => ({ nodeId: p.nodeId, keywordId: p.keywordId })) });
    }

    // S8 — 답변설정: 대상 null → 행 삭제 / 다르면 upsert(전 필드) / 같으면 skip
    if (plan.answerSetting.action === 'DELETE') {
      await tx.chatbotAnswerSetting.deleteMany({ where: { chatbotId } });
    } else if (plan.answerSetting.action === 'UPSERT') {
      const v = plan.answerSetting.value;
      await tx.chatbotAnswerSetting.upsert({
        where: { chatbotId },
        create: { chatbotId, ...v },
        update: { ...v },
      });
    }

    // S9 — 프로필: 4필드가 다를 때만 쓴다. slug·status·groupId는 절대 쓰지 않는다.
    if (plan.profile.action === 'UPDATE') {
      const v = plan.profile.value;
      await tx.chatbot.update({
        where: { id: chatbotId },
        data: { name: v.name, avatarUrl: v.avatarUrl, description: v.description, skin: serializeSkin(v.skin) },
      });
    }

    // 분류기 삭제(J-8, AC-H3-13) — 트랜잭션 안에서 처리해 복원 롤백 시 함께 롤백된다.
    const classifierDeleteResult = await tx.intentClassifierModel.deleteMany({ where: { chatbotId } });

    return { classifierDeletedCount: classifierDeleteResult.count };
  }
}
