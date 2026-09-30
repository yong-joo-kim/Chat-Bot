import { hasZipSignature, looksLikeUtf8Text, sniffUploadKind } from './file-sniff';

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);

describe('file-sniff — 내용 기반 형식 판별(설계서 §7.1, AC-DC2-4)', () => {
  it('.xlsx는 ZIP 로컬 헤더 서명으로 시작해야 한다', () => {
    expect(hasZipSignature(ZIP)).toBe(true);
    expect(sniffUploadKind('a.xlsx', ZIP)).toBe('XLSX');
    // 확장자만 바꾼 텍스트 파일
    expect(sniffUploadKind('fake.xlsx', Buffer.from('발화,발생 횟수\n환불,1\n', 'utf-8'))).toBeNull();
    expect(sniffUploadKind('a.xlsx', Buffer.from([0x50, 0x4b]))).toBeNull();
  });

  it('.csv는 NUL 바이트가 없고 UTF-8 디코딩 이상이 5% 이하여야 한다', () => {
    expect(sniffUploadKind('a.csv', Buffer.from('발화\n환불 문의\n', 'utf-8'))).toBe('CSV');
    expect(sniffUploadKind('a.csv', Buffer.from('﻿발화\n환불\n', 'utf-8'))).toBe('CSV'); // BOM 허용
    expect(sniffUploadKind('a.csv', Buffer.from('발화\0환불', 'utf-8'))).toBeNull(); // NUL
    expect(sniffUploadKind('a.csv', ZIP)).toBeNull(); // ZIP을 csv로 위장
    // EUC-KR 등 UTF-8이 아닌 바이트열 — 치환문자 비율 초과
    expect(looksLikeUtf8Text(Buffer.from([0xb9, 0xdf, 0xc8, 0xad, 0xb9, 0xdf, 0xc8, 0xad, 0xb9, 0xdf]))).toBe(false);
  });

  it('확장자가 .xlsx·.csv가 아니면 null이다(대소문자 무시)', () => {
    expect(sniffUploadKind('a.txt', Buffer.from('발화'))).toBeNull();
    expect(sniffUploadKind('A.CSV', Buffer.from('발화\n환불\n'))).toBe('CSV');
    expect(sniffUploadKind('A.XLSX', ZIP)).toBe('XLSX');
  });

  it('빈 CSV는 텍스트로 본다(빈 파일 거부는 파서의 "데이터 행 없음" 검사가 맡는다)', () => {
    expect(looksLikeUtf8Text(Buffer.alloc(0))).toBe(true);
  });
});
