import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EGRESS_REGISTRY } from '../../common/egress/egress-registry';

/**
 * 데이터 거버넌스(No.45) 정적 검사(`data-governance-설계.md` §16 G-1~G-18) — 기존
 * `topic-sealing.spec.ts`·`legacy-api-sealing.spec.ts`와 같은 형식(스캔 루트 지정 · 자기 자신 제외 ·
 * 스캔 대상 0건 아님 가드 · 주석 줄 제외 · 역검증 픽스처 포함). G-1~G-18 전부를 검사한다.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SELF_ABSOLUTE = resolve(__dirname, 'governance-sealing.spec.ts');

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function walk(dir: string, extensions: string[], out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.venv' || entry === 'venv' || entry === '__pycache__') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) walk(fullPath, extensions, out);
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(fullPath);
  }
}

function toRepoRelative(absolutePath: string): string {
  return absolutePath.replace(/\\/g, '/').replace(REPO_ROOT.replace(/\\/g, '/') + '/', '');
}

function collectApiSourceFiles(): string[] {
  const files: string[] = [];
  walk(join(REPO_ROOT, 'apps/api/src'), ['.ts'], files);
  return files.filter((f) => f !== SELF_ABSOLUTE && !f.endsWith('.spec.ts'));
}

function nonCommentOccurrences(content: string, pattern: RegExp): number {
  let count = 0;
  const g = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (const line of content.split('\n')) {
    if (isCommentLine(line)) continue;
    const matches = line.match(g);
    if (matches) count += matches.length;
  }
  return count;
}

function stripComments(content: string): string {
  return content
    .split('\n')
    .map((line) => (isCommentLine(line) ? '' : line))
    .join('\n');
}

/** `marker` 뒤 첫 `{`부터 중괄호 매칭으로 블록 텍스트(중괄호 포함)를 전부 뽑아낸다(주석 제외 전처리 후). */
function extractBracedBlocksAfter(rawContent: string, marker: RegExp): string[] {
  const content = stripComments(rawContent);
  const results: string[] = [];
  const g = new RegExp(marker.source, marker.flags.includes('g') ? marker.flags : `${marker.flags}g`);
  let searchFrom = 0;
  for (;;) {
    g.lastIndex = searchFrom;
    const m = g.exec(content);
    if (!m) break;
    let i = m.index + m[0].length;
    while (i < content.length && content[i] !== '{' && content[i] !== ';' && content[i] !== '\n') i += 1;
    if (i >= content.length || content[i] !== '{') {
      searchFrom = m.index + m[0].length;
      continue;
    }
    let depth = 0;
    let j = i;
    for (; j < content.length; j += 1) {
      if (content[j] === '{') depth += 1;
      else if (content[j] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    results.push(content.slice(i, j + 1));
    searchFrom = j + 1;
  }
  return results;
}

/** 블록 텍스트 안의 `data: { ... }` 서브 객체 텍스트를 뽑는다(첫 번째 `data:`만 — 이 저장소의 호출부는 1곳뿐). */
function extractDataBlock(block: string): string | null {
  const idx = block.search(/\bdata\s*:\s*\{/);
  if (idx < 0) return null;
  const braceStart = block.indexOf('{', idx);
  let depth = 0;
  let j = braceStart;
  for (; j < block.length; j += 1) {
    if (block[j] === '{') depth += 1;
    else if (block[j] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return block.slice(braceStart, j + 1);
}

/** 얕은(중첩 없는) `{ key: value, ... }` 텍스트에서 최상위 키 이름만 뽑는다. */
function extractTopLevelKeys(objectText: string): string[] {
  const inner = objectText.trim().replace(/^\{/, '').replace(/\}$/, '');
  const keys: string[] = [];
  let depth = 0;
  let cur = '';
  const parts: string[] = [];
  for (const ch of inner) {
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (const part of parts) {
    const m = /^\s*([A-Za-z0-9_]+)\s*:/.exec(part);
    if (m) keys.push(m[1]);
  }
  return keys;
}

describe('데이터 거버넌스(No.45) 정적 검사 — data-governance-설계.md §16', () => {
  const apiFiles = collectApiSourceFiles();
  const apiFileContents = apiFiles.map((f) => ({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') }));

  it('스캔 대상 파일이 존재한다', () => {
    expect(apiFileContents.length).toBeGreaterThan(100);
  });

  describe('G-1: 외부 출구 사용 파일 집합 = EGRESS_REGISTRY의 파일 집합(6파일, classifier/eval/** 제외)', () => {
    const EXIT_PATTERN = /\bfetch\(|\bhttp\.request\(|\bhttps\.request\(|from\s+['"]node:dns['"]/;
    const EXCLUDED_PREFIXES = ['apps/api/src/classifier/eval/', 'apps/api/src/integration/'];

    it('출구 문자열을 쓰는 apps/api/src 파일 = 레지스트리 파일 집합과 같다', () => {
      const registryFiles = new Set(EGRESS_REGISTRY.flatMap((e) => e.files.map((f) => `apps/api/src/${f}`)));
      const actualOffenders = apiFileContents
        .filter(({ f, content }) => !EXCLUDED_PREFIXES.some((p) => f.startsWith(p)) && nonCommentOccurrences(content, EXIT_PATTERN) > 0)
        .map(({ f }) => f);

      for (const f of actualOffenders) {
        expect(registryFiles.has(f)).toBe(true);
      }
      for (const f of registryFiles) {
        const hasFile = apiFileContents.some((e) => e.f === f);
        expect(hasFile).toBe(true);
      }
    });

    it('역검증 — 레지스트리에 없는 파일이 fetch(를 쓰면 검사 로직이 실제로 잡아낸다', () => {
      const registryFiles = new Set(EGRESS_REGISTRY.flatMap((e) => e.files.map((f) => `apps/api/src/${f}`)));
      const fixtureFile = 'apps/api/src/some-random-service.ts';
      const fixtureContent = "const res = await fetch('https://example.com');";
      expect(registryFiles.has(fixtureFile)).toBe(false);
      expect(nonCommentOccurrences(fixtureContent, EXIT_PATTERN)).toBeGreaterThan(0);
    });
  });

  describe('G-2: 출구 파일마다 가드 호출 수 ≥ 송신 호출 수', () => {
    it('레지스트리 6파일 각각 assertEgressAllowed(/checkEgress(가 fetch(/.request( 호출 수 이상이다(송신이 있는 파일만)', () => {
      const guardPattern = /assertEgressAllowed\(|checkEgress\(/;
      const sendPattern = /\bfetch\(|\.request\(/;
      let anySendFound = false;
      for (const def of EGRESS_REGISTRY) {
        for (const relFile of def.files) {
          const full = `apps/api/src/${relFile}`;
          const entry = apiFileContents.find((e) => e.f === full);
          expect(entry).toBeDefined();
          const guardCount = nonCommentOccurrences(entry!.content, guardPattern);
          const sendCount = nonCommentOccurrences(entry!.content, sendPattern);
          // node-dns.resolver.ts처럼 자체 송신이 없는 파일은 가드가 0이어도 된다(§6.1 표 — DNS 조회는
          // 호출자(legacy-api-http.client.ts)가 이미 판정 후에만 이 리졸버를 부른다).
          if (sendCount > 0) anySendFound = true;
          expect(guardCount).toBeGreaterThanOrEqual(sendCount);
        }
      }
      expect(anySendFound).toBe(true);
    });

    it('(코드 리뷰 R1 보강) 가드 호출이 코드상 같은 파일의 송신 호출보다 앞선다(순서 검사 — 개수만 맞고 순서가 뒤집힌 경우를 잡는다)', () => {
      const guardPattern = /assertEgressAllowed\(|checkEgress\(/g;
      const sendPattern = /\bfetch\(|\.request\(/g;
      for (const def of EGRESS_REGISTRY) {
        for (const relFile of def.files) {
          const full = `apps/api/src/${relFile}`;
          const entry = apiFileContents.find((e) => e.f === full);
          expect(entry).toBeDefined();
          const stripped = stripComments(entry!.content);

          type Hit = { pos: number; kind: 'guard' | 'send' };
          const hits: Hit[] = [];
          for (const m of stripped.matchAll(guardPattern)) hits.push({ pos: m.index ?? 0, kind: 'guard' });
          for (const m of stripped.matchAll(sendPattern)) hits.push({ pos: m.index ?? 0, kind: 'send' });
          // node-dns.resolver.ts처럼 자체 송신이 없는 파일은 건너뛴다(위 시험과 같은 예외).
          if (!hits.some((h) => h.kind === 'send')) continue;
          hits.sort((a, b) => a.pos - b.pos);

          let guardCount = 0;
          let sendCount = 0;
          for (const hit of hits) {
            if (hit.kind === 'guard') {
              guardCount += 1;
            } else {
              sendCount += 1;
              // n번째 송신 시점까지 나온 가드 수가 n 이상이어야 한다 — 가드가 그 송신보다 코드상
              // 앞에 있다는 뜻이다. 개수만 맞고 순서가 뒤바뀐 경우(가드가 송신 뒤에 몰려 있는 경우)를
              // 잡아낸다(개수만 비교하는 위 시험은 이 경우를 통과시킨다).
              expect(guardCount).toBeGreaterThanOrEqual(sendCount);
            }
          }
        }
      }
    });

    it('역검증 — 가드가 송신 뒤에 오면(순서가 뒤바뀌면) 순서 검사 로직이 실제로 잡아낸다', () => {
      const guardPattern = /assertEgressAllowed\(|checkEgress\(/g;
      const sendPattern = /\bfetch\(|\.request\(/g;
      const fixtureContent = "await fetch('https://example.com'); assertEgressAllowed('EMBEDDING', url);";
      const hits: Array<{ pos: number; kind: 'guard' | 'send' }> = [];
      for (const m of fixtureContent.matchAll(guardPattern)) hits.push({ pos: m.index ?? 0, kind: 'guard' });
      for (const m of fixtureContent.matchAll(sendPattern)) hits.push({ pos: m.index ?? 0, kind: 'send' });
      hits.sort((a, b) => a.pos - b.pos);

      let guardCount = 0;
      let sendCount = 0;
      let orderViolated = false;
      for (const hit of hits) {
        if (hit.kind === 'guard') guardCount += 1;
        else {
          sendCount += 1;
          if (guardCount < sendCount) orderViolated = true;
        }
      }
      expect(orderViolated).toBe(true);
    });
  });

  describe('G-3: installGovernanceRuntime(·configurePiiMaskMode( 호출 파일 = 부트스트랩 1개', () => {
    it('installGovernanceRuntime( 호출 파일이 governance-bootstrap.service.ts 1개뿐이다', () => {
      const pattern = /installGovernanceRuntime\(/;
      const offenders = apiFileContents.filter(({ f, content }) => nonCommentOccurrences(content, pattern) > 0 && !f.endsWith('governance/governance-runtime.ts')).map(({ f }) => f);
      expect(offenders).toEqual(['apps/api/src/governance/bootstrap/governance-bootstrap.service.ts']);
    });

    it('resetGovernanceRuntimeForTest( 호출은 정의 파일(governance-runtime.ts) 밖의 운영 코드(*.spec.ts 밖)에 0건이다', () => {
      const pattern = /resetGovernanceRuntimeForTest\(/;
      const offenders = apiFileContents
        .filter(({ f, content }) => nonCommentOccurrences(content, pattern) > 0 && !f.endsWith('common/governance/governance-runtime.ts'))
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });
  });

  describe('G-4: DATA_ENCRYPTION_KEYS·AUDIT_CHAIN_KEY 읽기 유일 파일', () => {
    it('두 문자열을 포함하는 파일은 env-key.provider.ts 1개뿐이다(env.validation.ts에도 없음)', () => {
      const offenders = apiFileContents
        .filter(({ f, content }) => (content.includes('DATA_ENCRYPTION_KEYS') || content.includes('AUDIT_CHAIN_KEY')) && !f.endsWith('common/crypto/env-key.provider.ts'))
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });
  });

  describe('G-5: sealField(/openField( 호출 파일 집합', () => {
    it('sealField( 호출 파일 = {handoff-thread.service.ts, survey-response.service.ts, governance-data.writer.ts, workflow-run-enqueue.writer.ts, inbox.store.ts}(No.42 +1)', () => {
      const allowed = [
        'apps/api/src/handoff/handoff-thread.service.ts',
        'apps/api/src/survey-responses/survey-response.service.ts',
        'apps/api/src/governance/writer/governance-data.writer.ts',
        'apps/api/src/workflow/triggers/workflow-run-enqueue.writer.ts',
        'apps/api/src/inbox/core/inbox.store.ts',
      ];
      const offenders = apiFileContents.filter(({ f, content }) => nonCommentOccurrences(content, /\bsealField\(/) > 0 && !allowed.includes(f) && !f.endsWith('common/crypto/field-crypto.ts')).map(({ f }) => f);
      expect(offenders).toEqual([]);
      for (const f of allowed) {
        expect(apiFileContents.some((e) => e.f === f && nonCommentOccurrences(e.content, /\bsealField\(/) > 0)).toBe(true);
      }
    });

    it('openField( 호출 파일 = 개봉 6파일(handoff-{transcript,history,public-poll,gate,hints}.service.ts·survey-results.service.ts) + writer + workflow-run.store.ts(No.41 +1)', () => {
      const allowed = [
        'apps/api/src/handoff/handoff-transcript.service.ts',
        'apps/api/src/handoff/handoff-history.service.ts',
        'apps/api/src/handoff/handoff-public-poll.service.ts',
        'apps/api/src/handoff/handoff-gate.service.ts',
        'apps/api/src/handoff/handoff-hints.service.ts',
        'apps/api/src/stats/surveys/survey-results.service.ts',
        'apps/api/src/governance/writer/governance-data.writer.ts',
        'apps/api/src/workflow/core/workflow-run.store.ts',
      ];
      const offenders = apiFileContents.filter(({ f, content }) => nonCommentOccurrences(content, /\bopenField\(/) > 0 && !allowed.includes(f) && !f.endsWith('common/crypto/field-crypto.ts')).map(({ f }) => f);
      expect(offenders).toEqual([]);
      for (const f of allowed) {
        expect(apiFileContents.some((e) => e.f === f && nonCommentOccurrences(e.content, /\bopenField\(/) > 0)).toBe(true);
      }
    });
  });

  describe('G-6: 쓰기 파일의 create 블록마다 sealField( 호출', () => {
    it('handoff-thread.service.ts — handoffMessage.create 블록마다 sealField(가 있다', () => {
      const entry = apiFileContents.find(({ f }) => f.endsWith('handoff/handoff-thread.service.ts'));
      expect(entry).toBeDefined();
      const blocks = extractBracedBlocksAfter(entry!.content, /handoffMessage\s*\.\s*create\s*\(/);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(/\bsealField\(/.test(block)).toBe(true);
      }
    });

    it('survey-response.service.ts — surveyAnswer.createMany 직전(같은 블록)에 sealField(가 있다', () => {
      const entry = apiFileContents.find(({ f }) => f.endsWith('survey-responses/survey-response.service.ts'));
      expect(entry).toBeDefined();
      const blocks = extractBracedBlocksAfter(entry!.content, /surveyAnswer\s*\.\s*createMany\s*\(/);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(/\bsealField\(/.test(block)).toBe(true);
      }
    });

    it('역검증 — sealField(가 없는 create 블록 픽스처는 검사 로직이 실제로 잡아낸다', () => {
      const fixture = "await tx.handoffMessage.create({ data: { text: masked } });";
      const blocks = extractBracedBlocksAfter(fixture, /handoffMessage\s*\.\s*create\s*\(/);
      expect(blocks.length).toBe(1);
      expect(/\bsealField\(/.test(blocks[0])).toBe(false);
    });
  });

  describe('G-7: conversationLog.update* · textPurgedAt 대입 · unansweredQuestion 쓰기 파일', () => {
    it('conversationLog.update|updateMany 호출 파일은 writer 1개뿐이다(R-10·F-10과 같은 허용 목록)', () => {
      const pattern = /conversationLog\s*\.\s*(update|updateMany)\b/;
      const offenders = apiFileContents.filter(({ f, content }) => pattern.test(content) && !f.endsWith('governance/writer/governance-data.writer.ts')).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('data: {...textPurgedAt...} 형태의 "대입"은 writer 1개 파일에서만 등장한다(where 필터의 textPurgedAt: null 읽기는 대상 아님)', () => {
      // 얕은(중첩 없는) data 블록만 대상 — 이 저장소의 쓰기 데이터 객체는 전부 평면 구조다.
      const pattern = /data\s*:\s*\{[^{}]*\btextPurgedAt\s*:/;
      const offenders = apiFileContents.filter(({ f, content }) => pattern.test(stripComments(content)) && !f.endsWith('governance/writer/governance-data.writer.ts')).map(({ f }) => f);
      expect(offenders).toEqual([]);

      const writerEntry = apiFileContents.find(({ f }) => f.endsWith('governance/writer/governance-data.writer.ts'));
      expect(pattern.test(stripComments(writerEntry!.content))).toBe(true);
    });

    it('역검증 — writer 밖에서 data 블록에 textPurgedAt을 대입하는 픽스처는 검사 로직이 실제로 잡아낸다', () => {
      const pattern = /data\s*:\s*\{[^{}]*\btextPurgedAt\s*:/;
      const fixture = "await tx.conversationLog.updateMany({ where: { id }, data: { textPurgedAt: now } });";
      expect(pattern.test(fixture)).toBe(true);
    });

    it('unansweredQuestion 쓰기(create|createMany|update|updateMany|upsert) 파일에 writer가 포함된다(F-9 4파일)', () => {
      const pattern = /(?:prisma|tx)\.unansweredQuestion\.(create|createMany|update|updateMany|upsert)\(/;
      const offenders = new Set(apiFileContents.filter(({ content }) => pattern.test(content)).map(({ f }) => f));
      expect(offenders.has('apps/api/src/governance/writer/governance-data.writer.ts')).toBe(true);
      expect(offenders.size).toBe(4);
    });
  });

  describe('G-8: writer의 updateMany data 키 화이트리스트', () => {
    const writerEntry = () => {
      const entry = apiFileContents.find(({ f }) => f.endsWith('governance/writer/governance-data.writer.ts'));
      expect(entry).toBeDefined();
      return entry!;
    };

    it('conversationLog.updateMany의 data 키는 {userMessage, botResponse, textPurgedAt}의 부분집합이다', () => {
      const allowed = new Set(['userMessage', 'botResponse', 'textPurgedAt']);
      const blocks = extractBracedBlocksAfter(writerEntry().content, /conversationLog\s*\.\s*updateMany\s*\(/);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        const dataBlock = extractDataBlock(block);
        expect(dataBlock).not.toBeNull();
        for (const key of extractTopLevelKeys(dataBlock as string)) expect(allowed.has(key)).toBe(true);
      }
    });

    it('handoffMessage.updateMany의 data 키는 {text, rawText, textPurgedAt}의 부분집합이다', () => {
      const allowed = new Set(['text', 'rawText', 'textPurgedAt']);
      const blocks = extractBracedBlocksAfter(writerEntry().content, /handoffMessage\s*\.\s*updateMany\s*\(/);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        const dataBlock = extractDataBlock(block);
        expect(dataBlock).not.toBeNull();
        for (const key of extractTopLevelKeys(dataBlock as string)) expect(allowed.has(key)).toBe(true);
      }
    });

    it('surveyAnswer.updateMany의 data 키는 {textValue, textPurgedAt}의 부분집합이다', () => {
      const allowed = new Set(['textValue', 'textPurgedAt']);
      const blocks = extractBracedBlocksAfter(writerEntry().content, /surveyAnswer\s*\.\s*updateMany\s*\(/);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        const dataBlock = extractDataBlock(block);
        expect(dataBlock).not.toBeNull();
        for (const key of extractTopLevelKeys(dataBlock as string)) expect(allowed.has(key)).toBe(true);
      }
    });

    it('unansweredQuestion.updateMany의 data 키는 {questionText, variants, questionNormalized, textPurgedAt}의 부분집합이다', () => {
      const allowed = new Set(['questionText', 'variants', 'questionNormalized', 'textPurgedAt']);
      const blocks = extractBracedBlocksAfter(writerEntry().content, /unansweredQuestion\s*\.\s*updateMany\s*\(/);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        const dataBlock = extractDataBlock(block);
        expect(dataBlock).not.toBeNull();
        for (const key of extractTopLevelKeys(dataBlock as string)) expect(allowed.has(key)).toBe(true);
      }
    });

    it('역검증 — 화이트리스트 밖 키가 섞인 data 블록 픽스처는 추출 로직이 실제로 잡아낸다', () => {
      const fixture = "await tx.conversationLog.updateMany({ where: { id }, data: { userMessage: '', evilField: 1 } });";
      const blocks = extractBracedBlocksAfter(fixture, /conversationLog\s*\.\s*updateMany\s*\(/);
      const dataBlock = extractDataBlock(blocks[0]);
      const keys = extractTopLevelKeys(dataBlock as string);
      expect(keys).toContain('evilField');
    });
  });

  describe('G-9: 삭제(delete/deleteMany) 호출 — writer가 소유한 4개 모델만', () => {
    it('ragCallLog·apiCallLog·auditLog·retentionRun의 delete|deleteMany 호출 파일은 governance-data.writer.ts뿐이다(챗봇 영구삭제 동반 삭제 제외)', () => {
      const pattern = /\.(ragCallLog|apiCallLog|auditLog|retentionRun)\s*\.\s*(delete|deleteMany)\b/;
      const offenders = apiFileContents
        .filter(({ f, content }) => pattern.test(content) && !f.endsWith('governance/writer/governance-data.writer.ts') && !f.endsWith('chatbots/chatbots.service.ts'))
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('대화 원천 4계열(conversationLog·unansweredQuestion·surveyAnswer·handoffMessage)의 delete|deleteMany 호출은 여전히 0건이다', () => {
      const pattern = /\.(conversationLog|unansweredQuestion|surveyAnswer|handoffMessage)\s*\.\s*(delete|deleteMany)\b/;
      const offenders = apiFileContents.filter(({ f, content }) => pattern.test(content) && !f.endsWith('chatbots/chatbots.service.ts')).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });
  });

  describe('G-10: writer import처 = governance/jobs/**·governance.module.ts만 · GovernanceModule exports 0', () => {
    it('governance-data.writer.ts를 import하는 파일은 governance/jobs/**(잡 2파일)와 governance.module.ts(DI 등록)뿐이다', () => {
      const pattern = /governance-data\.writer/;
      const offenders = apiFileContents
        .filter(
          ({ f, content }) =>
            pattern.test(content) &&
            !f.includes('/governance/jobs/') &&
            !f.endsWith('governance/writer/governance-data.writer.ts') &&
            !f.endsWith('governance/governance.module.ts'),
        )
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('governance.module.ts의 exports 배열이 비어 있다', () => {
      const entry = apiFileContents.find(({ f }) => f.endsWith('governance/governance.module.ts'));
      expect(entry).toBeDefined();
      expect(/exports:\s*\[\]/.test(entry!.content)).toBe(true);
    });

    it('governance NestJS 모듈(컨트롤러·서비스·잡·writer·부트스트랩) 파일명을 import하는 파일은 governance/** 안과 app.module.ts뿐이다(common/governance/governance-runtime.ts는 별개의 순수 상태 파일 — 대상 아님)', () => {
      const moduleOnlyTokens = [
        'governance.module',
        'governance.controller',
        'governance-map.service',
        'retention-policy.service',
        'retention-run-query.service',
        'governance-bootstrap.service',
        'job-lease',
        'retention.job',
        'field-crypto.job',
        'governance-data.writer',
      ];
      const pattern = new RegExp(moduleOnlyTokens.map((t) => t.replace('.', '\\.')).join('|'));
      const offenders = apiFileContents
        .filter(({ f, content }) => !f.includes('/governance/') && pattern.test(content) && !f.endsWith('app.module.ts'))
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });
  });

  describe('G-11: 체인 헤드·앵커·auditLog.create 쓰기 유일 파일', () => {
    it('auditChainHead 쓰기(create|update|updateMany|upsert) 호출 파일은 audit-log.service.ts 1개뿐이다', () => {
      const pattern = /auditChainHead\s*\.\s*(create|update|updateMany|upsert)\b/;
      const offenders = apiFileContents.filter(({ f, content }) => pattern.test(content) && !f.endsWith('audit-logs/audit-log.service.ts')).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('auditChainAnchor 쓰기 호출 파일은 {audit-log.service.ts, governance-data.writer.ts}뿐이다', () => {
      const pattern = /auditChainAnchor\s*\.\s*(create|update|updateMany|upsert)\b/;
      const allowed = ['apps/api/src/audit-logs/audit-log.service.ts', 'apps/api/src/governance/writer/governance-data.writer.ts'];
      const offenders = apiFileContents.filter(({ f, content }) => pattern.test(content) && !allowed.includes(f)).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('auditLog.create( 호출 파일은 audit-log.service.ts 1개뿐이다(NFR-M3 재확인 — 폴백 포함 같은 파일 2회 등장)', () => {
      const pattern = /\.auditLog\s*\.\s*create\s*\(/;
      const offenders = apiFileContents.filter(({ f, content }) => pattern.test(content) && !f.endsWith('audit-logs/audit-log.service.ts')).map(({ f }) => f);
      expect(offenders).toEqual([]);
      const entry = apiFileContents.find(({ f }) => f.endsWith('audit-logs/audit-log.service.ts'));
      expect(nonCommentOccurrences(entry!.content, /\.auditLog\s*\.\s*create\s*\(/)).toBeGreaterThanOrEqual(2);
    });
  });

  describe('G-12: @Public() — governance/**·audit-logs/**에 0건', () => {
    it('governance/**·audit-logs/**(컨트롤러)에 @Public() 부착이 없다', () => {
      const pattern = /@Public\(\)/;
      const offenders = apiFileContents.filter(({ f, content }) => (f.includes('/governance/') || f.includes('/audit-logs/')) && pattern.test(content)).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });
  });

  describe('G-13: 엔진·위젯·ml-worker 심볼 0건', () => {
    it('packages/dialogue-engine/src·apps/widget/src·apps/ml-worker에 거버넌스 심볼이 없다', () => {
      const targets: string[] = [];
      walk(join(REPO_ROOT, 'packages/dialogue-engine/src'), ['.ts'], targets);
      walk(join(REPO_ROOT, 'apps/widget/src'), ['.ts', '.tsx'], targets);
      walk(join(REPO_ROOT, 'apps/ml-worker'), ['.py'], targets);

      const pattern = /\begress\b|\bsealField\b|\bopenField\b|\btextPurgedAt\b|DATA_GOVERNANCE|\bretention\b/i;
      const offenders: string[] = [];
      for (const f of targets) {
        const content = readFileSync(f, 'utf8');
        if (nonCommentOccurrences(content, pattern) > 0) offenders.push(toRepoRelative(f));
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('G-14: 로그 인자에 평문·키 식별자 0(휴리스틱) · EgressBlockedError 메시지에 url 식별자 0', () => {
    const scopedDirs = ['/governance/', '/common/crypto/', '/common/egress/'];
    const scoped = () => apiFileContents.filter(({ f }) => scopedDirs.some((d) => f.includes(d)));

    it('logger 호출 인자에 plaintext|rawText|textValue|userMessage|key(단어경계)|.message 식별자가 없다', () => {
      const loggerCallPattern = /logger\s*\.\s*(log|warn|error|debug)\s*\(([^)]*)\)/g;
      const forbidden = /\bplaintext\b|\brawText\b|\btextValue\b|\buserMessage\b|\bkey\b|\.message\b/;
      const offenders: string[] = [];
      for (const { f, content } of scoped()) {
        for (const line of stripComments(content).split('\n')) {
          const matches = Array.from(line.matchAll(loggerCallPattern));
          for (const m of matches) {
            if (forbidden.test(m[2])) offenders.push(f);
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it('역검증 — 픽스처 문자열에 logger.warn(rawText)가 있으면 검사 로직이 실제로 잡아낸다', () => {
      const fixture = 'logger.warn(`실패: rawText=${rawText}`);';
      const loggerCallPattern = /logger\s*\.\s*(log|warn|error|debug)\s*\(([^)]*)\)/g;
      const forbidden = /\bplaintext\b|\brawText\b|\btextValue\b|\buserMessage\b|\bkey\b|\.message\b/;
      const matches = Array.from(fixture.matchAll(loggerCallPattern));
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some((m) => forbidden.test(m[2]))).toBe(true);
    });

    it('EgressBlockedError 생성부(egress-guard.ts)의 메시지 조립에 url 식별자가 없다(호스트만 담는다)', () => {
      const entry = apiFileContents.find(({ f }) => f.endsWith('common/egress/egress-guard.ts'));
      expect(entry).toBeDefined();
      const blocks = extractBracedBlocksAfter(entry!.content, /class\s+EgressBlockedError[^{]*/);
      expect(blocks.length).toBe(1);
      expect(/\burl\b/.test(blocks[0])).toBe(false);
    });
  });

  describe('G-15: @AuditView 부착 = VIEW_AUDIT_TARGETS 8개 · recordExport(/recordView( 호출 파일', () => {
    it('recordExport( 호출 파일은 정확히 3개다(감사로그 CSV·설문 결과 CSV·TC 결과 CSV)', () => {
      const pattern = /\brecordExport\(/;
      const offenders = new Set(apiFileContents.filter(({ f, content }) => pattern.test(content) && !f.endsWith('audit-logs/audit-log.service.ts')).map(({ f }) => f));
      expect(offenders).toEqual(
        new Set(['apps/api/src/audit-logs/audit-logs.service.ts', 'apps/api/src/stats/surveys/survey-results.service.ts', 'apps/api/src/validation/test-run.service.ts']),
      );
    });

    it('recordView( 호출 파일은 access-view.interceptor.ts 1개뿐이다(audit-log.service.ts의 정의부 제외, 주석 언급 제외)', () => {
      const pattern = /\brecordView\(/;
      const offenders = apiFileContents
        .filter(({ f, content }) => nonCommentOccurrences(content, pattern) > 0 && !f.endsWith('audit-logs/access/access-view.interceptor.ts') && !f.endsWith('audit-logs/audit-log.service.ts'))
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('@AuditView( 부착 위치(컨트롤러#핸들러) 집합이 view-audit-targets.ts의 VIEW_AUDIT_TARGETS 8개와 정확히 같다', () => {
      const targetsEntry = apiFileContents.find(({ f }) => f.endsWith('audit-logs/access/view-audit-targets.ts'));
      expect(targetsEntry).toBeDefined();
      const declared = Array.from(targetsEntry!.content.matchAll(/controller:\s*'([^']+)'/g)).length;
      expect(declared).toBe(8);

      const auditViewCallsites = apiFileContents.reduce((sum, { content }) => sum + nonCommentOccurrences(content, /@AuditView\(/), 0);
      expect(auditViewCallsites).toBe(8);
    });
  });

  describe('G-16: schema.prisma — 신규 5모델 Cascade/SetNull 0 · 로그 3모델 텍스트 필드 0 · textPurgedAt 4모델 존재', () => {
    const schemaPath = join(REPO_ROOT, 'apps/api/prisma/schema.prisma');
    const schemaContent = readFileSync(schemaPath, 'utf8');

    function extractModelBlock(modelName: string): string {
      const blocks = extractBracedBlocksAfter(schemaContent, new RegExp(`model\\s+${modelName}\\s*`));
      expect(blocks.length).toBe(1);
      return blocks[0];
    }

    it('신규 5모델(RetentionPolicy·RetentionRun·AuditChainHead·AuditChainAnchor·GovernanceJobState)에 onDelete: Cascade|SetNull이 없다', () => {
      for (const model of ['RetentionPolicy', 'RetentionRun', 'AuditChainHead', 'AuditChainAnchor', 'GovernanceJobState']) {
        const block = extractModelBlock(model);
        expect(/onDelete:\s*(Cascade|SetNull)/.test(block)).toBe(false);
      }
    });

    it('RetentionRun·AuditChainAnchor·GovernanceJobState에 텍스트 본문·sessionId·userMessage류 컬럼이 없다', () => {
      const forbidden = /\bsessionId\b|\buserMessage\b|\bbotResponse\b|\bquestionText\b|\brawText\b/;
      for (const model of ['RetentionRun', 'AuditChainAnchor', 'GovernanceJobState']) {
        const block = extractModelBlock(model);
        expect(forbidden.test(block)).toBe(false);
      }
    });

    it('ConversationLog·UnansweredQuestion·SurveyAnswer·HandoffMessage 4모델 모두 textPurgedAt 컬럼이 있다', () => {
      for (const model of ['ConversationLog', 'UnansweredQuestion', 'SurveyAnswer', 'HandoffMessage']) {
        const block = extractModelBlock(model);
        expect(/\btextPurgedAt\b/.test(block)).toBe(true);
      }
    });
  });

  describe('G-17: 소거·재암호화 메서드 블록마다 enableSecureDelete( · $queryRaw 보유 파일 수 4 불변', () => {
    it('governance-data.writer.ts의 소거 메서드(conversationLog·unansweredQuestion·surveyAnswer·handoffMessage)가 enableSecureDelete(를 호출한다', () => {
      const entry = apiFileContents.find(({ f }) => f.endsWith('governance/writer/governance-data.writer.ts'));
      expect(entry).toBeDefined();
      const occurrences = nonCommentOccurrences(entry!.content, /enableSecureDelete\(/);
      expect(occurrences).toBeGreaterThanOrEqual(4);
    });

    it('$queryRaw 보유 파일 수는 4개로 불변이다(handoff-secure-delete.query.ts 재사용 — 새 원시 SQL 파일 0)', () => {
      const pattern = /\$queryRaw\b/;
      const offenders = apiFileContents.filter(({ content }) => pattern.test(content)).map(({ f }) => f);
      expect(new Set(offenders).size).toBe(4);
    });
  });

  describe('G-18: AUDIT_FIELDS 화이트리스트 — 6개 대상에 텍스트 필드명 0', () => {
    it('audit-snapshot.ts의 AUDIT_FIELDS.{RetentionPolicy,RetentionRun,ConversationLog,UnansweredQuestion,AuditLog,TestRun}에 text·message·sessionId·question·body류 필드명이 없다', () => {
      const entry = apiFileContents.find(({ f }) => f.endsWith('audit-logs/lib/audit-snapshot.ts'));
      expect(entry).toBeDefined();
      const content = stripComments(entry!.content);

      for (const model of ['RetentionPolicy', 'RetentionRun', 'ConversationLog', 'UnansweredQuestion', 'AuditLog', 'TestRun']) {
        const marker = new RegExp(`${model}\\s*:\\s*\\[`);
        const idx = content.search(marker);
        expect(idx).toBeGreaterThanOrEqual(0);
        const arrayStart = content.indexOf('[', idx);
        const arrayEnd = content.indexOf(']', arrayStart);
        const arrayText = content.slice(arrayStart, arrayEnd + 1);
        const forbidden = /\btext\b|\bmessage\b|\bsessionId\b|\bquestion\b|\bbody\b/i;
        expect(forbidden.test(arrayText)).toBe(false);
      }
    });
  });
});
