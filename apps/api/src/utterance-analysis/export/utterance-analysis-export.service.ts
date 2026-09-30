import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { UTTERANCE_TEMPLATE_HEADERS, toKstDayBucket } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { ChatbotScopeService } from '../../chatbots/chatbot-scope.service';
import { buildCsv } from '../../dialogue-common/import/lib/csv-writer';

export interface ExportedFile {
  readonly buffer: Buffer;
  readonly filename: string;
  readonly mimeType: string;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME = 'text/csv; charset=utf-8';

/** 수식 인젝션 방어 — `=`·`+`·`-`·`@`로 시작하는 문자열 앞에 `'`를 붙인다(기존 CSV 규약과 같다). */
function guardCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function parseKeywordTerms(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.map((k) => (k && typeof k === 'object' && 'term' in k ? String((k as { term: unknown }).term) : '')).filter((t) => t !== '') : [];
  } catch {
    return [];
  }
}

function probeText(row: { probeAnswered: boolean | null; wouldUseRag: boolean; probeMatchName: string | null }): string {
  if (row.probeAnswered === null) return '';
  if (row.probeAnswered) return row.probeMatchName ? `답함 — ${row.probeMatchName}` : '답함';
  return row.wouldUseRag ? '2단계로 넘어감' : '답하지 못함';
}

/**
 * 결과 엑셀(시트 `묶음`·`발화`)과 업로드 양식(§12 #1·#9). 마스킹본만 나간다 — 원본 파일은 저장하지 않으므로 낼 수
 * 없다. 다운로드 파일 이름은 `utterance-analysis-<YYYYMMDD>-<id8>.xlsx`이며 **업로드 파일 이름을 쓰지 않는다**(K-2).
 * 감사 `EXPORT`는 응답 생성 후·전송 전에 남긴다(모드 무관, No.45 §11.2).
 */
@Injectable()
export class UtteranceAnalysisExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** 양식 받기 — 머리글 3 + 합성 예시 2행(개인정보 0). CSV는 BOM·수식 방어. */
  async template(chatbotId: string, format: 'xlsx' | 'csv'): Promise<ExportedFile> {
    await this.scope.assertReadable(chatbotId);
    const headers = [...UTTERANCE_TEMPLATE_HEADERS];
    const examples = [
      ['환불은 어떻게 신청하나요?', '3', '예시 문장입니다 — 지우고 사용하세요'],
      ['배송 조회는 어디서 하나요?', '1', ''],
    ];
    if (format === 'csv') {
      return { buffer: Buffer.from(buildCsv(headers, examples), 'utf-8'), filename: 'utterance-analysis-template.csv', mimeType: CSV_MIME };
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('발화');
    sheet.addRow(headers);
    for (const row of examples) sheet.addRow(row);
    sheet.columns = [{ width: 48 }, { width: 12 }, { width: 36 }];
    return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filename: 'utterance-analysis-template.xlsx', mimeType: XLSX_MIME };
  }

  async export(chatbotId: string, analysisId: string): Promise<ExportedFile> {
    await this.scope.assertReadable(chatbotId);
    const analysis = await this.prisma.utteranceAnalysis.findFirst({ where: { id: analysisId, chatbotId } });
    if (!analysis) throw new ApiException('NOT_FOUND', 404, '요청하신 분석을 찾을 수 없습니다.');
    if (analysis.status !== 'SUCCEEDED') {
      throw new ApiException('INVALID_STATUS_TRANSITION', 409, '완료된 분석만 엑셀로 받을 수 있습니다.');
    }

    const clusters = await this.prisma.utteranceCluster.findMany({ where: { analysisId }, orderBy: { ordinal: 'asc' } });
    const utterances = await this.prisma.analyzedUtterance.findMany({ where: { analysisId }, orderBy: { seq: 'asc' } });
    const clusterById = new Map(clusters.map((c) => [c.id, c]));

    const workbook = new ExcelJS.Workbook();
    const clusterSheet = workbook.addWorksheet('묶음');
    clusterSheet.addRow(['번호', '이름', 'AI 제안 이름(확인 필요)', '대표 키워드', '발화 수', '발생 횟수 합', '학습 후보 수', '반영 수']);
    for (const c of clusters) {
      clusterSheet.addRow([
        c.unassigned ? '미분류' : c.ordinal,
        guardCell(c.customName ?? c.autoName),
        guardCell(c.suggestedName ?? ''),
        guardCell(parseKeywordTerms(c.keywords).join(', ')),
        c.utteranceCount,
        c.occurrenceSum,
        c.candidateCount,
        c.appliedCount,
      ]);
    }
    clusterSheet.columns = [{ width: 8 }, { width: 28 }, { width: 28 }, { width: 40 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 10 }];

    const utteranceSheet = workbook.addWorksheet('발화');
    utteranceSheet.addRow(['순번', '묶음 번호', '묶음 이름', '발화', '발생 횟수', '출처 메모', '금지어 포함', '가림 표시 포함', '챗봇 대조', '점수(0~100)', '학습 후보', '반영된 의도']);
    for (const u of utterances) {
      const c = clusterById.get(u.clusterId);
      utteranceSheet.addRow([
        u.seq,
        c ? (c.unassigned ? '미분류' : c.ordinal) : '',
        guardCell(c ? (c.customName ?? c.autoName) : ''),
        guardCell(u.text),
        u.occurrenceCount,
        guardCell(u.sourceMemo ?? ''),
        u.hasBannedWord ? '예' : '',
        u.hasMaskToken ? '예' : '',
        probeText(u),
        u.probeScore === null ? '' : Math.round(u.probeScore * 100),
        u.learningCandidate ? '예' : '',
        guardCell(u.appliedIntentName ?? ''),
      ]);
    }
    utteranceSheet.columns = [{ width: 8 }, { width: 10 }, { width: 24 }, { width: 60 }, { width: 10 }, { width: 24 }, { width: 10 }, { width: 12 }, { width: 24 }, { width: 12 }, { width: 10 }, { width: 24 }];

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const rows = clusters.length + utterances.length;

    // 응답 생성 후 · 전송 전(No.45 §11.2) — 문장·파일 이름 없이 건수만.
    await this.auditLog.recordExport({
      targetType: 'UtteranceAnalysis',
      targetId: analysisId,
      chatbotId,
      targetName: `분석 ${analysisId.slice(0, 8)}`,
      summary: `발화 묶음 분석 결과 내보내기(${rows}행)`,
      after: { clusters: clusters.length, utterances: utterances.length, rows },
    });

    const day = toKstDayBucket(new Date()).replace(/-/g, '');
    return { buffer, filename: `utterance-analysis-${day}-${analysisId.slice(0, 8)}.xlsx`, mimeType: XLSX_MIME };
  }
}
