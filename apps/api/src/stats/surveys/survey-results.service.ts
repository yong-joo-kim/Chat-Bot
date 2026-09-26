import { Injectable } from '@nestjs/common';
import type {
  Paginated,
  SurveyExportQuery,
  SurveyResponseListItem,
  SurveyResponseListQuery,
  SurveyTextAnswerItem,
  SurveyTextAnswerListQuery,
} from '@chat-bot/shared-types';
import { SURVEY_LIMITS } from '@chat-bot/shared-types';
import type { ChannelType } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { openField } from '../../common/crypto/field-crypto';
import { ChatbotScopeService } from '../../chatbots/chatbot-scope.service';
import { toPaginated } from '../../common/pagination';
import { runWithAggregationTimeout } from '../stats-request.helpers';
import { assertSurveyPeriod } from './lib/survey-period';
import { parseSurveyRow } from './lib/survey-row';
import { displayAnswer, displayStatusOf, findQuestion, toResponseNo } from './lib/survey-display';
import { buildExportFilename, buildExportFilenameAscii, buildResponsesCsv, buildSummaryCsv } from './lib/survey-csv';
import { assembleSurveyQuestionStats } from './lib/survey-question-assembler';
import { AuditLogService } from '../../audit-logs/audit-log.service';

const NOT_FOUND_MESSAGE = '요청하신 설문을 찾을 수 없습니다.';
/** [신규 No.45] 보존기간 경과로 소거된 자유 텍스트 표시 문구(§9.2·NFR-DGA4) — CSV·목록 공용. */
const SURVEY_TEXT_PURGED_LABEL = '보존기간 경과로 파기됨';

export interface SurveyExportResult {
  content: string;
  filename: string;
  /** `Content-Disposition`의 기본(ASCII-only) `filename=` 값 — 한글 설문명은 `filename*=`로만 싣는다. */
  filenameAscii: string;
  mimeType: string;
  truncated: boolean;
  total: number;
}

@Injectable()
export class SurveyResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    // [신규 No.45 — §11.2, 생성자 끝] `export()` 끝에 `recordExport()`.
    private readonly auditLog: AuditLogService,
  ) {}

  private async findSurveyOrThrow(chatbotId: string, surveyId: string) {
    await this.scope.assertReadable(chatbotId);
    const row = await this.prisma.survey.findFirst({ where: { id: surveyId, chatbotId } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  async listResponses(chatbotId: string, surveyId: string, query: SurveyResponseListQuery): Promise<Paginated<SurveyResponseListItem>> {
    const surveyRow = await this.findSurveyOrThrow(chatbotId, surveyId);
    assertSurveyPeriod(query.from, query.to);
    const survey = parseSurveyRow(surveyRow);
    const now = new Date();

    const statusFilter = this.resolveStatusFilter(query.status);
    const where = {
      surveyId,
      dayBucket: { gte: query.from, lte: query.to },
      ...(query.channel ? { channelType: query.channel } : {}),
      ...statusFilter,
    };

    const [rows, total] = await runWithAggregationTimeout(
      Promise.all([
        this.prisma.surveyResponse.findMany({
          where,
          orderBy: { startedAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.surveyResponse.count({ where }),
      ]),
    );

    const answers = rows.length > 0 ? await this.prisma.surveyAnswer.findMany({ where: { responseId: { in: rows.map((r) => r.id) } } }) : [];
    const answersByResponse = new Map<string, typeof answers>();
    for (const a of answers) {
      const list = answersByResponse.get(a.responseId) ?? [];
      list.push(a);
      answersByResponse.set(a.responseId, list);
    }

    const items: SurveyResponseListItem[] = rows.map((row) => {
      // [신규 No.45] 자유 텍스트만 개봉(다른 유형은 textValue=null이라 영향 없음) · 소거 행은 "파기됨" 표시.
      const rowAnswers = (answersByResponse.get(row.id) ?? []).map((a) => ({
        ...a,
        textValue: a.textPurgedAt ? SURVEY_TEXT_PURGED_LABEL : a.textValue === null ? null : openField('SURVEY_TEXT_VALUE', a.id, a.textValue),
      }));
      const answerItems = survey.questions
        .map((q) => {
          const qRows = rowAnswers.filter((a) => a.questionKey === q.key);
          if (qRows.length === 0) return undefined;
          const purged = qRows.some((a) => a.textPurgedAt !== null);
          return {
            questionKey: q.key,
            kind: qRows[0].kind as 'ANSWERED' | 'SKIPPED',
            display: purged ? SURVEY_TEXT_PURGED_LABEL : displayAnswer(findQuestion(survey, q.key), qRows),
            ...(purged ? { purged: true as const } : {}),
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== undefined);

      return {
        responseNo: toResponseNo(row.id),
        exposedAt: row.startedAt,
        displayStatus: displayStatusOf(row, now, survey.sessionTimeoutMinutes),
        endReason: (row.endReason as SurveyResponseListItem['endReason']) ?? undefined,
        started: row.started,
        duplicate: row.isDuplicate,
        // DB 컬럼은 String이지만 적재 지점(공개 대화)은 ChannelType 값만 쓴다.
        channelType: row.channelType as ChannelType,
        completedAt: row.completedAt ?? undefined,
        missingRequiredCount: row.missingRequiredCount,
        answers: answerItems,
      };
    });

    return toPaginated(items, total, query.page, query.pageSize);
  }

  private resolveStatusFilter(statuses: string[] | undefined): Record<string, unknown> {
    if (!statuses || statuses.length === 0) return {};
    if (statuses.includes('DUPLICATE')) return { isDuplicate: true };
    return { status: { in: statuses } };
  }

  async listTextAnswers(chatbotId: string, surveyId: string, query: SurveyTextAnswerListQuery): Promise<Paginated<SurveyTextAnswerItem>> {
    await this.findSurveyOrThrow(chatbotId, surveyId);
    assertSurveyPeriod(query.from, query.to);
    const where = {
      surveyId,
      questionKey: query.questionKey,
      kind: 'ANSWERED',
      textValue: { not: null },
      dayBucket: { gte: query.from, lte: query.to },
      isDuplicate: false,
      ...(query.channel ? { channelType: query.channel } : {}),
    };
    const [rows, total] = await runWithAggregationTimeout(
      Promise.all([
        this.prisma.surveyAnswer.findMany({
          where,
          orderBy: { answeredAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.surveyAnswer.count({ where }),
      ]),
    );
    const items: SurveyTextAnswerItem[] = rows.map((r) => {
      const purged = r.textPurgedAt !== null;
      return {
        responseNo: toResponseNo(r.responseId),
        answeredAt: r.answeredAt,
        text: purged ? SURVEY_TEXT_PURGED_LABEL : (openField('SURVEY_TEXT_VALUE', r.id, r.textValue) ?? ''),
        ...(purged ? { purged: true as const } : {}),
      };
    });
    return toPaginated(items, total, query.page, query.pageSize);
  }

  async export(chatbotId: string, surveyId: string, query: SurveyExportQuery): Promise<SurveyExportResult> {
    const surveyRow = await this.findSurveyOrThrow(chatbotId, surveyId);
    assertSurveyPeriod(query.from, query.to);
    const survey = parseSurveyRow(surveyRow);
    const now = new Date();

    if (query.kind === 'SUMMARY') {
      const responseWhere = {
        surveyId,
        dayBucket: { gte: query.from, lte: query.to },
        ...(query.channel ? { channelType: query.channel } : {}),
        ...(query.includeDuplicates ? {} : { isDuplicate: false }),
      };
      const [exposedCount, reachedRows, answerKindRows, choiceDistRows, scaleDistRows] = await runWithAggregationTimeout(
        Promise.all([
          this.prisma.surveyResponse.count({ where: responseWhere }),
          this.prisma.surveyResponse.groupBy({ by: ['lastQuestionIndex'], where: responseWhere, _count: { _all: true } }),
          this.prisma.surveyAnswer.groupBy({ by: ['questionKey', 'kind'], where: { ...responseWhere, isHead: true }, _count: { _all: true } }),
          this.prisma.surveyAnswer.groupBy({
            by: ['questionKey', 'choiceKey'],
            where: { ...responseWhere, kind: 'ANSWERED', choiceKey: { not: '' } },
            _count: { _all: true },
          }),
          this.prisma.surveyAnswer.groupBy({
            by: ['questionKey', 'numericValue'],
            where: { ...responseWhere, kind: 'ANSWERED', isHead: true, numericValue: { not: null } },
            _count: { _all: true },
          }),
        ]),
      );
      const stats = assembleSurveyQuestionStats({
        survey,
        exposed: exposedCount,
        reachedRows: reachedRows.map((r) => ({ lastQuestionIndex: r.lastQuestionIndex, count: r._count._all })),
        answerKindRows: answerKindRows.map((r) => ({ questionKey: r.questionKey, kind: r.kind, count: r._count._all })),
        choiceDistRows: choiceDistRows.map((r) => ({ questionKey: r.questionKey, choiceKey: r.choiceKey, count: r._count._all })),
        scaleDistRows: scaleDistRows.map((r) => ({ questionKey: r.questionKey, numericValue: r.numericValue as number, count: r._count._all })),
        from: query.from,
        to: query.to,
        generatedAt: now,
      });
      await this.auditLog.recordExport({
        targetType: 'Survey',
        targetId: surveyId,
        chatbotId,
        targetName: survey.name,
        summary: `내보내기 · 설문 '${survey.name}' · ${query.from}~${query.to} · SUMMARY`,
        after: { kind: 'SUMMARY', from: query.from, to: query.to, rows: stats.questions.length, includeDuplicates: query.includeDuplicates, channel: query.channel ?? null },
      });
      return {
        content: buildSummaryCsv(stats),
        filename: buildExportFilename(surveyId, survey.name, 'SUMMARY', query.from, query.to),
        filenameAscii: buildExportFilenameAscii(surveyId, 'SUMMARY', query.from, query.to),
        mimeType: 'text/csv; charset=utf-8',
        truncated: false,
        total: stats.questions.length,
      };
    }

    // RESPONSES
    const where = {
      surveyId,
      dayBucket: { gte: query.from, lte: query.to },
      ...(query.channel ? { channelType: query.channel } : {}),
      ...(query.includeDuplicates ? {} : { isDuplicate: false }),
    };
    const rows = await runWithAggregationTimeout(
      this.prisma.surveyResponse.findMany({ where, orderBy: { startedAt: 'desc' }, take: SURVEY_LIMITS.exportRowsMax + 1 }),
    );
    const truncated = rows.length > SURVEY_LIMITS.exportRowsMax;
    const truncatedRows = truncated ? rows.slice(0, SURVEY_LIMITS.exportRowsMax) : rows;
    const totalCount = truncated ? await this.prisma.surveyResponse.count({ where }) : truncatedRows.length;

    const answersByResponse = new Map<string, Array<{ questionKey: string; kind: string; choiceKey: string; numericValue: number | null; textValue: string | null; isHead: boolean }>>();
    const ids = truncatedRows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 1000) {
      const batch = ids.slice(i, i + 1000);
      const answers = await this.prisma.surveyAnswer.findMany({ where: { responseId: { in: batch } } });
      for (const a of answers) {
        const list = answersByResponse.get(a.responseId) ?? [];
        list.push({
          questionKey: a.questionKey,
          kind: a.kind,
          choiceKey: a.choiceKey,
          numericValue: a.numericValue,
          textValue: a.textPurgedAt ? SURVEY_TEXT_PURGED_LABEL : a.textValue === null ? null : openField('SURVEY_TEXT_VALUE', a.id, a.textValue),
          isHead: a.isHead,
        });
        answersByResponse.set(a.responseId, list);
      }
    }

    const content = buildResponsesCsv(
      survey,
      truncatedRows.map((r) => ({
        id: r.id,
        startedAt: r.startedAt,
        status: r.status,
        endReason: r.endReason,
        channelType: r.channelType,
        completedAt: r.completedAt,
        missingRequiredCount: r.missingRequiredCount,
      })),
      answersByResponse,
    );

    await this.auditLog.recordExport({
      targetType: 'Survey',
      targetId: surveyId,
      chatbotId,
      targetName: survey.name,
      summary: `내보내기 · 설문 '${survey.name}' · ${query.from}~${query.to} · RESPONSES`,
      after: { kind: 'RESPONSES', from: query.from, to: query.to, rows: totalCount, truncated, includeDuplicates: query.includeDuplicates, channel: query.channel ?? null },
    });

    return {
      content,
      filename: buildExportFilename(surveyId, survey.name, 'RESPONSES', query.from, query.to),
      filenameAscii: buildExportFilenameAscii(surveyId, 'RESPONSES', query.from, query.to),
      mimeType: 'text/csv; charset=utf-8',
      truncated,
      total: totalCount,
    };
  }
}
