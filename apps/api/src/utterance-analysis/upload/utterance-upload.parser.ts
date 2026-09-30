import { Injectable } from '@nestjs/common';
import { IMPORT_LIMITS } from '@chat-bot/shared-types';
import { ApiException } from '../../common/api.exception';
import { CsvSheetReader } from '../../dialogue-common/import/csv-sheet-reader';
import { XlsxSheetReader } from '../../dialogue-common/import/xlsx-sheet-reader';
import { ImportFileTooLargeError } from '../../dialogue-common/import/sheet-reader';
import type { SheetReader } from '../../dialogue-common/import/sheet-reader';
import { hasEncodingAnomaly, isHeaderMismatch } from '../../dialogue-common/import/lib/sheet-detect';
import { inspectUpload } from '../lib/file-sniff';
import type { UploadFileKind } from '../lib/file-sniff';
import type { RawUtteranceRow } from '../lib/prepare-utterances';

export interface UploadedUtteranceFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

export interface ParsedUpload {
  readonly kind: UploadFileKind;
  /** 머리글을 뺀 데이터 행. */
  readonly rows: RawUtteranceRow[];
}

const HEADER_SPEC = [{ canonical: '발화', aliases: ['utterance', 'text', '문장'] }];
const ENCODING_MESSAGE = 'UTF-8로 저장한 뒤 다시 올려 주세요.';
const INVALID_FILE_MESSAGE = '엑셀(.xlsx) 또는 CSV 파일이 아닙니다. 양식을 받아 사용해 주세요.';

/**
 * 업로드 파일 → 원본 행(No.21 — 설계서 §7.1). 형식 판별은 내용 기반(`file-sniff`)이고, 읽기는 기존
 * `SheetReader`(xlsx·csv) 100% 재사용이다 — **새 파서를 만들지 않는다**. 셀은 값만 읽는다(수식 결과·서식·병합·
 * 숨은 시트 무시 — 기존 파서 규약). 요청 핸들러 스코프 안에서만 호출되며 결과는 마스킹 전 문자열이라
 * 호출부(서비스)가 즉시 마스킹해 `MaskedUtteranceText[]`만 남긴다(DC-8).
 */
@Injectable()
export class UtteranceUploadParser {
  constructor(
    private readonly csvReader: CsvSheetReader,
    private readonly xlsxReader: XlsxSheetReader,
  ) {}

  async parse(file: UploadedUtteranceFile, limits: { maxRows: number; maxFileBytes?: number }): Promise<ParsedUpload> {
    const maxBytes = limits.maxFileBytes ?? IMPORT_LIMITS.maxFileBytes;
    if (file.size > maxBytes || file.buffer.length > maxBytes) {
      throw new ApiException('IMPORT_TOO_LARGE', 400, `파일이 너무 큽니다. 최대 ${maxBytes / (1024 * 1024)}MB, ${limits.maxRows}줄까지 올릴 수 있습니다.`);
    }
    const inspected = inspectUpload(file.originalname, file.buffer);
    if ('invalid' in inspected) {
      if (inspected.invalid === 'ENCODING') throw new ApiException('IMPORT_FILE_INVALID', 400, ENCODING_MESSAGE, [{ field: 'encoding', message: ENCODING_MESSAGE }]);
      throw new ApiException('IMPORT_FILE_INVALID', 400, INVALID_FILE_MESSAGE);
    }
    const kind = inspected.kind;

    const reader: SheetReader = kind === 'XLSX' ? this.xlsxReader : this.csvReader;
    let sheetRows;
    try {
      // xlsx 항목 순서 정규화·압축 폭탄 방어는 `XlsxSheetReader.read()`가 공통으로 처리한다(D-5).
      sheetRows = await reader.read(file.buffer, limits.maxRows);
    } catch (e) {
      if (e instanceof ImportFileTooLargeError) {
        throw new ApiException('IMPORT_TOO_LARGE', 400, `파일이 너무 큽니다. 최대 ${maxBytes / (1024 * 1024)}MB, ${limits.maxRows}줄까지 올릴 수 있습니다.`);
      }
      // 서명은 ZIP이지만 엑셀 통합 문서가 아닌 경우 등 — 원인 문구를 서버 내부 오류로 새지 않게 한다.
      throw new ApiException('IMPORT_FILE_INVALID', 400, INVALID_FILE_MESSAGE);
    }
    if (sheetRows.length === 0) throw new ApiException('IMPORT_FILE_INVALID', 400, '데이터 행이 없습니다. 양식을 받아 사용해 주세요.');
    if (hasEncodingAnomaly(sheetRows)) throw new ApiException('IMPORT_FILE_INVALID', 400, ENCODING_MESSAGE, [{ field: 'encoding', message: ENCODING_MESSAGE }]);
    if (isHeaderMismatch(sheetRows[0].cells, HEADER_SPEC)) {
      throw new ApiException('IMPORT_FILE_INVALID', 400, INVALID_FILE_MESSAGE, [
        { field: 'header', message: '1열 머리글은 "발화"여야 합니다 — 양식을 받아 사용하세요' },
      ]);
    }

    const rows: RawUtteranceRow[] = sheetRows.slice(1).map((r) => ({
      rowNumber: r.rowNumber,
      utterance: cellText(r.cells[0]),
      countCell: cellText(r.cells[1]),
      memoCell: cellText(r.cells[2]),
    }));
    return { kind, rows };
  }
}

/** 셀 값을 문자열로 — 수식·서식 객체가 `String()`으로 "[object Object]"가 된 경우는 빈 값으로 본다(값만 읽는다). */
function cellText(value: string | undefined): string {
  if (value === undefined) return '';
  return value === '[object Object]' ? '' : value;
}
