/**
 * [신규 No.43] 문서 해석 포트(§7.2) — 해석·해시 대상 정규화·마스킹을 작업 스레드 샌드박스에서 한다.
 * 시험은 `InProcessExtractor`(같은 순수 함수를 직접 호출)를 주입한다.
 */
export const KB_EXTRACTOR = 'KB_EXTRACTOR';

export type KbExtractRequest =
  | { kind: 'HTML'; html: string; noisePatterns: readonly string[]; piiMask: boolean; piiMaskMode: 'PARTIAL' | 'FULL' }
  | { kind: 'OOXML'; format: 'DOCX' | 'XLSX' | 'PPTX'; bytes: Uint8Array; piiMaskMode: 'PARTIAL' | 'FULL' }
  | { kind: 'PDF'; bytes: Uint8Array; piiMaskMode: 'PARTIAL' | 'FULL' }
  /**
   * [pass 4 · 위반 8] 사이트맵 — gzip 해제(50MB 상한)·문자 해석·XML 파싱을 **작업 스레드**에서 한다(§6.6 · §7.2:
   * 메인 스레드는 네트워크·DB만). 예전에는 크롤러(메인 스레드)가 직접 해제·파싱해 최대 50MB·10만 URL 처리가
   * 공개 대화의 이벤트 루프를 막을 수 있었다. `bytes`는 전송(transfer)되므로 호출부가 복사본을 넘겨야 한다.
   */
  | { kind: 'SITEMAP'; bytes: Uint8Array; contentType: string | null; gzipped: boolean };

export type KbExtractFlag = 'FILE_UNSAFE' | 'FILE_ENCRYPTED' | 'NO_BODY';

export interface KbExtractResult {
  ok: boolean;
  /** 마스킹 **전** 정규화 본문 — 해시·지문 계산용(R-24 계열 — 304 함정 방지와 같은 원리). */
  normalizedText: string;
  /** 마스킹이 켜졌으면 마스킹 후, 꺼졌으면 `normalizedText`와 같다 — 적재 문서 조립에 쓴다. */
  text: string;
  piiMaskedCount: number;
  title?: string | null;
  links?: string[];
  noindex?: boolean;
  nofollow?: boolean;
  canonical?: string | null;
  hasMacro?: boolean;
  encrypted?: boolean;
  truncated?: boolean;
  /** `kind: 'SITEMAP'` 요청의 결과 — `REJECTED`(DOCTYPE·ENTITY·gzip 한도 위반)면 그 사이트맵을 무시한다. */
  sitemap?: { kind: 'URLSET' | 'SITEMAPINDEX' | 'REJECTED' | 'EMPTY'; locs: string[] };
  flags: KbExtractFlag[];
}

export interface KbExtractorPort {
  extract(req: KbExtractRequest): Promise<KbExtractResult>;
  /**
   * [R1 리뷰 M-2] 부팅 시(기능이 켜져 있을 때만) 워커 엔트리 존재를 **작업 스레드를 띄우지 않고**
   * 확인한다 — 있으면 조용히 반환, 없으면 `WorkerEntryMissingError`를 던진다. `InProcessExtractor`는
   * 이 개념이 없어(작업 스레드를 쓰지 않는다) 구현하지 않아도 된다(옵셔널) — 항상 통과와 같은 뜻.
   */
  checkAvailability?(): void;
}

/**
 * [R1 리뷰 H-2] 워커 진입점(빌드 산출물) 자체가 없는 경우 — **전역 배포 설정 오류**다. 개별 문서·
 * 작업의 내용 문제(추출 타임아웃·크래시)가 아니므로, 호출부(`kb-crawl.runner.ts`·
 * `kb-ingest.runner.ts`)가 이 오류를 `instanceof`로 구분해 "이 문서만 제외"로 위장하지 않는다
 * (모든 문서가 조용히 제외되는 사고 방지). 포트 계층에 둬서 구현체(`WorkerThreadExtractor`)를
 * 몰라도 되게 한다(엔진 코드가 특정 구현을 import하지 않는다).
 */
export class WorkerEntryMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerEntryMissingError';
  }
}
