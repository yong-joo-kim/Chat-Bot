import ExcelJS from 'exceljs';
import { zipSync } from 'fflate';
import { XlsxSheetReader } from './xlsx-sheet-reader';
import { ImportFileTooLargeError } from './sheet-reader';
import { buildXlsxTemplate } from './lib/xlsx-writer';
import { reorderXlsxEntries } from './lib/xlsx-order';

/**
 * D-5 재현 시험 — 리더를 모킹하지 않는다. `buildXlsxTemplate`(exceljs 생성기) 출력은 `xl/workbook.xml`이 워크시트
 * 뒤에 오는데, 스트리밍 리더는 그 순서를 못 읽어 "자기 템플릿을 자기 리더가 못 읽는" 결함이 있었다.
 */
describe('XlsxSheetReader — 실제 xlsx 읽기(D-5)', () => {
  it('buildXlsxTemplate 출력(workbook.xml이 뒤에 오는 파일)을 그대로 읽는다', async () => {
    const buf = await buildXlsxTemplate(['이름', '예문', '설명']);
    const rows = await new XlsxSheetReader().read(buf, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toEqual(['이름', '예문', '설명']);
  });

  it('exceljs로 만든 데이터 행도 읽는다(행 번호 보존)', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('s');
    sheet.addRow(['a', 'b']);
    sheet.addRow(['1', 2]);
    const rows = await new XlsxSheetReader().read(Buffer.from(await wb.xlsx.writeBuffer()), 100);
    expect(rows.map((r) => [r.rowNumber, r.cells])).toEqual([
      [1, ['a', 'b']],
      [2, ['1', '2']],
    ]);
  });

  it('이미 올바른 순서로 재포장된 파일도 읽는다(멱등)', async () => {
    const fixed = await reorderXlsxEntries(await buildXlsxTemplate(['x']));
    expect((await new XlsxSheetReader().read(fixed, 10)).length).toBe(1);
  });

  it('행 수 상한 초과는 기존과 같은 ImportFileTooLargeError', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('s');
    for (let i = 0; i < 10; i += 1) sheet.addRow([`r${i}`]);
    await expect(new XlsxSheetReader().read(Buffer.from(await wb.xlsx.writeBuffer()), 3)).rejects.toBeInstanceOf(ImportFileTooLargeError);
  });

  it('압축 폭탄(해제 크기 초과)은 공통 경로에서도 ImportFileTooLargeError(→ 호출부 IMPORT_TOO_LARGE)', async () => {
    const zipped = Buffer.from(zipSync({ 'xl/worksheets/sheet1.xml': new Uint8Array(21 * 1024 * 1024).fill(66) }, { level: 1 }));
    await expect(new XlsxSheetReader().read(zipped, 100)).rejects.toBeInstanceOf(ImportFileTooLargeError);
  });
});
