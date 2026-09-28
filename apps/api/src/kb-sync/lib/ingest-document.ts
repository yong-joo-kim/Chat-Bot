import { buildDocx } from './docx-writer';
import type { ExternalFileExt } from './external-file-name';

/**
 * [신규 No.43] 적재 문서 조립(순수 — §5.5). 문서 머리 3줄(출처·제목·수집 시각)은 모든 형식에
 * 공통이며 PII 마스킹 대상이다(호출부가 이미 마스킹한 텍스트를 넘긴다). 해시는 머리 줄을 **제외한**
 * 정규화 본문으로 계산한다(호출부 책임 — 이 함수는 최종 바이트 조립만 한다).
 */
export type KbHtmlIngestFormat = 'DOCX' | 'TXT' | 'HTML';

export interface BuildIngestDocumentInput {
  format: KbHtmlIngestFormat;
  sourceUrl: string;
  title: string | null;
  collectedAtIso: string;
  maskedBodyText: string;
}

export interface BuildIngestDocumentResult {
  bytes: Uint8Array;
  contentType: string;
  ext: ExternalFileExt;
}

function buildHeaderLines(input: BuildIngestDocumentInput): string[] {
  return [`출처: ${input.sourceUrl}`, `제목: ${input.title ?? '(제목 없음)'}`, `수집 시각: ${input.collectedAtIso}`];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildIngestDocument(input: BuildIngestDocumentInput): BuildIngestDocumentResult {
  const headerLines = buildHeaderLines(input);

  if (input.format === 'TXT') {
    const text = [...headerLines, '', input.maskedBodyText].join('\n');
    return { bytes: new TextEncoder().encode(text), contentType: 'text/plain', ext: 'txt' };
  }
  if (input.format === 'HTML') {
    const bodyParagraphs = input.maskedBodyText
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => `<p>${escapeHtml(l)}</p>`)
      .join('');
    const headerParagraphs = headerLines.map((l) => `<p>${escapeHtml(l)}</p>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(input.title ?? '')}</title></head><body>${headerParagraphs}${bodyParagraphs}</body></html>`;
    return { bytes: new TextEncoder().encode(html), contentType: 'text/html', ext: 'html' };
  }

  const bytes = buildDocx({ headerLines, bodyText: input.maskedBodyText });
  return { bytes, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
}
