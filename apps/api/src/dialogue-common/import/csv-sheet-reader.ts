import { Injectable } from '@nestjs/common';
import type { SheetReader, SheetRow } from './sheet-reader';
import { ImportFileTooLargeError } from './sheet-reader';

/**
 * 자체 구현 CSV 파서(의존성 0, ADR-0007). UTF-8 BOM 제거·따옴표 이스케이프(`""`)·CRLF/LF를 처리한다.
 */
@Injectable()
export class CsvSheetReader implements SheetReader {
  async read(buffer: Buffer, maxRows: number): Promise<SheetRow[]> {
    let text = buffer.toString('utf-8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // UTF-8 BOM 제거(AC-6B-9)

    const rows: SheetRow[] = [];
    let cells: string[] = [];
    let cell = '';
    let inQuotes = false;
    let rowNumber = 1;

    const pushCell = (): void => {
      cells.push(cell);
      cell = '';
    };
    const pushRow = (): void => {
      pushCell();
      const isBlankRow = cells.length === 1 && cells[0].trim() === '';
      if (!isBlankRow) {
        rows.push({ rowNumber, cells });
        rowNumber += 1;
        if (rows.length > maxRows + 1) throw new ImportFileTooLargeError(); // +1은 헤더행
      } else {
        rowNumber += 1;
      }
      cells = [];
    };

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          cell += ch;
        }
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        continue;
      }
      if (ch === ',') {
        pushCell();
        continue;
      }
      if (ch === '\r') continue;
      if (ch === '\n') {
        pushRow();
        continue;
      }
      cell += ch;
    }
    if (cell.length > 0 || cells.length > 0) pushRow();

    return rows;
  }
}
