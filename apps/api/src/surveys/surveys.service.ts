import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CopySurveyDto,
  CreateSurveyDto,
  SurveyDetail,
  SurveyListItem,
  SurveyListQuery,
  UpdateSurveyDto,
  normalizeText,
  toKstDayBucket,
} from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { ReferenceCheckService } from '../dialogue-common/reference-check.service';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import { assignQuestionKeys, reissueQuestionKeys } from './lib/survey-keys';
import { checkSurveyOpenable } from './lib/survey-open-check';
import { deriveSurveyCopyName } from './lib/survey-copy-name';
import { diffStructure } from './lib/survey-structure';
import { parseQuestions, toAuditSnapshot, toSurveyDetail, toSurveyEntity, toSurveyListItem } from './survey.mapper';

const NOT_FOUND_MESSAGE = '요청하신 설문을 찾을 수 없습니다.';

interface SurveyOutputRef {
  type: string;
  payload?: { version?: number; surveyId?: string };
}

@Injectable()
export class SurveysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly referenceCheck: ReferenceCheckService,
    private readonly bundleService: DialogueBundleService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private async assertNameFree(chatbotId: string, nameNormalized: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.survey.findFirst({
      where: { chatbotId, nameNormalized, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (existing) throw new ApiException('DUPLICATE_NAME', 409, '이미 같은 이름의 설문이 있습니다.');
  }

  private async findRowOrThrow(chatbotId: string, id: string) {
    const row = await this.prisma.survey.findFirst({ where: { id, chatbotId } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  private async isLocked(surveyId: string): Promise<boolean> {
    const answer = await this.prisma.surveyAnswer.findFirst({ where: { surveyId }, select: { id: true } });
    return !!answer;
  }

  /** 이 챗봇 노드가 참조하는 설문 id → 노드 ResourceRef 목록(전수 — 목록은 앞 5개만 노출). */
  private async collectReferencingNodesBySurvey(chatbotId: string): Promise<Map<string, { id: string; name: string }[]>> {
    const nodes = await this.prisma.dialogNode.findMany({ where: { chatbotId }, select: { id: true, name: true, outputs: true } });
    const map = new Map<string, { id: string; name: string }[]>();
    for (const n of nodes) {
      let outputs: SurveyOutputRef[];
      try {
        outputs = JSON.parse(n.outputs) as SurveyOutputRef[];
      } catch {
        continue;
      }
      for (const o of outputs) {
        if (o.type === 'SURVEY' && o.payload?.version === 2 && o.payload.surveyId) {
          const list = map.get(o.payload.surveyId) ?? [];
          list.push({ id: n.id, name: n.name });
          map.set(o.payload.surveyId, list);
        }
      }
    }
    return map;
  }

  async list(chatbotId: string, query: SurveyListQuery): Promise<{ items: SurveyListItem[] }> {
    await this.scope.assertReadable(chatbotId);
    const where: Prisma.SurveyWhereInput = { chatbotId };
    if (query.status) where.status = query.status;
    if (query.q) where.name = { contains: query.q };

    const rows = await this.prisma.survey.findMany({ where, orderBy: { updatedAt: 'desc' } });
    if (rows.length === 0) return { items: [] };

    const surveyIds = rows.map((r) => r.id);
    const thirtyDaysAgo = toKstDayBucket(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

    const [lockedRows, refMap, statsRows] = await Promise.all([
      this.prisma.surveyAnswer.groupBy({ by: ['surveyId'], where: { surveyId: { in: surveyIds } } }),
      this.collectReferencingNodesBySurvey(chatbotId),
      this.prisma.surveyResponse.groupBy({
        by: ['surveyId', 'status', 'isDuplicate'],
        where: { chatbotId, surveyId: { in: surveyIds }, dayBucket: { gte: thirtyDaysAgo } },
        _count: { _all: true },
      }),
    ]);

    const lockedSet = new Set(lockedRows.map((r) => r.surveyId));
    const last30dMap = new Map<string, { exposed: number; completed: number }>();
    for (const r of statsRows) {
      if (r.isDuplicate) continue;
      const cur = last30dMap.get(r.surveyId) ?? { exposed: 0, completed: 0 };
      cur.exposed += r._count._all;
      if (r.status === 'COMPLETED') cur.completed += r._count._all;
      last30dMap.set(r.surveyId, cur);
    }

    const items = rows.map((row) =>
      toSurveyListItem(row, {
        locked: lockedSet.has(row.id),
        referencingNodeCount: refMap.get(row.id)?.length ?? 0,
        last30d: last30dMap.get(row.id) ?? { exposed: 0, completed: 0 },
      }),
    );
    return { items };
  }

  async create(chatbotId: string, dto: CreateSurveyDto): Promise<SurveyDetail> {
    await this.scope.assertWritable(chatbotId);
    const name = dto.name.trim();
    const nameNormalized = normalizeText(name);
    await this.assertNameFree(chatbotId, nameNormalized);

    const count = await this.prisma.survey.count({ where: { chatbotId } });
    if (count >= 50) {
      throw new ApiException('LIMIT_EXCEEDED', 409, '챗봇당 설문은 최대 50개까지 만들 수 있습니다.');
    }

    const questions = assignQuestionKeys(dto.questions);
    const row = await this.prisma.survey.create({
      data: {
        chatbotId,
        name,
        nameNormalized,
        description: dto.description,
        status: 'DRAFT',
        activeFrom: dto.activeFrom,
        activeTo: dto.activeTo,
        introMessage: dto.introMessage,
        completionMessage: dto.completionMessage,
        cancelKeywords: JSON.stringify(dto.cancelKeywords),
        sessionTimeoutMinutes: dto.sessionTimeoutMinutes,
        questions: JSON.stringify(questions),
        structureVersion: 1,
      },
    });
    this.bundleService.invalidate(chatbotId);
    await this.auditLogService.record({
      action: 'CREATE',
      targetType: 'Survey',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      after: toAuditSnapshot(row),
    });
    return toSurveyDetail(row, { locked: false, responseCount: 0, referencingNodes: [] });
  }

  async findOne(chatbotId: string, id: string): Promise<SurveyDetail> {
    await this.scope.assertReadable(chatbotId);
    const row = await this.findRowOrThrow(chatbotId, id);
    const [locked, responseCount, refMap] = await Promise.all([
      this.isLocked(id),
      this.prisma.surveyResponse.count({ where: { surveyId: id } }),
      this.collectReferencingNodesBySurvey(chatbotId),
    ]);
    return toSurveyDetail(row, { locked, responseCount, referencingNodes: refMap.get(id) ?? [] });
  }

  async update(chatbotId: string, id: string, dto: UpdateSurveyDto): Promise<SurveyDetail> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);

    let name = current.name;
    let nameNormalized = current.nameNormalized;
    if (dto.name !== undefined) {
      name = dto.name.trim();
      nameNormalized = normalizeText(name);
      await this.assertNameFree(chatbotId, nameNormalized, id);
    }

    const currentQuestions = parseQuestions(current);
    let questions = currentQuestions;
    let structureVersion = current.structureVersion;
    if (dto.questions !== undefined) {
      const nextQuestions = assignQuestionKeys(dto.questions);
      const diff = diffStructure(currentQuestions, nextQuestions);
      if (diff === 'STRUCTURAL') {
        const hasAnswers = await this.prisma.surveyAnswer.findFirst({ where: { surveyId: id }, select: { id: true } });
        if (hasAnswers) {
          throw new ApiException(
            'SURVEY_STRUCTURE_LOCKED',
            409,
            '응답이 있는 설문은 문항 구성을 바꿀 수 없습니다. 문구만 수정할 수 있어요. 구성을 바꾸려면 복제해서 새 설문을 만드세요.',
          );
        }
        structureVersion = current.structureVersion + 1;
      }
      questions = nextQuestions;
    }

    const status = dto.status ?? (current.status as 'DRAFT' | 'OPEN' | 'CLOSED');
    if (dto.status !== undefined && dto.status !== current.status) {
      const allowed =
        (current.status === 'DRAFT' && dto.status === 'OPEN') ||
        (current.status === 'OPEN' && dto.status === 'CLOSED') ||
        (current.status === 'CLOSED' && dto.status === 'OPEN');
      if (!allowed) {
        throw new ApiException('INVALID_STATUS_TRANSITION', 400, '작성 중 → 진행 중 → 마감(↔진행 중) 순서로만 상태를 바꿀 수 있습니다.');
      }
    }

    const activeTo = dto.activeTo === undefined ? current.activeTo : dto.activeTo;
    const goingOpen = status === 'OPEN' && (current.status !== 'OPEN' || (dto.questions !== undefined && questions !== currentQuestions));
    if (goingOpen) {
      const details = checkSurveyOpenable({ questions, activeTo: activeTo ?? undefined }, new Date());
      if (details.length > 0) {
        throw new ApiException('VALIDATION_FAILED', 400, '설문을 진행 중 상태로 바꾸려면 아래 항목을 먼저 채워주세요.', details);
      }
    }

    const row = await this.prisma.survey.update({
      where: { id },
      data: {
        name,
        nameNormalized,
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.activeFrom !== undefined ? { activeFrom: dto.activeFrom } : {}),
        ...(dto.activeTo !== undefined ? { activeTo: dto.activeTo } : {}),
        ...(dto.introMessage !== undefined ? { introMessage: dto.introMessage } : {}),
        ...(dto.completionMessage !== undefined ? { completionMessage: dto.completionMessage } : {}),
        ...(dto.cancelKeywords !== undefined ? { cancelKeywords: JSON.stringify(dto.cancelKeywords) } : {}),
        ...(dto.sessionTimeoutMinutes !== undefined ? { sessionTimeoutMinutes: dto.sessionTimeoutMinutes } : {}),
        ...(dto.questions !== undefined ? { questions: JSON.stringify(questions), structureVersion } : {}),
        status,
      },
    });
    this.bundleService.invalidate(chatbotId);

    const statusOnlyChange = dto.status !== undefined && dto.status !== current.status && dto.questions === undefined && dto.name === undefined;
    await this.auditLogService.record({
      action: statusOnlyChange ? 'STATUS_CHANGE' : 'UPDATE',
      targetType: 'Survey',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      before: toAuditSnapshot(current),
      after: toAuditSnapshot(row),
      summary: statusOnlyChange ? `${current.status} → ${row.status}` : structureVersion !== current.structureVersion ? `구성 변경(구조 버전 ${current.structureVersion}→${structureVersion})` : undefined,
    });

    const [locked, responseCount, refMap] = await Promise.all([
      this.isLocked(id),
      this.prisma.surveyResponse.count({ where: { surveyId: id } }),
      this.collectReferencingNodesBySurvey(chatbotId),
    ]);
    return toSurveyDetail(row, { locked, responseCount, referencingNodes: refMap.get(id) ?? [] });
  }

  async remove(chatbotId: string, id: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);
    await this.referenceCheck.assertSurveyDeletable(chatbotId, id);

    const hasResponses = await this.prisma.surveyResponse.findFirst({ where: { surveyId: id }, select: { id: true } });
    if (hasResponses) {
      throw new ApiException('SURVEY_HAS_RESPONSES', 409, '응답이 있는 설문은 삭제할 수 없어요. 마감하면 더 이상 응답을 받지 않습니다.');
    }

    await this.prisma.survey.delete({ where: { id } });
    this.bundleService.invalidate(chatbotId);
    await this.auditLogService.record({
      action: 'DELETE',
      targetType: 'Survey',
      targetId: current.id,
      targetName: current.name,
      chatbotId,
      before: toAuditSnapshot(current),
    });
  }

  async copy(chatbotId: string, id: string, dto: CopySurveyDto): Promise<SurveyDetail> {
    await this.scope.assertWritable(chatbotId);
    const original = await this.findRowOrThrow(chatbotId, id);

    const existing = await this.prisma.survey.findMany({ where: { chatbotId }, select: { nameNormalized: true } });
    const existingSet = new Set(existing.map((e) => e.nameNormalized));
    const name = dto.name?.trim() || deriveSurveyCopyName(original.name, existingSet);
    const nameNormalized = normalizeText(name);
    if (existingSet.has(nameNormalized)) throw new ApiException('DUPLICATE_NAME', 409, '이미 같은 이름의 설문이 있습니다.');

    const count = await this.prisma.survey.count({ where: { chatbotId } });
    if (count >= 50) {
      throw new ApiException('LIMIT_EXCEEDED', 409, '챗봇당 설문은 최대 50개까지 만들 수 있습니다.');
    }

    const questions = reissueQuestionKeys(parseQuestions(original));
    const row = await this.prisma.survey.create({
      data: {
        chatbotId,
        name,
        nameNormalized,
        description: original.description,
        status: 'DRAFT',
        activeFrom: original.activeFrom,
        activeTo: original.activeTo,
        introMessage: original.introMessage,
        completionMessage: original.completionMessage,
        cancelKeywords: original.cancelKeywords,
        sessionTimeoutMinutes: original.sessionTimeoutMinutes,
        questions: JSON.stringify(questions),
        structureVersion: 1,
      },
    });
    this.bundleService.invalidate(chatbotId);
    await this.auditLogService.record({
      action: 'COPY',
      targetType: 'Survey',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      after: toAuditSnapshot(row),
    });
    return toSurveyDetail(row, { locked: false, responseCount: 0, referencingNodes: [] });
  }
}
