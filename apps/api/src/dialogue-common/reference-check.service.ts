import { Injectable } from '@nestjs/common';
import type { ApiErrorCode } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';

interface RefRow {
  id: string;
  name: string;
}

/**
 * 삭제 전 참조 사전검사 단일 진입점(FR-0-10). 위반 시 `409`와 함께 상위 5건의 `{id, name}`을
 * `details[].field=id, message=name` 형태로 담아 UI 바로가기를 제공한다.
 */
@Injectable()
export class ReferenceCheckService {
  constructor(private readonly prisma: PrismaService) {}

  private conflict(code: ApiErrorCode, message: string, refs: RefRow[]): never {
    throw new ApiException(
      code,
      409,
      message,
      refs.map((r) => ({ field: r.id, message: r.name })),
    );
  }

  /** 의도 삭제 사전검사(FR-6-11) — 노드 조건 참조(조인 테이블) + 동음이의어 의미 참조(JSON, EX-R-2). */
  async assertIntentDeletable(chatbotId: string, intentId: string): Promise<void> {
    const links = await this.prisma.dialogNodeIntent.findMany({
      where: { intentId },
      take: 5,
      include: { node: { select: { id: true, name: true } } },
    });
    if (links.length > 0) {
      const total = await this.prisma.dialogNodeIntent.count({ where: { intentId } });
      this.conflict(
        'INTENT_IN_USE',
        `이 의도를 사용하는 대화 노드가 ${total}건 있습니다. 먼저 조건을 정리해 주세요.`,
        links.map((l) => l.node),
      );
    }

    const homonyms = await this.prisma.homonymDictionary.findMany({ where: { chatbotId }, select: { id: true, word: true, meanings: true } });
    const referencing: RefRow[] = [];
    for (const h of homonyms) {
      try {
        const meanings = JSON.parse(h.meanings) as Array<{ intentId?: string }>;
        if (meanings.some((m) => m.intentId === intentId)) referencing.push({ id: h.id, name: h.word });
      } catch {
        // 손상된 JSON은 무시(NFR-M4) — 별도 경고 로그는 mapper 책임
      }
    }
    if (referencing.length > 0) {
      this.conflict(
        'INTENT_IN_USE',
        `이 의도를 연결한 동음이의어 사전 항목이 ${referencing.length}건 있습니다. 먼저 연결을 정리해 주세요.`,
        referencing.slice(0, 5),
      );
    }
  }

  /** 키워드 삭제 사전검사(FR-6-18) — 노드 조건(조인 테이블) + 컨텍스트 슬롯 참조(JSON, EX-R-3). */
  async assertKeywordDeletable(chatbotId: string, keywordId: string): Promise<void> {
    const links = await this.prisma.dialogNodeKeyword.findMany({
      where: { keywordId },
      take: 5,
      include: { node: { select: { id: true, name: true } } },
    });
    if (links.length > 0) {
      const total = await this.prisma.dialogNodeKeyword.count({ where: { keywordId } });
      this.conflict(
        'KEYWORD_IN_USE',
        `이 키워드를 사용하는 대화 노드가 ${total}건 있습니다. 먼저 조건을 정리해 주세요.`,
        links.map((l) => l.node),
      );
    }

    const contexts = await this.prisma.contextVariable.findMany({ where: { chatbotId }, select: { id: true, name: true, slots: true } });
    const referencing: RefRow[] = [];
    for (const c of contexts) {
      try {
        const slots = JSON.parse(c.slots) as Array<{ keywordId?: string }>;
        if (slots.some((s) => s.keywordId === keywordId)) referencing.push({ id: c.id, name: c.name });
      } catch {
        // 무시
      }
    }
    if (referencing.length > 0) {
      this.conflict(
        'KEYWORD_IN_USE',
        `이 키워드를 참조하는 컨텍스트 슬롯이 ${referencing.length}건 있습니다. 먼저 슬롯을 정리해 주세요.`,
        referencing.slice(0, 5),
      );
    }
  }

  /** 컨텍스트 삭제 사전검사(FR-8-6) — FK(contextVariableId) + CONTEXT_FORM 아웃풋 참조(JSON). */
  async assertContextDeletable(chatbotId: string, contextId: string): Promise<void> {
    const linked = await this.prisma.dialogNode.findMany({
      where: { chatbotId, contextVariableId: contextId },
      take: 5,
      select: { id: true, name: true },
    });
    const total = await this.prisma.dialogNode.count({ where: { chatbotId, contextVariableId: contextId } });

    const candidates = await this.prisma.dialogNode.findMany({ where: { chatbotId }, select: { id: true, name: true, outputs: true } });
    const outputRefs: RefRow[] = [];
    for (const n of candidates) {
      try {
        const outputs = JSON.parse(n.outputs) as Array<{ type: string; payload?: { contextVariableId?: string } }>;
        if (outputs.some((o) => o.type === 'CONTEXT_FORM' && o.payload?.contextVariableId === contextId)) {
          if (!linked.some((l) => l.id === n.id)) outputRefs.push({ id: n.id, name: n.name });
        }
      } catch {
        // 무시
      }
    }

    const allRefs = [...linked, ...outputRefs];
    const totalCount = total + outputRefs.length;
    if (allRefs.length > 0) {
      this.conflict(
        'CONTEXT_IN_USE',
        `이 컨텍스트를 사용하는 대화 노드가 ${totalCount}건 있습니다. 먼저 조건을 정리해 주세요.`,
        allRefs.slice(0, 5),
      );
    }
  }

  /** 노드 삭제 사전검사(FR-5-10) — DIALOG_MOVE 대상 / 버튼 NODE 액션 참조(JSON, EX-R-5). */
  async assertNodeDeletable(chatbotId: string, nodeId: string): Promise<void> {
    const candidates = await this.prisma.dialogNode.findMany({ where: { chatbotId }, select: { id: true, name: true, outputs: true } });
    const referencing: RefRow[] = [];
    for (const n of candidates) {
      if (n.id === nodeId) continue;
      try {
        const outputs = JSON.parse(n.outputs) as Array<{
          type: string;
          payload?: { targetNodeId?: string; buttons?: Array<{ action: string; value: string }> };
        }>;
        const refersTarget = outputs.some((o) => o.type === 'DIALOG_MOVE' && o.payload?.targetNodeId === nodeId);
        const refersButton = outputs.some(
          (o) => o.payload?.buttons?.some((b) => b.action === 'NODE' && b.value === nodeId) ?? false,
        );
        if (refersTarget || refersButton) referencing.push({ id: n.id, name: n.name });
      } catch {
        // 무시
      }
    }
    if (referencing.length > 0) {
      this.conflict(
        'NODE_IN_USE',
        `이 노드로 이동하도록 설정된 노드가 ${referencing.length}건 있습니다. 먼저 정리해 주세요.`,
        referencing.slice(0, 5),
      );
    }
  }
}
