import { importEsm } from '../../common/lib/import-esm';

/**
 * [신규 No.43] PDF 텍스트 추출(§7.1 · KB-16 — `pdfjs-dist` import 유일 파일). `isEvalSupported: false`·
 * `disableFontFace: true`·`useSystemFonts: false`로 스크립트 실행 면적을 최소화한다(CVE-2024-4367
 * 이중 방어 — 4.2.67 이상은 이미 수정판). 쪽 상한 300(그 이상은 앞 300쪽만 해석 — 파일 자체는
 * 그대로 전송한다).
 */
const MAX_PAGES = 300;
/** [pass 6 · M-6 · §7.3] 추출 텍스트 누적 상한 2MB — 넘으면 그 자리에서 더 읽지 않는다(`truncated`). 쪽 상한만으로는 쪽당 텍스트가 큰 PDF의 메모리·시간이 묶이지 않는다. */
export const MAX_PDF_TEXT_BYTES = 2 * 1024 * 1024;
/** 쪽 하나의 텍스트 조각(item) 수 상한 — 조각 수만 폭증시키는 PDF가 이벤트 루프(작업 스레드)를 오래 잡지 못하게 한다. */
export const MAX_PDF_ITEMS_PER_PAGE = 200_000;
const PDF_MODULE_SPECIFIER = 'pdfjs-dist/legacy/build/pdf.mjs';

/** 헤더 `%PDF-` 확인 · 트레일러 부근의 `/Encrypt` 토큰 존재 여부(휴리스틱 — 외부로 보내 실패시키지
 * 않고 미리 제외하기 위한 사전 검사, EX-KB-9). */
export function isPdfEncryptedHeuristic(bytes: Uint8Array): boolean {
  const headerOk = bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  if (!headerOk) return false;
  const tailLen = Math.min(bytes.length, 4096);
  const tail = Buffer.from(bytes.subarray(bytes.length - tailLen)).toString('latin1');
  return /\/Encrypt\b/.test(tail);
}

/**
 * 누적 바이트 예산 안에서만 텍스트를 받는다(순수). `remainingBytes`를 넘는 부분은 잘라내고 `exceeded`를 돌려준다 — 잘라낸 끝의
 * 깨진 문자(멀티바이트 도중 절단)는 버린다.
 */
export function takeWithinBudget(text: string, remainingBytes: number): { text: string; bytes: number; exceeded: boolean } {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= remainingBytes) return { text, bytes, exceeded: false };
  const cut = Buffer.from(text, 'utf8').subarray(0, Math.max(0, remainingBytes)).toString('utf8').replace(/�+$/, '');
  return { text: cut, bytes: Buffer.byteLength(cut, 'utf8'), exceeded: true };
}

export interface PdfExtractResult {
  text: string;
  pageCount: number;
  encrypted: boolean;
  truncated: boolean;
}

interface PdfJsTextItem {
  str?: string;
}
interface PdfJsPage {
  getTextContent(): Promise<{ items: PdfJsTextItem[] }>;
  cleanup(): void;
}
interface PdfJsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfJsPage>;
  destroy(): Promise<void>;
}
interface PdfJsModule {
  getDocument(params: Record<string, unknown>): { promise: Promise<PdfJsDocument> };
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtractResult> {
  if (isPdfEncryptedHeuristic(bytes)) {
    return { text: '', pageCount: 0, encrypted: true, truncated: false };
  }

  const pdfjs = await importEsm<PdfJsModule>(PDF_MODULE_SPECIFIER);
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });

  let doc: PdfJsDocument;
  try {
    doc = await loadingTask.promise;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/password|encrypted/i.test(message)) {
      return { text: '', pageCount: 0, encrypted: true, truncated: false };
    }
    throw e;
  }

  const pageCount = doc.numPages;
  let truncated = pageCount > MAX_PAGES;
  const pagesToRead = Math.min(pageCount, MAX_PAGES);
  const texts: string[] = [];
  let usedBytes = 0;
  for (let i = 1; i <= pagesToRead; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items.length > MAX_PDF_ITEMS_PER_PAGE ? content.items.slice(0, MAX_PDF_ITEMS_PER_PAGE) : content.items;
    if (items.length < content.items.length) truncated = true;
    const taken = takeWithinBudget(items.map((it) => (typeof it.str === 'string' ? it.str : '')).join(' '), MAX_PDF_TEXT_BYTES - usedBytes);
    texts.push(taken.text);
    usedBytes += taken.bytes;
    page.cleanup();
    if (taken.exceeded || usedBytes >= MAX_PDF_TEXT_BYTES) {
      truncated = true;
      break; // 상한에 이르면 남은 쪽은 해석하지 않는다.
    }
  }
  await doc.destroy();

  const text = texts
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, pageCount, encrypted: false, truncated };
}
