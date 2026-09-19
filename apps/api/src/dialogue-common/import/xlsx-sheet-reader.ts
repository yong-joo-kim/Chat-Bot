import { Injectable } from '@nestjs/common';
import { Readable } from 'stream';
import ExcelJS from 'exceljs';
import type { SheetReader, SheetRow } from './sheet-reader';
import { ImportFileTooLargeError } from './sheet-reader';

/**
 * `exceljs` 스트리밍 리더 기반 XLSX 파서(ADR-0007). 첫 번째 워크시트만 사용하고
 * `maxRows` 도달 시 즉시 중단한다(압축 폭탄 방어, NFR-S6). 업로드 파일은 파싱 후 즉시 버려진다.
 */
@Injectable()
export class XlsxSheetReader implements SheetReader {
  async read(buffer: Buffer, maxRows: number): Promise<SheetRow[]> {
    const rows: SheetRow[] = [];
    const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
      entries: 'emit',
      sharedStrings: 'cache',
      styles: 'ignore',
      worksheets: 'emit',
    });

    outer: for await (const worksheetReader of workbookReader) {
      for await (const row of worksheetReader) {
        const cells: string[] = [];
        const values = row.values as unknown[];
        // ExcelJS row.values는 1-base(인덱스 0은 비어있음) — 1번 인덱스부터 읽는다.
        for (let i = 1; i < values.length; i += 1) {
          const v = values[i];
          cells.push(v === null || v === undefined ? '' : String(v));
        }
        rows.push({ rowNumber: row.number, cells });
        if (rows.length > maxRows + 1) throw new ImportFileTooLargeError();
      }
      break outer; // 첫 번째 워크시트만 사용
    }

    return rows;
  }
}
