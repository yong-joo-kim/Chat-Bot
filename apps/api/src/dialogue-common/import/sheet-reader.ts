/** 업로드 파일 한 행 — `rowNumber`는 파일 내 실제 행 번호(1-base, 헤더 포함)다. */
export interface SheetRow {
  rowNumber: number;
  cells: string[];
}

/** CSV/XLSX 파서 공통 인터페이스(ADR-0007). 새 포맷 추가 시 이 인터페이스의 구현체만 늘어난다. */
export interface SheetReader {
  read(buffer: Buffer, maxRows: number): Promise<SheetRow[]>;
}

/** 행 수 상한 초과(압축 폭탄 방어, NFR-S6) — 서비스가 `IMPORT_TOO_LARGE`로 변환한다. */
export class ImportFileTooLargeError extends Error {
  constructor() {
    super('업로드 파일의 행 수가 허용 한도를 초과했습니다.');
  }
}
