import { maskPii } from '@chat-bot/pii-mask';
import { extractHtml } from './html-extract';
import { extractOoxmlText, isOle2Signature } from './ooxml-text';
import { extractPdfText } from './pdf-text';
import { ContainerGuardViolation } from './container-guard';
import { normalizeForHash } from './text-normalize';
import { looksLikeGzip, safeGunzip } from './gzip-guard';
import { parseSitemap } from './sitemap-parse';
import { decodeBody } from './charset';
import type { KbExtractRequest, KbExtractResult } from '../extract/kb-extractor.port';

/**
 * [신규 No.43] 작업 스레드 진입점과 시험용 인프로세스 구현이 공유하는 순수 실행기(§7.2 · KB-16).
 * Prisma·Nest·네트워크 무의존 — `kb-sync/lib/*`·`@chat-bot/pii-mask`만 참조한다.
 */
function maskText(text: string, mode: 'PARTIAL' | 'FULL'): { masked: string; maskedCount: number } {
  const result = maskPii(text, { mode });
  const maskedCount = Object.values(result.counts).reduce((a, b) => a + b, 0);
  return { masked: result.maskedText, maskedCount };
}

/** 요구 데이터 모델 "title ≤ 200"(코드 포인트 기준 — 서로게이트 쌍을 반으로 자르지 않는다). */
const TITLE_MAX_CHARS = 200;

/**
 * [pass 10 · RG-25] 제목은 본문과 같은 규칙으로 마스킹한 **뒤에** 자른다(순서 불변 — 먼저 자르면 경계에 걸린 전화번호 앞자리 같은
 * 개인정보 조각이 원문 그대로 남는다). 마스킹이 꺼진 소스(거버넌스 OFF일 때만 가능)는 본문 규칙과 같이 마스킹하지 않되 절단은 적용한다.
 */
function sanitizeTitle(title: string | null, piiMask: boolean, mode: 'PARTIAL' | 'FULL'): { title: string | null; maskedCount: number } {
  if (title === null) return { title: null, maskedCount: 0 };
  const { masked, maskedCount } = piiMask ? maskText(title, mode) : { masked: title, maskedCount: 0 };
  const chars = Array.from(masked);
  return { title: chars.length > TITLE_MAX_CHARS ? chars.slice(0, TITLE_MAX_CHARS).join('') : masked, maskedCount };
}

export async function runExtractJob(req: KbExtractRequest): Promise<KbExtractResult> {
  if (req.kind === 'SITEMAP') {
    // gzip 해제(스트리밍 50MB 상한)·문자 해석·XML 파싱(DOCTYPE·ENTITY 거부)이 전부 여기(작업 스레드)서 일어난다.
    // 어떤 위반·오류든 "그 사이트맵 무시"(REJECTED)로 수렴하고 예외를 밖으로 내지 않는다.
    try {
      const raw = req.gzipped || looksLikeGzip(req.bytes) ? safeGunzip(req.bytes) : req.bytes;
      const parsed = parseSitemap(decodeBody(raw, req.contentType));
      return { ok: parsed.kind !== 'REJECTED', normalizedText: '', text: '', piiMaskedCount: 0, sitemap: parsed, flags: parsed.kind === 'REJECTED' ? ['FILE_UNSAFE'] : [] };
    } catch {
      return { ok: false, normalizedText: '', text: '', piiMaskedCount: 0, sitemap: { kind: 'REJECTED', locs: [] }, flags: ['FILE_UNSAFE'] };
    }
  }

  if (req.kind === 'HTML') {
    const html = extractHtml(req.html);
    const normalizedText = normalizeForHash(html.text, req.noisePatterns);
    const { masked, maskedCount } = req.piiMask ? maskText(normalizedText, req.piiMaskMode) : { masked: normalizedText, maskedCount: 0 };
    const title = sanitizeTitle(html.title, req.piiMask, req.piiMaskMode);
    const flags = normalizedText.length < 200 ? (['NO_BODY'] as const) : [];
    return {
      ok: true,
      normalizedText,
      text: masked,
      piiMaskedCount: maskedCount + title.maskedCount,
      title: title.title,
      links: html.links,
      noindex: html.noindex,
      nofollow: html.nofollow,
      canonical: html.canonical,
      flags: [...flags],
    };
  }

  if (req.kind === 'PDF') {
    try {
      const pdf = await extractPdfText(req.bytes);
      if (pdf.encrypted) return { ok: true, normalizedText: '', text: '', piiMaskedCount: 0, encrypted: true, flags: ['FILE_ENCRYPTED'] };
      const { maskedCount } = maskText(pdf.text, req.piiMaskMode);
      return { ok: true, normalizedText: pdf.text, text: pdf.text, piiMaskedCount: maskedCount, truncated: pdf.truncated, flags: [] };
    } catch {
      return { ok: false, normalizedText: '', text: '', piiMaskedCount: 0, flags: ['FILE_UNSAFE'] };
    }
  }

  // OOXML(DOCX·XLSX·PPTX) — 원본 파일 전달용 사전 검사(텍스트는 전송하지 않는다).
  if (isOle2Signature(req.bytes)) {
    return { ok: false, normalizedText: '', text: '', piiMaskedCount: 0, flags: ['FILE_ENCRYPTED'] };
  }
  try {
    const result = extractOoxmlText(req.format, req.bytes);
    if (result.hasMacro) return { ok: false, normalizedText: '', text: '', piiMaskedCount: 0, hasMacro: true, flags: ['FILE_UNSAFE'] };
    const { maskedCount } = maskText(result.text, req.piiMaskMode);
    return { ok: true, normalizedText: result.text, text: result.text, piiMaskedCount: maskedCount, hasMacro: false, flags: [] };
  } catch (e) {
    if (e instanceof ContainerGuardViolation) return { ok: false, normalizedText: '', text: '', piiMaskedCount: 0, flags: ['FILE_UNSAFE'] };
    return { ok: false, normalizedText: '', text: '', piiMaskedCount: 0, flags: ['FILE_UNSAFE'] };
  }
}
