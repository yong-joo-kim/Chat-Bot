import { ConfigService } from '@nestjs/config';
import { checkEgressBootUrls } from './egress-boot-check';
import { GovernanceBootstrapService } from '../governance-bootstrap.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../audit-logs/audit-log.service';
import { resetGovernanceRuntimeForTest } from '../../../common/governance/governance-runtime';

/**
 * 음성 AI(No.32) — 출구 기동 검사 1조건(voice-ai-설계.md §11.2 · AC-VO4-4). 서버 음성 켜짐 ∧ `local` ∧ 주소 설정일 때만 검사한다.
 */
describe('checkEgressBootUrls — 음성 인식(SPEECH_LOCAL)', () => {
  const allow = (allowed: string[]) => (url: string): boolean => allowed.includes(new URL(url).hostname);
  const base = { augmentationProvider: 'rule' };

  it('켜짐 ∧ local ∧ 허용 목록 밖 → 기동 실패(사유에 음성 인식)', () => {
    const result = checkEgressBootUrls({ ...base, speechEnabled: true, speechProvider: 'local', speechLocalBaseUrl: 'http://stt.internal:8102' }, allow(['other.internal']));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/음성 인식/);
  });

  it('켜짐 ∧ local ∧ 허용 목록 안 → 통과', () => {
    expect(checkEgressBootUrls({ ...base, speechEnabled: true, speechProvider: 'local', speechLocalBaseUrl: 'http://stt.internal:8102' }, allow(['stt.internal'])).ok).toBe(true);
  });

  it.each([
    ['꺼짐', { speechEnabled: false, speechProvider: 'local', speechLocalBaseUrl: 'http://stt.internal:8102' }],
    ['mock 공급자', { speechEnabled: true, speechProvider: 'mock', speechLocalBaseUrl: 'http://stt.internal:8102' }],
    ['주소 없음', { speechEnabled: true, speechProvider: 'local', speechLocalBaseUrl: undefined }],
    ['미설정(기본 설치)', {}],
  ])('%s → 검사 0(허용 목록이 비어 있어도 통과 — 기본 설치 동작 불변)', (_label, input) => {
    expect(checkEgressBootUrls({ ...base, ...input }, allow([])).ok).toBe(true);
  });
});

describe('GovernanceBootstrapService — 음성 인식 출구 기동 검사(모드 ON)', () => {
  afterEach(() => resetGovernanceRuntimeForTest());

  const makeService = (overrides: Record<string, unknown>) =>
    new GovernanceBootstrapService({ get: (key: string) => overrides[key] } as unknown as ConfigService, {} as unknown as PrismaService, {} as unknown as AuditLogService);
  const check = (service: GovernanceBootstrapService, allowlist: string[]) => (service as unknown as { checkEgressBootOrThrow: (a: string[]) => void }).checkEgressBootOrThrow(allowlist);

  it('허용 목록 밖의 ML_WORKER_SPEECH_URL → 기동 실패(조용한 무시 없음)', () => {
    const service = makeService({ SPEECH_ENABLED: true, SPEECH_PROVIDER: 'local', ML_WORKER_SPEECH_URL: 'http://stt.internal:8102' });
    expect(() => check(service, ['ml-worker.internal'])).toThrow(/외부 전송 허용 목록.*음성 인식/);
  });

  it('허용 목록 안(포트 포함 항목)이면 통과 · 음성이 꺼져 있으면 호스트가 밖이어도 통과', () => {
    expect(() => check(makeService({ SPEECH_ENABLED: true, SPEECH_PROVIDER: 'local', ML_WORKER_SPEECH_URL: 'http://stt.internal:8102' }), ['stt.internal:8102'])).not.toThrow();
    expect(() => check(makeService({ SPEECH_ENABLED: false, SPEECH_PROVIDER: 'local', ML_WORKER_SPEECH_URL: 'http://stt.internal:8102' }), ['ml-worker.internal'])).not.toThrow();
  });
});
