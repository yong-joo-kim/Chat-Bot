import type { Survey } from '@chat-bot/shared-types';
import { buildCsv } from '../../../dialogue-common/import/lib/csv-writer';
import type { SurveyQuestionStats } from '@chat-bot/shared-types';
import { displayAnswer, findQuestion, toResponseNo } from './survey-display';
import type { AnswerRowForDisplay } from './survey-display';

export interface ExportResponseRow {
  id: string;
  startedAt: Date;
  status: string;
  endReason: string | null;
  channelType: string;
  completedAt: Date | null;
  missingRequiredCount: number;
}

function truncatePrompt(prompt: string): string {
  return prompt.length > 30 ? `${prompt.slice(0, 30)}…` : prompt;
}

/** 응답 원자료 CSV(§10) — `sessionId`·`groupId` 열이 없다. */
export function buildResponsesCsv(survey: Survey, rows: ExportResponseRow[], answersByResponse: Map<string, AnswerRowForDisplay[]>): string {
  const headers = [
    '응답 번호',
    '노출 일시(KST)',
    '상태',
    '이탈 사유',
    '채널',
    '완료 일시(KST)',
    '필수 누락 수',
    ...survey.questions.map((q, i) => `Q${i + 1}. ${truncatePrompt(q.prompt)}`),
  ];
  const lines = rows.map((row) => {
    const answers = answersByResponse.get(row.id) ?? [];
    const base = [
      toResponseNo(row.id),
      row.startedAt.toISOString(),
      row.status,
      row.endReason ?? '',
      row.channelType,
      row.completedAt ? row.completedAt.toISOString() : '',
      String(row.missingRequiredCount),
    ];
    const answerCells = survey.questions.map((q) => {
      const qRows = answers.filter((a) => a.questionKey === q.key);
      return displayAnswer(findQuestion(survey, q.key), qRows);
    });
    return [...base, ...answerCells];
  });
  return buildCsv(headers, lines);
}

/** 문항별 집계 CSV(§10) — `SurveyQuestionStats` 조립 결과를 평탄화한다. */
export function buildSummaryCsv(stats: SurveyQuestionStats): string {
  const headers = ['문항 번호', '문항', '유형', '선택지/값', '수', '비율', '평균', 'NPS'];
  const lines: string[][] = [];
  stats.questions.forEach((q, i) => {
    if (q.kind === 'CHOICE' && q.choiceDistribution) {
      for (const c of q.choiceDistribution) {
        lines.push([String(i + 1), q.prompt, q.type, c.label, String(c.count), c.ratio !== null ? `${Math.round(c.ratio * 1000) / 10}%` : '', '', '']);
      }
    } else if (q.kind === 'SCALE' && q.scaleDistribution) {
      for (const s of q.scaleDistribution) {
        lines.push([String(i + 1), q.prompt, q.type, String(s.value), String(s.count), '', String(q.average ?? ''), q.nps !== null && q.nps !== undefined ? String(q.nps) : '']);
      }
    } else {
      lines.push([String(i + 1), q.prompt, q.type, '', String(q.answered), '', '', '']);
    }
  });
  return buildCsv(headers, lines);
}

/** ASCII-only 대체 파일명(`Content-Disposition`의 기본 `filename=`) — 설문명 없이 id만 쓴다. */
export function buildExportFilenameAscii(surveyId: string, kind: 'RESPONSES' | 'SUMMARY', from: string, to: string): string {
  return `survey-${surveyId.slice(0, 8)}-${kind.toLowerCase()}-${from}-${to}.csv`;
}

/** 내보내기 파일명(§10) — 설문명 정제 · 50자 절단. */
export function buildExportFilename(surveyId: string, surveyName: string, kind: 'RESPONSES' | 'SUMMARY', from: string, to: string): string {
  const cleaned = surveyName
    .replace(/[\\/:*?"<>|]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 50);
  const namePart = cleaned ? `${cleaned}-` : '';
  return `survey-${namePart}${surveyId.slice(0, 8)}-${kind.toLowerCase()}-${from}-${to}.csv`;
}

/**
 * `Content-Disposition` 헤더는 ASCII만 허용한다(HTTP 헤더 값 제약 — 한글이 섞이면 응답이 깨진다).
 * ASCII-only 기본 `filename`(id 기반) + RFC 5987 `filename*=UTF-8''<percent-encoded>`(설문명 포함,
 * §10)로 분리한다. `buildExportFilename()`의 결과(설문명 포함)를 인코딩해 확장 파라미터로 쓴다.
 */
export function buildContentDisposition(filename: string, asciiFallback: string): string {
  const encoded = encodeURIComponent(filename).replace(/'/g, '%27');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
