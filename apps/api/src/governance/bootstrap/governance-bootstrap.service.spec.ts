import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { GovernanceBootstrapService } from './governance-bootstrap.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { checkEgress } from '../../common/egress/egress-guard';
import { installGovernanceRuntime, resetGovernanceRuntimeForTest } from '../../common/governance/governance-runtime';
import { AUGMENT_GEMINI_DEFAULT_BASE_URL } from '../../common/egress/egress-registry';

/**
 * M-2(코드 리뷰 R1) 단위 시험 — `checkEgressBootOrThrow`(기동 판정)가 `egress-guard.ts`의
 * `parseAllowlist`·`matchHost`(런타임 판정이 쓰는 바로 그 순수 함수)를 재사용하는지 검증한다.
 * 특히 **포트가 포함된 allowlist 항목**에 대해 기동 판정과 런타임 판정(`checkEgress()`)이
 * 일치해야 한다(수정 전에는 기동 판정이 포트를 무시했다 — 항목의 포트를 항상 잘라내고 호스트만
 * 비교했다).
 */
function makeConfig(overrides: Record<string, unknown>): ConfigService {
  return { get: (key: string) => (key in overrides ? overrides[key] : undefined) } as unknown as ConfigService;
}

function makeService(overrides: Record<string, unknown>): GovernanceBootstrapService {
  return new GovernanceBootstrapService(makeConfig(overrides), {} as unknown as PrismaService, {} as unknown as AuditLogService);
}

/** private 메서드를 직접 호출한다 — 키 사용 검사·런타임 설치 등 무관한 단계를 거치지 않기 위해서다. */
function callCheckEgressBootOrThrow(service: GovernanceBootstrapService, allowlist: string[]): void {
  (service as unknown as { checkEgressBootOrThrow: (a: string[]) => void }).checkEgressBootOrThrow(allowlist);
}

describe('GovernanceBootstrapService — checkEgressBootOrThrow (M-2)', () => {
  afterEach(() => {
    resetGovernanceRuntimeForTest();
  });

  it('허용 목록 항목의 포트와 EMBEDDING_BASE_URL의 포트가 같으면 기동 검사를 통과한다', () => {
    const service = makeService({ EMBEDDING_BASE_URL: 'http://ml-worker.internal:9999' });
    expect(() => callCheckEgressBootOrThrow(service, ['ml-worker.internal:9999'])).not.toThrow();
  });

  it('허용 목록 항목에 포트가 있고 EMBEDDING_BASE_URL의 포트가 다르면 기동 검사가 실패한다(수정 전에는 포트를 무시해 통과했다)', () => {
    const service = makeService({ EMBEDDING_BASE_URL: 'http://ml-worker.internal:8888' });
    expect(() => callCheckEgressBootOrThrow(service, ['ml-worker.internal:9999'])).toThrow(
      /외부 전송 허용 목록/,
    );
  });

  it('★ 기동 판정과 런타임 판정(checkEgress)이 포트 포함 항목에서 일치한다', () => {
    const allowlist = ['ml-worker.internal:9999'];
    const matchingUrl = 'http://ml-worker.internal:9999';
    const mismatchingPortUrl = 'http://ml-worker.internal:8888';

    // 기동 판정
    const matchingService = makeService({ EMBEDDING_BASE_URL: matchingUrl });
    expect(() => callCheckEgressBootOrThrow(matchingService, allowlist)).not.toThrow();
    const mismatchingService = makeService({ EMBEDDING_BASE_URL: mismatchingPortUrl });
    expect(() => callCheckEgressBootOrThrow(mismatchingService, allowlist)).toThrow();

    // 런타임 판정 — 같은 allowlist를 설치하고 같은 URL 쌍을 판정한다.
    installGovernanceRuntime({ mode: 'ON', egress: { allowlist, enforce: true }, encryptionEnabled: false });
    expect(checkEgress('EMBEDDING', matchingUrl)).toBe('ALLOWED');
    expect(checkEgress('EMBEDDING', mismatchingPortUrl)).toBe('BLOCKED');
  });

  it('와일드카드 항목(*.suffix:port)도 기동·런타임 판정이 일치한다', () => {
    const allowlist = ['*.internal:9999'];
    const matchingUrl = 'http://ml-worker.internal:9999';
    const mismatchingPortUrl = 'http://ml-worker.internal:8888';

    const matchingService = makeService({ EMBEDDING_BASE_URL: matchingUrl });
    expect(() => callCheckEgressBootOrThrow(matchingService, allowlist)).not.toThrow();
    const mismatchingService = makeService({ EMBEDDING_BASE_URL: mismatchingPortUrl });
    expect(() => callCheckEgressBootOrThrow(mismatchingService, allowlist)).toThrow();

    installGovernanceRuntime({ mode: 'ON', egress: { allowlist, enforce: true }, encryptionEnabled: false });
    expect(checkEgress('EMBEDDING', matchingUrl)).toBe('ALLOWED');
    expect(checkEgress('EMBEDDING', mismatchingPortUrl)).toBe('BLOCKED');
  });

  it('허용 목록 항목 형식이 잘못되면 기동 실패(예외)로 이어진다(조용한 무시 금지)', () => {
    const service = makeService({ EMBEDDING_BASE_URL: 'http://ml-worker.internal:9999' });
    expect(() => callCheckEgressBootOrThrow(service, ['https://잘못된-형식.example.com'])).toThrow(
      /데이터 거버넌스/,
    );
  });

  it('설정된 출구 URL이 없으면(egress 미사용) 빈 허용 목록도 통과한다', () => {
    const service = makeService({});
    expect(() => callCheckEgressBootOrThrow(service, [])).not.toThrow();
  });
});

/**
 * ★ test-automation 보강(2026-09-26) — AC-DG2-1(저장 위치 기동 검증)·AC-DG2-2(Gemini 출구 기동 검증)를
 * `GovernanceBootstrapService`의 실제 private 메서드(`checkResidencyOrThrow`·`checkEgressBootOrThrow`)
 * 종단으로 확인한다. 전체 `AppModule`을 동적 import로 띄우는 방식은 시도했으나, `ConfigModule.
 * forRoot({validate})`의 DynamicModule이 **`app.module.ts`를 그 Jest 파일에서 처음 import하는 시점에
 * 고정**되어(CLAUDE.md 규약) 같은 파일 안에서 실패→성공을 환경변수만 바꿔 재현할 수 없었다(두 번째
 * `import('../app.module')`가 캐시된 모듈을 반환해 첫 스냅샷의 환경변수를 그대로 쓴다). `checkEgress
 * BootOrThrow` M-2 시험과 같은 "private 메서드 직접 호출 + 가짜 ConfigService" 패턴이 이 계층에서는
 * 더 안정적이고 빠르다 — 실제 파일시스템(임시 디렉터리)으로 AC-DG2-1의 "허용 디렉터리 밖/안" 양쪽을,
 * 가짜 ConfigService로 AC-DG2-2의 "Gemini 허용 목록 없음/있음" 양쪽을 같은 서비스 인스턴스에서
 * 순서대로 확인한다(둘 다 프로세스 전역 상태에 의존하지 않는 메서드라 안전하다).
 */
describe('GovernanceBootstrapService — checkResidencyOrThrow (AC-DG2-1)', () => {
  function callCheckResidencyOrThrow(service: GovernanceBootstrapService): void {
    (service as unknown as { checkResidencyOrThrow: () => void }).checkResidencyOrThrow();
  }

  let root: string;
  let allowedDir: string;
  let outsideDir: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'gov-bootstrap-residency-'));
    allowedDir = join(root, 'allowed');
    outsideDir = join(root, 'outside');
    mkdirSync(allowedDir);
    mkdirSync(outsideDir);
    writeFileSync(join(allowedDir, 'x.db'), 'x');
    writeFileSync(join(outsideDir, 'x.db'), 'x');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('허용 디렉터리가 설정되지 않으면(레지던시 미사용) 검사를 건너뛴다', () => {
    const service = makeService({ DATABASE_URL: `file:${join(outsideDir, 'x.db')}` });
    expect(() => callCheckResidencyOrThrow(service)).not.toThrow();
  });

  it('AC-DG2-1: DB 파일이 허용 디렉터리 밖이면 기동 실패다(비밀·자격증명 없이 사유만 담는다)', () => {
    const service = makeService({ DATABASE_URL: `file:${join(outsideDir, 'x.db')}`, DATA_RESIDENCY_ALLOWED_DIRS: allowedDir });
    expect(() => callCheckResidencyOrThrow(service)).toThrow(/저장 위치 검증 실패/);
  });

  it('AC-DG2-1: 같은 서비스에서 허용 디렉터리를 DB가 실제로 있는 곳으로 바꾸면 통과한다', () => {
    const service = makeService({ DATABASE_URL: `file:${join(allowedDir, 'x.db')}`, DATA_RESIDENCY_ALLOWED_DIRS: allowedDir });
    expect(() => callCheckResidencyOrThrow(service)).not.toThrow();
  });
});

describe('GovernanceBootstrapService — checkEgressBootOrThrow × Gemini 증강(AC-DG2-2)', () => {
  it('AC-DG2-2: AUGMENTATION_PROVIDER=gemini + API 키 있음 + 허용 목록에 Gemini 호스트 없음 → 기동 실패', () => {
    const service = makeService({ AUGMENTATION_PROVIDER: 'gemini', AUGMENTATION_GEMINI_API_KEY: 'test-key' });
    expect(() => callCheckEgressBootOrThrow(service, [])).toThrow(/Gemini/);
  });

  it('AC-DG2-2: 허용 목록에 Gemini 기본 호스트를 추가하면 같은 설정으로 통과한다', () => {
    const service = makeService({ AUGMENTATION_PROVIDER: 'gemini', AUGMENTATION_GEMINI_API_KEY: 'test-key' });
    const geminiHost = new URL(AUGMENT_GEMINI_DEFAULT_BASE_URL).hostname;
    expect(() => callCheckEgressBootOrThrow(service, [geminiHost])).not.toThrow();
  });

  it('AC-DG2-2: Gemini API 키가 없으면(증강 실질 미사용) 허용 목록이 비어 있어도 통과한다', () => {
    const service = makeService({ AUGMENTATION_PROVIDER: 'gemini' });
    expect(() => callCheckEgressBootOrThrow(service, [])).not.toThrow();
  });
});
