import { WorkerEntryMissingError } from '../extract/kb-extractor.port';
import type { KbExtractorPort } from '../extract/kb-extractor.port';

/**
 * [신규 No.43 — pass 5 · RG-8] 원본 파일 전달용 사전 검사(§7.3 · ADR-0044 §10). 작업 스레드(추출기 포트)에서 컨테이너 가드·매크로·
 * 암호·개인정보 건수를 확인한다 — 추출 텍스트는 전송하지 않고 건수만 쓴다. 크롤(방문)과 적재(재수집 뒤) 두 곳이 같은 판정을 쓴다.
 * 워커 진입점이 없는 전역 설정 오류(`WorkerEntryMissingError`)는 문서 탓으로 바꾸지 않고 그대로 올린다.
 */
export type RawFileInspection = { ok: true; piiMaskedCount: number; truncated: boolean } | { ok: false; reason: 'FILE_UNSAFE' | 'FILE_ENCRYPTED' };

export interface InspectRawFileOptions {
  /**
   * [pass 7 · N-9] 거버넌스 ON이면 일부만 검사한(`truncated` — PDF 300쪽·텍스트 2MB 초과) 파일을 `FILE_UNSAFE`로 거른다 — 원본 바이트가 그대로 나가는데 검사하지 못한 구간의
   * 개인정보가 섞여 있을 수 있어 "건수 0"을 믿을 수 없다(R-17). 새 제외 사유 enum은 계약 변경이라 만들지 않고 가장 가까운 `FILE_UNSAFE`(안전을 확인할 수 없음)를 쓴다.
   */
  governanceOn?: boolean;
}

const OOXML_FORMATS = new Set(['DOCX', 'XLSX', 'PPTX']);

export async function inspectRawFile(extractor: KbExtractorPort, kind: string, bytes: Uint8Array, opts: InspectRawFileOptions = {}): Promise<RawFileInspection> {
  // 복사본을 넘긴다 — 작업 스레드로 ArrayBuffer를 이전(transfer)하는데 `Buffer`는 공유 풀을 가리킬 수 있어 그대로 이전하면 풀 전체가 분리된다.
  const copy = new Uint8Array(bytes);
  try {
    const result =
      kind === 'PDF'
        ? await extractor.extract({ kind: 'PDF', bytes: copy, piiMaskMode: 'PARTIAL' })
        : OOXML_FORMATS.has(kind)
          ? await extractor.extract({ kind: 'OOXML', format: kind as 'DOCX' | 'XLSX' | 'PPTX', bytes: copy, piiMaskMode: 'PARTIAL' })
          : null;
    if (!result) return { ok: false, reason: 'FILE_UNSAFE' };
    if (result.encrypted || result.flags.includes('FILE_ENCRYPTED')) return { ok: false, reason: 'FILE_ENCRYPTED' };
    if (!result.ok) return { ok: false, reason: 'FILE_UNSAFE' };
    const truncated = result.truncated === true;
    if (truncated && opts.governanceOn) return { ok: false, reason: 'FILE_UNSAFE' };
    return { ok: true, piiMaskedCount: result.piiMaskedCount, truncated };
  } catch (e) {
    if (e instanceof WorkerEntryMissingError) throw e;
    return { ok: false, reason: 'FILE_UNSAFE' };
  }
}
