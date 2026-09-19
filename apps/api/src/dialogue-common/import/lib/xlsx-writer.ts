import ExcelJS from 'exceljs';

/** xlsx 템플릿 생성(FR-6-19). 내보내기는 CSV만 지원한다(ADR-0007 — xlsx는 템플릿에만 제공). */
export async function buildXlsxTemplate(headers: string[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('template');
  sheet.addRow(headers);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
