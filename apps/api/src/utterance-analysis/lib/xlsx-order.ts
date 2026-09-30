import { unzip, zip } from 'fflate';

/**
 * XLSX 압축 항목 순서 정규화(No.21 — 업로드 견고성). 기존 스트리밍 리더(`XlsxSheetReader` — `exceljs`
 * `WorkbookReader`)는 `xl/workbook.xml`이 워크시트보다 **앞**에 있어야 읽을 수 있다. Excel·LibreOffice가 저장한
 * 파일은 그 순서지만 `exceljs` 등 일부 라이브러리가 만든 파일(이 저장소의 `buildXlsxTemplate` 출력 포함)은
 * `xl/workbook.xml`이 **맨 끝**이라 "Cannot read properties of undefined (reading 'sheets')"로 실패한다.
 * 그래서 읽기 전에 항목 순서만 바로잡는다(내용은 그대로 · 무압축 재포장). 기존 리더는 수정하지 않는다.
 *
 * 압축 폭탄 방어: 전체 압축 해제 크기(30MB)와 항목별 크기(20MB)가 상한을 넘으면 **압축을 풀기 전에**(헤더의 원본 크기로)
 * 거부한다(호출부가 IMPORT_TOO_LARGE로 변환). 압축 해제·재포장은 fflate 비동기 API(워커 스레드)로 해 API 이벤트 루프를 막지 않는다.
 * DB·Nest 무의존 순수 함수.
 */

export const XLSX_MAX_UNCOMPRESSED_BYTES = 30 * 1024 * 1024;
export const XLSX_MAX_ENTRY_BYTES = 20 * 1024 * 1024;

export class XlsxTooLargeError extends Error {
  constructor() {
    super('XLSX_TOO_LARGE');
    this.name = 'XlsxTooLargeError';
  }
}

/** 스트리밍 리더가 먼저 알아야 하는 항목(순서 중요). */
const PRIORITY = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/sharedStrings.xml'];

export async function reorderXlsxEntries(buffer: Buffer): Promise<Buffer> {
  let total = 0;
  let tooLarge = false;
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      new Uint8Array(buffer),
      {
        filter: (file) => {
          total += file.originalSize;
          if (file.originalSize > XLSX_MAX_ENTRY_BYTES || total > XLSX_MAX_UNCOMPRESSED_BYTES) {
            tooLarge = true;
            return false; // 압축을 풀지 않는다
          }
          return true;
        },
      },
      (err, data) => (err ? reject(err) : resolve(data)),
    );
  });
  if (tooLarge) throw new XlsxTooLargeError();

  const ordered: Record<string, Uint8Array> = {};
  for (const name of PRIORITY) if (files[name]) ordered[name] = files[name];
  for (const name of Object.keys(files)) {
    if (name.endsWith('/') || name in ordered) continue;
    ordered[name] = files[name];
  }
  return new Promise<Buffer>((resolve, reject) => {
    zip(ordered, { level: 0 }, (err, data) => (err ? reject(err) : resolve(Buffer.from(data))));
  });
}
