import ExcelJS from 'exceljs';
import { unzipSync, zipSync } from 'fflate';
import { XlsxSheetReader } from '../../dialogue-common/import/xlsx-sheet-reader';
import { XLSX_MAX_ENTRY_BYTES, XLSX_MAX_UNCOMPRESSED_BYTES, XlsxTooLargeError, reorderXlsxEntries } from './xlsx-order';

async function exceljsFile(rows = 2): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('발화');
  sheet.addRow(['발화', '발생 횟수', '출처 메모']);
  sheet.addRow(['환불 신청은 어떻게 하나요', 3, '메모']);
  for (let i = 1; i < rows; i += 1) sheet.addRow([`배송 조회는 어디서 하나요 ${i}`, '', '']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('xlsx-order — XLSX 항목 순서 정규화', () => {
  it('exceljs가 만든 파일은 workbook.xml이 맨 끝에 있다(기존 리더가 읽지 못할 수 있는 원인 — 읽기 성공 여부는 단언하지 않는다)', async () => {
    const names = Object.keys(unzipSync(new Uint8Array(await exceljsFile())));
    expect(names[names.length - 1]).toBe('xl/workbook.xml');
  });

  it('순서를 바로잡으면 기존 리더가 그대로 읽는다', async () => {
    const fixed = await reorderXlsxEntries(await exceljsFile(3));
    const rows = await new XlsxSheetReader().read(fixed, 100);
    expect(rows.map((r) => r.cells[0])).toEqual(['발화', '환불 신청은 어떻게 하나요', '배송 조회는 어디서 하나요 1', '배송 조회는 어디서 하나요 2']);
    expect(rows[0].cells).toEqual(['발화', '발생 횟수', '출처 메모']);
    expect(rows[1].cells.slice(0, 3)).toEqual(['환불 신청은 어떻게 하나요', '3', '메모']);
    const names = Object.keys(unzipSync(new Uint8Array(fixed)));
    expect(names.indexOf('xl/workbook.xml')).toBeLessThan(names.indexOf('xl/worksheets/sheet1.xml'));
  });

  it('이미 올바른 순서의 파일도 그대로 읽힌다(멱등)', async () => {
    const twice = await reorderXlsxEntries(await reorderXlsxEntries(await exceljsFile()));
    expect((await new XlsxSheetReader().read(twice, 100)).length).toBe(3);
  });

  it('정직한 대용량 파일(5,000행)도 통과한다', async () => {
    const big = await exceljsFile(5000);
    expect(big.length).toBeLessThan(5 * 1024 * 1024);
    const rows = await new XlsxSheetReader().read(await reorderXlsxEntries(big), 6000);
    expect(rows.length).toBe(5001);
  }, 30_000);

  it('ZIP이 아닌 바이트열은 거부한다(호출부가 IMPORT_FILE_INVALID로 변환)', async () => {
    await expect(reorderXlsxEntries(Buffer.from('PK\x03\x04garbage'))).rejects.toThrow();
  });

  it('전체 압축 해제 크기가 상한(30MB)을 넘으면 압축을 풀기 전에 XlsxTooLargeError', async () => {
    const chunk = new Uint8Array(XLSX_MAX_ENTRY_BYTES - 1024).fill(65);
    const zipped = Buffer.from(zipSync({ a: chunk, b: chunk }, { level: 1 }));
    expect(chunk.length * 2).toBeGreaterThan(XLSX_MAX_UNCOMPRESSED_BYTES);
    expect(zipped.length).toBeLessThan(2 * 1024 * 1024);
    await expect(reorderXlsxEntries(zipped)).rejects.toBeInstanceOf(XlsxTooLargeError);
  });

  it('항목 하나가 항목별 상한(20MB)을 넘어도 거부한다', async () => {
    const zipped = Buffer.from(zipSync({ 'xl/worksheets/sheet1.xml': new Uint8Array(XLSX_MAX_ENTRY_BYTES + 1024).fill(66) }, { level: 1 }));
    await expect(reorderXlsxEntries(zipped)).rejects.toBeInstanceOf(XlsxTooLargeError);
  });

  it('압축 해제·재포장 동안 이벤트 루프가 계속 돈다(동기 점유 없음)', async () => {
    const big = await exceljsFile(5000);
    let ticks = 0;
    let running = true;
    const spin = () => {
      if (!running) return;
      ticks += 1;
      setImmediate(spin);
    };
    setImmediate(spin);
    try {
      await reorderXlsxEntries(big);
    } finally {
      running = false;
    }
    expect(ticks).toBeGreaterThan(0); // 이벤트 루프가 한 번이라도 돌았다(동기 점유 아님)
  }, 30_000);
});
