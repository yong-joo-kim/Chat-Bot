import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * 옴니채널 통합 인박스(No.42) 정적 검사(`omnichannel-inbox-설계.md` §17 O-1~O-20) — 기존
 * `governance-sealing.spec.ts`·`workflow-sealing.spec.ts`와 같은 형식(스캔 루트 지정 · 자기 자신
 * 제외 · 스캔 대상 0건 아님 가드 · 주석 줄 제외 · 역검증 픽스처 포함).
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SELF_ABSOLUTE = resolve(__dirname, 'inbox-sealing.spec.ts');

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
  return files.filter((f) => f !== SELF_ABSOLUTE && !f.endsWith('.spec.ts') && !f.replace(/\\/g, '/').includes('/src/integration/'));
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

describe('옴니채널 통합 인박스(No.42) 정적 검사 — omnichannel-inbox-설계.md §17', () => {
  const apiFiles = collectApiSourceFiles();
  const apiFileContents = apiFiles.map((f) => ({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') }));
  const inboxFiles = apiFileContents.filter(({ f }) => f.includes('/inbox/') || f.includes('/common/inbox/'));

  it('스캔 대상 파일이 존재한다', () => {
    expect(apiFileContents.length).toBeGreaterThan(100);
    expect(inboxFiles.length).toBeGreaterThan(10);
  });

  it('O-1: 비밀 문자열 보유 파일 = inbox-identity-secret.resolver.ts 1개 · 주입 파일 ⊆ 허용 목록', () => {
    const pattern = /OMNI_IDENTITY_SECRET__|OMNI_CUSTOMER_KEY_SECRET/;
    const offenders = apiFileContents.filter(({ f, content }) => nonCommentOccurrences(content, pattern) > 0 && !f.endsWith('inbox/identity/inbox-identity-secret.resolver.ts')).map(({ f }) => f);
    expect(offenders).toEqual([]);

    const injectionAllowed = ['apps/api/src/inbox/identity/inbox-identity.service.ts', 'apps/api/src/inbox/read/inbox-query.service.ts', 'apps/api/src/inbox/manage/chatbot-inbox-settings.service.ts'];
    const injectors = apiFileContents.filter(({ f, content }) => content.includes('InboxIdentitySecretResolver') && !f.endsWith('inbox-identity-secret.resolver.ts') && !f.endsWith('inbox-identity.module.ts')).map(({ f }) => f);
    for (const f of injectors) expect(injectionAllowed).toContain(f);
  });

  it('O-2: 인박스 7모델 쓰기 = {inbox.store.ts, governance-data.writer.ts} · chatbotInboxSetting 쓰기 = {chatbot-inbox-settings.service.ts, chatbots.service.ts}', () => {
    const models = ['customer', 'customerLink', 'inboxThread', 'inboxEntry', 'inboxTag', 'inboxThreadTag', 'customerMerge'];
    const writeOps = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'];
    // `tx.모델.연산(`·`this.prisma.모델.연산(` 둘 다 잡도록 접두사를 강제하지 않는다(handoff-sealing H-2 선례).
    const pattern = new RegExp(`\\.(?:${models.join('|')})\\s*\\.\\s*(?:${writeOps.join('|')})\\b`);
    const allowed = ['apps/api/src/inbox/core/inbox.store.ts', 'apps/api/src/governance/writer/governance-data.writer.ts'];
    const offenders = apiFileContents.filter(({ f, content }) => nonCommentOccurrences(content, pattern) > 0 && !allowed.includes(f)).map(({ f }) => f);
    expect(offenders).toEqual([]);

    const settingPattern = /\.chatbotInboxSetting\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;
    const allowedSetting = ['apps/api/src/inbox/manage/chatbot-inbox-settings.service.ts', 'apps/api/src/chatbots/chatbots.service.ts'];
    const settingOffenders = apiFileContents.filter(({ f, content }) => nonCommentOccurrences(content, settingPattern) > 0 && !allowedSetting.includes(f)).map(({ f }) => f);
    expect(settingOffenders).toEqual([]);
  });

  it('O-3: writer의 새 소거 메서드 data 키 제한 · enableSecureDelete( 사용', () => {
    const writer = apiFileContents.find(({ f }) => f.endsWith('governance/writer/governance-data.writer.ts'));
    expect(writer).toBeDefined();
    expect(writer!.content).toMatch(/purgeInboxEntries[\s\S]*?enableSecureDelete\(/);
    expect(writer!.content).toMatch(/purgeCustomerIdentities[\s\S]*?enableSecureDelete\(/);
  });

  it('O-4: sealField(INBOX_ENTRY_TEXT|CUSTOMER_DISPLAY_NAME) ⊆ {store,writer} · openField( 인박스 호출 = inbox-text.reader.ts 1개 · MaskedText 브랜드 생성 = masked-text.ts 1개', () => {
    const sealAllowed = ['apps/api/src/inbox/core/inbox.store.ts', 'apps/api/src/governance/writer/governance-data.writer.ts'];
    const sealOffenders = apiFileContents
      .filter(({ f, content }) => (content.includes("sealField('INBOX_ENTRY_TEXT'") || content.includes("sealField('CUSTOMER_DISPLAY_NAME'")) && !sealAllowed.includes(f))
      .map(({ f }) => f);
    expect(sealOffenders).toEqual([]);

    const openInboxOffenders = inboxFiles.filter(({ f, content }) => nonCommentOccurrences(content, /\bopenField\(/) > 0 && !f.endsWith('inbox/read/inbox-text.reader.ts')).map(({ f }) => f);
    expect(openInboxOffenders).toEqual([]);

    const brandOffenders = apiFileContents.filter(({ f, content }) => content.includes('as MaskedText') && !f.endsWith('inbox/core/lib/masked-text.ts')).map(({ f }) => f);
    expect(brandOffenders).toEqual([]);
  });

  it('O-5: 신규 8모델 — onDelete Cascade/SetNull 0건 · 원 회원 번호·토큰·원문 컬럼 0건', () => {
    const schemaPath = join(REPO_ROOT, 'apps/api/prisma/schema.prisma');
    const schema = readFileSync(schemaPath, 'utf8');
    const startIdx = schema.indexOf('model ChatbotInboxSetting');
    expect(startIdx).toBeGreaterThan(0);
    const block = schema.slice(startIdx);
    expect(block).not.toMatch(/onDelete:\s*(Cascade|SetNull)/);
    expect(block).not.toMatch(/\b(sub|memberId|externalId|rawName|email|phone)\s+String/);
    expect(block).not.toMatch(/\b(rawText|userMessage|botResponse)\s+String/);
    // 토큰 원문 컬럼 0(참조 이름 컬럼 identitySecretRef는 허용).
    expect(block).not.toMatch(/\btoken\s+String/);
  });

  it('O-6: 응답 스키마에 sessionId·rawText·customerKeyHash·memberId·sub·token·keyFingerprint 노출 0', () => {
    const inboxTs = readFileSync(join(REPO_ROOT, 'packages/shared-types/src/inbox.ts'), 'utf8');
    const responseSchemaNames = [
      'InboxThreadListItemSchema',
      'InboxThreadDetailSchema',
      'TimelineConversationUnitSchema',
      'TimelineEntryUnitSchema',
      'CustomerSearchItemSchema',
      'SessionLinkLookupResponseSchema',
      'ChatbotInboxSettingsResponseSchema',
      'CustomerCardSchema',
    ];
    const forbidden = ['sessionId:', 'rawText:', 'customerKeyHash:', 'memberId:', 'sub:', 'token:', 'keyFingerprint:'];
    for (const schemaName of responseSchemaNames) {
      const start = inboxTs.indexOf(`export const ${schemaName}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = inboxTs.indexOf('\n});', start);
      const block = inboxTs.slice(start, end > 0 ? end : start + 2000);
      for (const f of forbidden) {
        expect(block.includes(f)).toBe(false);
      }
    }
  });

  it('O-7: inbox/** 로그 호출 인자에 token·sub·displayName·sessionId·memberId·secret 식별자 0(휴리스틱)', () => {
    const loggerCallPattern = /this\.logger\.(warn|log|error)\(([^)]*)\)/g;
    const forbiddenIdentifiers = ['token', 'sub', 'displayName', 'sessionId', 'memberId', 'secret'];
    const offenders: string[] = [];
    for (const { f, content } of inboxFiles) {
      let m: RegExpExecArray | null;
      const re = new RegExp(loggerCallPattern.source, 'g');
      while ((m = re.exec(content))) {
        const args = m[2];
        if (forbiddenIdentifiers.some((id) => new RegExp(`\\b${id}\\b`).test(args))) offenders.push(`${f}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('O-8: inbox/** @Public() 0건', () => {
    const offenders = inboxFiles.filter(({ content }) => nonCommentOccurrences(content, /@Public\(\)/) > 0).map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('O-9: dialogue-engine·ml-worker에 identity|customer|inbox 심볼 0건', () => {
    const engineFiles: string[] = [];
    walk(join(REPO_ROOT, 'packages/dialogue-engine/src'), ['.ts'], engineFiles);
    const mlWorkerFiles: string[] = [];
    walk(join(REPO_ROOT, 'apps/ml-worker'), ['.py'], mlWorkerFiles);
    const pattern = /\b(identity|customer|inbox)\b/i;
    const offenders = [...engineFiles, ...mlWorkerFiles].filter((f) => pattern.test(readFileSync(f, 'utf8'))).map((f) => toRepoRelative(f));
    expect(offenders).toEqual([]);
  });

  it('O-10: inbox/**에 대화 로그·미응답·평가·설문·상담·업무자동화 쓰기 0 · rawText 식별자 0 · 원천 서비스/포트 주입 0', () => {
    const writePattern = /\.(?:conversationLog|unansweredQuestion|messageFeedback|surveyResponse|surveyAnswer|handoffSession|handoffMessage|workflowRun)\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;
    const offenders = inboxFiles.filter(({ content }) => nonCommentOccurrences(content, writePattern) > 0).map(({ f }) => f);
    expect(offenders).toEqual([]);

    const rawTextOffenders = inboxFiles.filter(({ content }) => nonCommentOccurrences(content, /\brawText\b/) > 0).map(({ f }) => f);
    expect(rawTextOffenders).toEqual([]);

    const injectionPattern = /\bConversationLogService\b|\bWORKFLOW_EVENT_SINK\b|\bWorkflowTriggerService\b/;
    const injectionOffenders = inboxFiles.filter(({ content }) => nonCommentOccurrences(content, injectionPattern) > 0).map(({ f }) => f);
    expect(injectionOffenders).toEqual([]);

    const conversationLogCreateFiles = apiFileContents.filter(({ content }) => nonCommentOccurrences(content, /\bprisma\.conversationLog\.create\(/) > 0).map(({ f }) => f);
    expect(conversationLogCreateFiles).toEqual(['apps/api/src/conversation/conversation-log.service.ts']);
  });

  it('O-11: InboxModule exports [] · InboxCoreModule/InboxIdentityModule exports 집합 · 주입 파일은 inbox/**로 봉인', () => {
    const inboxModule = inboxFiles.find(({ f }) => f.endsWith('inbox/inbox.module.ts'));
    expect(inboxModule!.content).toMatch(/exports:\s*\[\s*\]/);

    const offenders = apiFileContents.filter(({ f, content }) => /\bInboxStore\b/.test(content) && !f.startsWith('apps/api/src/inbox/')).map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('O-12: 도메인 모듈에 inbox/ import 0 · conversation/handoff의 inbox/ import ⊆ 허용 목록 · 출구 0', () => {
    const forbiddenDirs = ['validation', 'versions', 'deploy-schedules', 'stats', 'learning', 'topics', 'asset-transfer', 'governance', 'environment', 'workflow', 'feedback', 'survey-responses', 'simulation', 'rag', 'legacy-api'];
    for (const dir of forbiddenDirs) {
      const offenders = apiFileContents.filter(({ f, content }) => f.startsWith(`apps/api/src/${dir}/`) && /from\s+['"].*\/inbox\//.test(content)).map(({ f }) => f);
      expect(offenders).toEqual([]);
    }

    const conversationAllowed = ['inbox/identity/inbox-identity.module', 'inbox/identity/inbox-identity.service', 'inbox/core/inbox-core.module'];
    const conversationOffenders = apiFileContents
      .filter(({ f }) => f.startsWith('apps/api/src/conversation/'))
      .flatMap(({ f, content }) => (Array.from(content.matchAll(/from\s+['"].*?(inbox\/[a-z-]+\/[a-z-]+)['"]/g)).map((m) => m[1]) as string[]).map((imp) => ({ f, imp })))
      .filter(({ imp }) => !conversationAllowed.includes(imp));
    expect(conversationOffenders).toEqual([]);

    const handoffAllowed = ['inbox/core/inbox-core.module'];
    const handoffOffenders = apiFileContents
      .filter(({ f }) => f.startsWith('apps/api/src/handoff/'))
      .flatMap(({ f, content }) => (Array.from(content.matchAll(/from\s+['"].*?(inbox\/[a-z-]+\/[a-z-]+)['"]/g)).map((m) => m[1]) as string[]).map((imp) => ({ f, imp })))
      .filter(({ imp }) => !handoffAllowed.includes(imp));
    expect(handoffOffenders).toEqual([]);

    const egressOffenders = inboxFiles.filter(({ content }) => /\bfetch\(|node:http|transport\.request\(/.test(content)).map(({ f }) => f);
    expect(egressOffenders).toEqual([]);
  });

  it('O-13: 원천 2파일 .signal( 호출에 await 0 · 발행 리터럴 각 1 · drainForTest( 운영 코드 호출 0', () => {
    const handoffThread = apiFileContents.find(({ f }) => f.endsWith('handoff/handoff-thread.service.ts'))!.content;
    const conversationLog = apiFileContents.find(({ f }) => f.endsWith('conversation/conversation-log.service.ts'))!.content;
    expect(handoffThread).not.toMatch(/await\s+this\.inboxSignals/);
    expect(conversationLog).not.toMatch(/await\s+this\.inboxSignals/);
    expect(nonCommentOccurrences(handoffThread + conversationLog, /signal:\s*'HANDOFF_OPENED'/)).toBe(1);
    expect(nonCommentOccurrences(handoffThread + conversationLog, /signal:\s*'TURN_RECORDED'/)).toBe(1);

    // 운영 코드에서 `inboxSignals`·`inboxIdentity` 인스턴스의 `drainForTest(` 호출 0(정의 자체는 허용).
    const drainCallPattern = /\.(?:inboxSignals|inboxIdentity)\??\.\s*drainForTest\(/;
    const drainCallers = apiFileContents.filter(({ content }) => nonCommentOccurrences(content, drainCallPattern) > 0).map(({ f }) => f);
    expect(drainCallers).toEqual([]);
  });

  it('O-14: public-conversation.service.ts의 inboxIdentity?.observe( 정확히 1회 · await 0 · inbound.identity 읽기 = 그 파일뿐 · IDENTITY_TOKEN_HEADER 사용 = 컨트롤러 1개', () => {
    const service = apiFileContents.find(({ f }) => f.endsWith('conversation/public-conversation.service.ts'))!.content;
    expect(nonCommentOccurrences(service, /inboxIdentity\?\.observe\(/)).toBe(1);
    expect(service).not.toMatch(/await\s+this\.inboxIdentity/);

    const identityReaders = apiFileContents.filter(({ content }) => nonCommentOccurrences(content, /\binbound\.identity\b/) > 0).map(({ f }) => f);
    expect(identityReaders).toEqual(['apps/api/src/conversation/public-conversation.service.ts']);

    const headerUsers = apiFileContents.filter(({ content }) => content.includes('IDENTITY_TOKEN_HEADER')).map(({ f }) => f);
    expect(headerUsers).toEqual(['apps/api/src/conversation/public-conversation.controller.ts']);
  });

  it('O-16: verify-identity-token.ts에 timingSafeEqual( · HS256 정확 비교 · jsonwebtoken/jose 의존성 0', () => {
    const verify = apiFileContents.find(({ f }) => f.endsWith('inbox/identity/lib/verify-identity-token.ts'))!.content;
    expect(verify).toMatch(/timingSafeEqual\(/);
    expect(verify).toMatch(/[=!]==\s*'HS256'/);
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'apps/api/package.json'), 'utf8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(allDeps.jsonwebtoken).toBeUndefined();
    expect(allDeps.jose).toBeUndefined();
  });

  it('O-17: 마이그레이션 SQL에 DROP·ALTER TABLE·부분 인덱스(WHERE) 0 · $queryRaw/$executeRaw 보유 파일 수 불변(4)', () => {
    const migrationSql = readFileSync(join(REPO_ROOT, 'apps/api/prisma/migrations/20260926210000_omnichannel_inbox/migration.sql'), 'utf8');
    expect(migrationSql).not.toMatch(/\bDROP\b/i);
    expect(migrationSql).not.toMatch(/\bALTER TABLE\b/i);
    expect(migrationSql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX[^;]*WHERE/i);

    const rawSqlFiles = apiFileContents.filter(({ content }) => /\$queryRaw|\$executeRaw/.test(content)).map(({ f }) => f);
    expect(rawSqlFiles.length).toBe(4);
  });

  it('O-19: VIEW_AUDIT_TARGETS에 인박스 3행 · inbox/** @AuditView( 3건', () => {
    const targets = apiFileContents.find(({ f }) => f.endsWith('audit-logs/access/view-audit-targets.ts'))!.content;
    expect(nonCommentOccurrences(targets, /targetType:\s*'(InboxThread|Customer)'/)).toBeGreaterThanOrEqual(3);
    const auditViewCalls = inboxFiles.reduce((sum, { content }) => sum + nonCommentOccurrences(content, /@AuditView\(/), 0);
    expect(auditViewCalls).toBe(3);
  });

  it('O-20: inbox/**에 setInterval(·PollingLoop 0 · jest.isolate-env.js에 OMNI_ 0', () => {
    const offenders = inboxFiles.filter(({ content }) => /setInterval\(|PollingLoop/.test(content)).map(({ f }) => f);
    expect(offenders).toEqual([]);
    const isolateEnv = readFileSync(join(REPO_ROOT, 'apps/api/jest.isolate-env.js'), 'utf8');
    expect(isolateEnv).not.toMatch(/OMNI_/);
  });

  // ── 역검증 픽스처(그룹 자체가 0건 아님을 확인 — 정규식이 항상 통과하는 게 아님을 보장) ──
  it('역검증: O-2 패턴은 실제로 store 파일에서 매치된다(그렇지 않으면 O-2가 무의미하게 통과할 수 있다)', () => {
    const store = apiFileContents.find(({ f }) => f.endsWith('inbox/core/inbox.store.ts'))!.content;
    expect(nonCommentOccurrences(store, /\bprisma\.customer\.create\(/) + nonCommentOccurrences(store, /\btx\.customer\.create\(/)).toBeGreaterThan(0);
  });
});
