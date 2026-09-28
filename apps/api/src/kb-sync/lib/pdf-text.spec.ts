import { extractPdfText, isPdfEncryptedHeuristic, MAX_PDF_TEXT_BYTES, takeWithinBudget } from './pdf-text';

/** 최소 유효 PDF(글자 1줄) — xref 오프셋을 실제로 계산해 만든다. */
function buildMinimalPdf(text: string): Uint8Array {
  const objs = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n',
    '4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n',
  ];
  const stream = `BT /F1 24 Tf 72 100 Td (${text}) Tj ET`;
  objs.push(`5 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n`);
  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const o of objs) {
    offsets.push(body.length);
    body += o;
  }
  const xrefStart = body.length;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i += 1) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  body += xref;
  body += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return new Uint8Array(Buffer.from(body, 'latin1'));
}

// [구현 편차 기록 §25] `pdfjs-dist` legacy 빌드는 최상위 `await`가 있는 순수 ESM이라 진짜 동적
// `import()`가 필요하다(`common/lib/import-esm.ts`). Jest의 CommonJS 실행 sandbox(vm)는 Node
// `--experimental-vm-modules` 플래그 없이 동적 import를 지원하지 않는다(실측 오류: "A dynamic import
// callback was invoked without --experimental-vm-modules"). 이 플래그를 전역 jest 실행에 추가하면
// 기존 260여개 spec 전체의 실행 방식이 바뀌는 큰 회귀 위험이 있어, 이 그룹만을 위해 도입하지
// 않는다. 대신 수동 스모크 스크립트로 실제 동작을 확인했다(node로 직접 실행 — pdfjs-dist가 정상
// 텍스트를 추출함을 확인). `isEvalSupported:false`가 적용된 상태로 확인됐다. 자동 시험은 이 플래그가
// 설정된 경우에만 돈다(없으면 건너뜀 — worker_threads 스모크 시험과 같은 규약, §7.2).
const RUN_PDF_SMOKE = process.env.KB_PDF_SMOKE_TEST === '1';
(RUN_PDF_SMOKE ? describe : describe.skip)('extractPdfText(스모크 — KB_PDF_SMOKE_TEST=1일 때만)', () => {
  it('최소 PDF에서 텍스트를 추출한다(isEvalSupported:false로도 정상 동작)', async () => {
    const bytes = buildMinimalPdf('Hello PDF');
    const result = await extractPdfText(bytes);
    expect(result.text).toContain('Hello PDF');
    expect(result.pageCount).toBe(1);
    expect(result.encrypted).toBe(false);
  });
});

describe('isPdfEncryptedHeuristic', () => {
  it('헤더가 %PDF-가 아니면 false', () => {
    expect(isPdfEncryptedHeuristic(new TextEncoder().encode('not a pdf'))).toBe(false);
  });
  it('트레일러 부근에 /Encrypt 토큰이 있으면 true(EX-KB-9)', () => {
    const withEncrypt = new TextEncoder().encode('%PDF-1.4\n...trailer<</Encrypt 7 0 R/Size 8>>');
    expect(isPdfEncryptedHeuristic(withEncrypt)).toBe(true);
  });
  it('정상 PDF는 false', () => {
    expect(isPdfEncryptedHeuristic(buildMinimalPdf('x'))).toBe(false);
  });
});

describe('takeWithinBudget — 추출 텍스트 누적 상한(M-6 · §7.3 2MB)', () => {
  it('예산 안이면 그대로 돌려준다', () => {
    expect(takeWithinBudget('가나다', 100)).toEqual({ text: '가나다', bytes: 9, exceeded: false });
  });
  it('★ 예산을 넘으면 잘라내고 exceeded를 알린다 — 멀티바이트 문자가 잘리면 그 문자는 버린다', () => {
    const r = takeWithinBudget('가나다라', 10); // 한글 1자 = 3바이트 → 3자(9바이트)까지
    expect(r.exceeded).toBe(true);
    expect(r.text).toBe('가나다');
    expect(r.bytes).toBe(9);
  });
  it('남은 예산이 0이면 빈 문자열', () => {
    expect(takeWithinBudget('abc', 0)).toEqual({ text: '', bytes: 0, exceeded: true });
  });
  it('상한 상수는 설계 §7.3의 2MB다', () => {
    expect(MAX_PDF_TEXT_BYTES).toBe(2 * 1024 * 1024);
  });
});
