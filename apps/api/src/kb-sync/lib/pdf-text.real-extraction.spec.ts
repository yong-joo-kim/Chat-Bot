import { fork } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * [신규 No.43 — 항목①] `extractPdfText()` 실제 추출을 **자동으로**(기본 SKIP 없이) 돈다.
 *
 * 배경 — `pdfjs-dist`의 legacy 빌드는 최상위 `await`가 있는 순수 ESM이라 진짜 동적 `import()`가
 * 필요하다(`common/lib/import-esm.ts`). Jest의 CommonJS 실행 sandbox(vm)는 `--experimental-vm-modules`
 * 없이는 동적 import를 지원하지 않는다 — 이 플래그를 전역 jest 실행에 추가하면 기존 260여개 spec
 * 전체의 실행 방식이 바뀌는 회귀 위험이 있다(`pdf-text.spec.ts`의 기존 §25 기록 참고, 그 파일은
 * 건드리지 않는다 — 새 파일로만 이 항목을 완성한다).
 *
 * 해법 — Jest의 vm 샌드박스를 **완전히 벗어난 진짜 Node 자식 프로세스**(`child_process.fork`)에서
 * `ts-node`(transpile-only)로 `pdf-text.ts`를 그대로 로드해 돌린다. 진짜 V8 컨텍스트라 동적 import에
 * 아무 제약이 없다 — 그래서 `--experimental-vm-modules`도, jest 설정 변경도 필요 없다.
 */

const API_ROOT = join(__dirname, '..', '..', '..');
const PDF_TEXT_MODULE_PATH = join(__dirname, 'pdf-text.ts').replace(/\\/g, '/');

/** `pdf-text.spec.ts`의 것과 동일한 방식(xref 오프셋 실제 계산)으로 최소 유효 PDF를 만든다. */
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

interface RunnerOk {
  ok: true;
  text: string;
  pageCount: number;
  encrypted: boolean;
  truncated: boolean;
}
interface RunnerErr {
  ok: false;
  error: string;
}

/** 자식 프로세스(진짜 Node, jest vm 아님)에서 `extractPdfText(bytes)`를 실행하고 결과를 IPC로 받는다. */
function runExtractInRealProcess(pdfBytesFilePath: string, runnerFilePath: string): Promise<RunnerOk | RunnerErr> {
  return new Promise((resolve, reject) => {
    const child = fork(runnerFilePath, [pdfBytesFilePath], {
      cwd: API_ROOT,
      env: { ...process.env, TS_NODE_PROJECT: join(API_ROOT, 'tsconfig.json'), TS_NODE_TRANSPILE_ONLY: 'true' },
      execArgv: ['-r', 'ts-node/register'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      silent: true,
    });

    let stderr = '';
    child.stderr?.on('data', (c) => (stderr += String(c)));

    let settled = false;
    child.on('message', (msg: RunnerOk | RunnerErr) => {
      settled = true;
      resolve(msg);
    });
    child.on('error', (e) => {
      if (!settled) reject(e);
    });
    child.on('exit', (code) => {
      if (!settled && code !== 0) reject(new Error(`자식 프로세스가 메시지 없이 종료됨(code=${code}): ${stderr.slice(0, 2000)}`));
    });
  });
}

describe('extractPdfText — 항목① 실제 추출(진짜 Node 자식 프로세스, 기본 SKIP 없음)', () => {
  let tmpDir: string;
  let runnerFilePath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-pdf-extract-test-'));
    runnerFilePath = join(tmpDir, 'runner.ts');
    // ts-node(transpile-only)로 실행될 진입점 — `pdf-text.ts`를 절대경로로 그대로 불러온다.
    const runnerSource = [
      "const { readFileSync } = require('node:fs');",
      `const { extractPdfText } = require(${JSON.stringify(PDF_TEXT_MODULE_PATH)});`,
      'const pdfPath = process.argv[2];',
      'const bytes = new Uint8Array(readFileSync(pdfPath));',
      'extractPdfText(bytes)',
      '  .then((result) => { process.send({ ok: true, ...result }); process.exit(0); })',
      "  .catch((e) => { process.send({ ok: false, error: e instanceof Error ? e.message : String(e) }); process.exit(1); });",
    ].join('\n');
    writeFileSync(runnerFilePath, runnerSource, 'utf8');
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 정리 실패는 판정에 영향 없음.
    }
  });

  it('최소 PDF에서 실제로 텍스트를 추출한다(isEvalSupported:false로도 정상 동작)', async () => {
    const pdfPath = join(tmpDir, 'minimal.pdf');
    writeFileSync(pdfPath, Buffer.from(buildMinimalPdf('Hello PDF')));

    const result = await runExtractInRealProcess(pdfPath, runnerFilePath);
    if (!result.ok) throw new Error(`추출 실패: ${result.error}`);

    expect(result.text).toContain('Hello PDF');
    expect(result.pageCount).toBe(1);
    expect(result.encrypted).toBe(false);
    expect(result.truncated).toBe(false);
  }, 30_000);

  it('/Encrypt 트레일러가 있는 PDF는 실제 파서 호출 없이 encrypted=true로 즉시 반환한다', async () => {
    const encryptedPdf = new TextEncoder().encode('%PDF-1.4\n...trailer<</Encrypt 7 0 R/Size 8>>');
    const pdfPath = join(tmpDir, 'encrypted.pdf');
    writeFileSync(pdfPath, Buffer.from(encryptedPdf));

    const result = await runExtractInRealProcess(pdfPath, runnerFilePath);
    if (!result.ok) throw new Error(`추출 실패: ${result.error}`);
    expect(result.encrypted).toBe(true);
    expect(result.text).toBe('');
  }, 30_000);
});
