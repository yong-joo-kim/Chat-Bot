import { Injectable } from '@nestjs/common';
import type { ApiErrorCode, DialogNode, DialogOutput } from '@chat-bot/shared-types';
import { getOutgoingNodeRefs } from '@chat-bot/dialogue-engine';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';

interface RefRow {
  id: string;
  name: string;
  /** 전역 자원(API 연결 등)의 참조 목록처럼 대상이 여러 챗봇에 걸칠 때만 채운다(No.26 M-2). */
  chatbotId?: string;
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
      refs.map((r) => ({ field: r.id, message: r.name, ...(r.chatbotId !== undefined ? { chatbotId: r.chatbotId } : {}) })),
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

  /**
   * 노드 삭제 사전검사(FR-5-10) — `getOutgoingNodeRefs()` 재사용으로 규칙 1벌(J-17, AC-L1-7).
   * DIALOG_MOVE 대상 / 버튼 NODE 액션 / [No.26] API 조건분기(v1·v2 모두)의 `conditions[].nextNodeId`·
   * `defaultNodeId`·`failureNodeId` 참조를 모두 검사한다.
   */
  async assertNodeDeletable(chatbotId: string, nodeId: string): Promise<void> {
    const candidates = await this.prisma.dialogNode.findMany({ where: { chatbotId }, select: { id: true, name: true, outputs: true } });
    const referencing: RefRow[] = [];
    for (const n of candidates) {
      if (n.id === nodeId) continue;
      try {
        const outputs = JSON.parse(n.outputs) as DialogOutput[];
        const { moveTargets, buttonTargets, apiTargets, surveyTargets } = getOutgoingNodeRefs({ outputs } as DialogNode);
        if ([...moveTargets, ...buttonTargets, ...apiTargets, ...surveyTargets].includes(nodeId)) referencing.push({ id: n.id, name: n.name });
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

  /**
   * [No.27] 설문 삭제 사전검사(FR-SV2-7 · FR-SV3-2) — 현재 노드가 참조하는 설문만 본다(스냅샷 참조는
   * 막지 않음, FR-SV10-3). `outputs contains surveyId` 사전 필터로 후보를 좁힌 뒤 파싱 재확인한다.
   */
  async assertSurveyDeletable(chatbotId: string, surveyId: string): Promise<void> {
    const candidates = await this.prisma.dialogNode.findMany({
      where: { chatbotId, outputs: { contains: surveyId } },
      select: { id: true, name: true, outputs: true },
    });
    const referencing: RefRow[] = [];
    for (const n of candidates) {
      try {
        const outputs = JSON.parse(n.outputs) as Array<{ type: string; payload?: { version?: number; surveyId?: string } }>;
        const refers = outputs.some((o) => o.type === 'SURVEY' && o.payload?.version === 2 && o.payload?.surveyId === surveyId);
        if (refers) referencing.push({ id: n.id, name: n.name });
      } catch {
        // 무시
      }
    }
    if (referencing.length > 0) {
      this.conflict(
        'SURVEY_IN_USE',
        `이 설문을 참조하는 대화 노드가 ${referencing.length}건 있습니다. 먼저 노드 설정을 정리해 주세요.`,
        referencing.slice(0, 5),
      );
    }
  }

  /**
   * [No.26] API 연결 삭제 사전검사(전 챗봇 노드 — 연결은 전역 자원). v2 `API_CONDITION.connectionId`
   * 참조만 검사한다(v1은 연결을 참조하지 않는다). `details[].message`는 "챗봇명 › 노드명" 형식이고
   * `details[].chatbotId`도 함께 채운다(딥링크용, M-2). `contains` 사전 필터로 DB 단에서 후보를 먼저
   * 거른 뒤에만 JSON을 파싱한다(M-1, §14 성능 목표 — 1만 노드·50 연결 기준 P95 500ms).
   */
  async assertApiConnectionDeletable(connectionId: string): Promise<void> {
    const candidates = await this.prisma.dialogNode.findMany({
      where: { outputs: { contains: connectionId } },
      select: { id: true, name: true, outputs: true, chatbotId: true, chatbot: { select: { name: true } } },
    });
    const referencing: RefRow[] = [];
    for (const n of candidates) {
      try {
        const outputs = JSON.parse(n.outputs) as Array<{ type: string; payload?: { version?: number; connectionId?: string } }>;
        // `contains`는 부분 문자열 오탐(다른 필드에 같은 id가 우연히 등장하는 경우)을 배제하지
        // 못하므로, 파싱 단계에서 v2 API_CONDITION.connectionId로 다시 정확히 검사한다.
        const refers = outputs.some((o) => o.type === 'API_CONDITION' && o.payload?.version === 2 && o.payload?.connectionId === connectionId);
        if (refers) referencing.push({ id: n.id, name: `${n.chatbot.name} › ${n.name}`, chatbotId: n.chatbotId });
      } catch {
        // 무시
      }
    }
    if (referencing.length > 0) {
      this.conflict(
        'API_CONNECTION_IN_USE',
        `이 연결을 참조하는 대화 노드가 ${referencing.length}건 있습니다. 먼저 노드 설정을 정리해 주세요.`,
        referencing.slice(0, 5),
      );
    }
  }
}
