import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TransferPlan } from './lib/transfer-plan';

const CHUNK_SIZE = 500;

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface LoadCounts {
  topics: number;
  surveys: number;
  contexts: number;
  intents: number;
  keywords: number;
  homonyms: number;
  faqs: number;
  dialogNodes: number;
  nodeIntentLinks: number;
  nodeKeywordLinks: number;
}

/**
 * ③ 적재(topic-system-설계.md §9.1) — **생성 전용**(`create`/`createMany`와 조회만, §17 T-5).
 * FK 충족 순서로 청크(500행) `createMany`만 쓴다. 원본 챗봇 id를 대상으로 한 쓰기는 0건이다.
 */
@Injectable()
export class AssetTransferLoader {
  async load(tx: Prisma.TransactionClient, targetChatbotId: string, plan: TransferPlan): Promise<LoadCounts> {
    for (const batch of chunk(plan.topics, CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      await tx.topic.createMany({ data: batch.map((t) => ({ ...t, chatbotId: targetChatbotId })) });
    }
    for (const batch of chunk(plan.surveys, CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      await tx.survey.createMany({
        data: batch.map((s) => ({
          id: s.id,
          chatbotId: targetChatbotId,
          name: s.name,
          nameNormalized: s.nameNormalized,
          description: s.description,
          status: s.status,
          activeFrom: s.activeFrom,
          activeTo: s.activeTo,
          introMessage: s.introMessage,
          completionMessage: s.completionMessage,
          cancelKeywords: JSON.stringify(s.cancelKeywords),
          sessionTimeoutMinutes: s.sessionTimeoutMinutes,
          questions: JSON.stringify(s.questions),
          structureVersion: s.structureVersion,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
      });
    }
    for (const batch of chunk(plan.contexts, CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      await tx.contextVariable.createMany({
        data: batch.map((c) => ({
          id: c.id,
          chatbotId: targetChatbotId,
          name: c.name,
          nameNormalized: c.nameNormalized,
          description: c.description,
          slots: JSON.stringify(c.slots),
          completionMessage: c.completionMessage,
          cancelKeywords: JSON.stringify(c.cancelKeywords),
          sessionTimeoutMinutes: c.sessionTimeoutMinutes,
          topicId: c.topicId,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        })),
      });
    }
    for (const batch of chunk(plan.intents, CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      await tx.intent.createMany({
        data: batch.map((i) => ({
          id: i.id,
          chatbotId: targetChatbotId,
          name: i.name,
          nameNormalized: i.nameNormalized,
          description: i.description,
          examples: JSON.stringify(i.examples),
          topicId: i.topicId,
          createdAt: i.createdAt,
          updatedAt: i.updatedAt,
        })),
      });
    }
    for (const batch of chunk(plan.keywords, CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      await tx.keyword.createMany({
        data: batch.map((k) => ({
          id: k.id,
          chatbotId: targetChatbotId,
          name: k.name,
          nameNormalized: k.nameNormalized,
          description: k.description,
          synonyms: JSON.stringify(k.synonyms),
          topicId: k.topicId,
          createdAt: k.createdAt,
          updatedAt: k.updatedAt,
        })),
      });
    }
    for (const batch of chunk(plan.homonyms, CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      await tx.homonymDictionary.createMany({
        data: batch.map((h) => ({
          id: h.id,
          chatbotId: targetChatbotId,
          word: h.word,
          wordNormalized: h.wordNormalized,
          description: h.description,
          meanings: JSON.stringify(h.meanings),
          policy: h.policy,
          clarifyPrompt: h.clarifyPrompt,
          defaultMeaningIndex: h.defaultMeaningIndex,
          topicId: h.topicId,
          createdAt: h.createdAt,
          updatedAt: h.updatedAt,
        })),
      });
    }
    for (const batch of chunk(plan.faqs, CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      await tx.faqEntry.createMany({
        data: batch.map((f) => ({
          id: f.id,
          chatbotId: targetChatbotId,
          category: f.category,
          question: f.question,
          questionNormalized: f.questionNormalized,
          answer: f.answer,
          altQuestions: JSON.stringify(f.altQuestions),
          enabled: f.enabled,
          topicId: f.topicId,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
        })),
      });
    }
    for (const batch of chunk(plan.nodes, CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      await tx.dialogNode.createMany({
        data: batch.map((n) => ({
          id: n.id,
          chatbotId: targetChatbotId,
          name: n.name,
          nameNormalized: n.nameNormalized,
          description: n.description,
          nodeType: n.nodeType,
          matchMode: n.matchMode,
          enabled: n.enabled,
          priority: n.priority,
          contextVariableId: n.contextVariableId,
          outputs: JSON.stringify(n.outputs),
          topicId: n.topicId,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
        })),
      });
    }
    for (const batch of chunk(plan.nodeIntentPairs, CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      await tx.dialogNodeIntent.createMany({ data: batch });
    }
    for (const batch of chunk(plan.nodeKeywordPairs, CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      await tx.dialogNodeKeyword.createMany({ data: batch });
    }

    return {
      topics: plan.topics.length,
      surveys: plan.surveys.length,
      contexts: plan.contexts.length,
      intents: plan.intents.length,
      keywords: plan.keywords.length,
      homonyms: plan.homonyms.length,
      faqs: plan.faqs.length,
      dialogNodes: plan.nodes.length,
      nodeIntentLinks: plan.nodeIntentPairs.length,
      nodeKeywordLinks: plan.nodeKeywordPairs.length,
    };
  }
}
