import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AuditTargetType, EncryptedFieldId, Permission, RetentionTargetKind, SpeechResponseKind } from '@chat-bot/shared-types';
import { PII_MASK_RULES_VERSION } from '@chat-bot/pii-mask';
import { EGRESS_REGISTRY } from '../../common/egress/egress-registry';

/**
 * 음성 AI(No.32) 정적 검사 — `voice-ai-설계.md` §14 봉인 VO-1~VO-17 중 **서버·공유 영역**.
 * (VO-9·VO-15는 위젯 전용 — `apps/widget`이 `core/speech-sealing.spec.ts`에서 검사한다. VO-16은 ml-worker `tests/test_speech_sealing.py`가 검사한다.)
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const API_SRC = join(REPO_ROOT, 'apps/api/src');

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === '__golden__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
}

function rel(absolute: string): string {
  return absolute.replace(/\\/g, '/').replace(`${REPO_ROOT.replace(/\\/g, '/')}/`, '');
}

/** 주석 줄을 뺀 본문(줄 단위). */
function code(content: string): string {
  return content
    .split('\n')
    .filter((l) => !isCommentLine(l))
    .join('\n');
}

function count(content: string, pattern: RegExp): number {
  const g = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return (code(content).match(g) ?? []).length;
}

function load(root: string, opts: { includeSpec?: boolean } = {}): Array<{ f: string; content: string }> {
  const files: string[] = [];
  walk(join(REPO_ROOT, root), files);
  return files.filter((f) => opts.includeSpec || !f.endsWith('.spec.ts')).map((f) => ({ f: rel(f), content: readFileSync(f, 'utf8') }));
}

const apiFiles = load('apps/api/src').filter(({ f }) => !f.includes('/integration/'));
const speechFiles = apiFiles.filter(({ f }) => f.startsWith('apps/api/src/speech/'));
const file = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8');

describe('음성 AI(No.32) 정적 검사 — voice-ai-설계.md §14', () => {
  it('스캔 대상이 0건이 아니다(가드)', () => {
    expect(apiFiles.length).toBeGreaterThan(100);
    expect(speechFiles.length).toBeGreaterThan(10);
  });

  it('VO-1) engine·채널 어댑터·channel.ts·rich-degrade.ts·pii-mask에 speech·voice·SpeechTone 심볼 0', () => {
    const targets = [
      ...load('packages/dialogue-engine/src'),
      ...load('packages/pii-mask/src'),
      ...load('apps/api/src/conversation/adapters'),
      { f: 'packages/shared-types/src/channel.ts', content: file('packages/shared-types/src/channel.ts') },
      { f: 'packages/shared-types/src/rich-degrade.ts', content: file('packages/shared-types/src/rich-degrade.ts') },
    ];
    expect(targets.length).toBeGreaterThan(10);
    const offenders = targets.filter(({ content }) => count(content, /\b(speech|voice|SpeechTone)\b/i) > 0).map((e) => e.f);
    expect(offenders).toEqual([]);
  });

  it('VO-2) @Public() 총 10 · 10번째 = transcribeSpeech(컨트롤러 마지막 핸들러) · 앞 600자에 @PublicRateBucket(·kind: \'SPEECH\' · 합성 경로 문자열 0', () => {
    const controllers = apiFiles.filter(({ f }) => f.endsWith('.controller.ts'));
    expect(controllers.reduce((sum, { content }) => sum + count(content, /@Public\(\)/g), 0)).toBe(10);

    const src = file('apps/api/src/conversation/public-conversation.controller.ts');
    const idx = src.indexOf('transcribeSpeech(');
    expect(idx).toBeGreaterThan(0);
    const before = src.slice(Math.max(0, idx - 600), idx);
    expect(before).toContain('@Public()');
    expect(before).toContain('@PublicRateBucket(');
    expect(before).toContain(`kind: 'SPEECH'`);
    for (const other of ['getConfig(', 'sendMessage(', 'pollMessage(', 'pollHandoff(', 'submitFeedback(', 'recordProactiveEvent(']) expect(src.indexOf(other)).toBeLessThan(idx);
    // 합성(TTS) 관련 공개 경로 0 — 이 기능은 서버 합성을 하지 않는다(P-3).
    expect(count(src, /synthes|\/tts/i)).toBe(0);
  });

  it('VO-3) API speech/**에 파일 쓰기·multipart·임시 디렉터리 0', () => {
    const forbidden = /writeFile|createWriteStream|fs\.promises\.write|appendFile|\bmulter\b|FileInterceptor|diskStorage|os\.tmpdir|tmpdir\(/;
    expect(speechFiles.filter(({ content }) => count(content, forbidden) > 0).map((e) => e.f)).toEqual([]);
  });

  it('VO-4) 로그 호출 인자에 text·transcript·audio·buffer·bytes·sessionId 식별자 0(speech/** · transcribeSpeech 경로)', () => {
    const logCall = /logger\.(?:log|warn|error|debug|verbose)\(([^\n]*)\)/g;
    const forbidden = /\b(text|transcript|audio|buffer|bytes|sessionId)\b/;
    const offenders: string[] = [];
    for (const { f, content } of speechFiles) {
      for (const m of code(content).matchAll(logCall)) if (forbidden.test(m[1])) offenders.push(`${f}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);

    const service = file('apps/api/src/conversation/public-conversation.service.ts');
    const start = service.indexOf('async transcribeSpeech(');
    const end = service.indexOf('async sendMessage(');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(count(service.slice(start, end), /logger\./)).toBe(0);
  });

  it('VO-5) 공급자 transcribe( 호출은 공개 인식 서비스뿐 · 대화 턴 본문에 speechTranscription 0 · VoicePublicService는 공급자·세마포어를 받지 않는다', () => {
    const callers = apiFiles.filter(({ content }) => count(content, /\.transcribe\(/) > 0).map((e) => e.f);
    // 공급자 호출 = speech-transcription.service.ts 1곳. conversation 서비스의 `transcribe(` 호출은 그 서비스에 위임하는 transcribeSpeech 1곳뿐이다.
    expect(callers.sort()).toEqual(['apps/api/src/conversation/public-conversation.service.ts', 'apps/api/src/speech/public/speech-transcription.service.ts']);
    const providerCalls = apiFiles.filter(({ content }) => count(content, /provider\.transcribe\(/) > 0).map((e) => e.f);
    expect(providerCalls).toEqual(['apps/api/src/speech/public/speech-transcription.service.ts']);

    const service = file('apps/api/src/conversation/public-conversation.service.ts');
    const turnBodies = service.slice(service.indexOf('async sendMessage('), service.indexOf('private evaluateRagEligibility('));
    expect(count(turnBodies, /speechTranscription/)).toBe(0);
    expect(count(service.slice(service.indexOf('async transcribeSpeech('), service.indexOf('async sendMessage(')), /\.transcribe\(/)).toBe(1);

    const voicePublic = file('apps/api/src/speech/reply/voice-public.service.ts');
    expect(count(voicePublic, /SpeechRecognitionProvider|SPEECH_RECOGNITION_PROVIDER|NonBlockingSemaphore|SpeechStatWriter|\.transcribe\(/)).toBe(0);
  });

  it('VO-6) SPEECH_LOCAL 레지스트리 파일 = 실제 fetch( 파일 1개 · fetch( 앞 assertEgressAllowed(', () => {
    const def = EGRESS_REGISTRY.find((e) => e.exitId === 'SPEECH_LOCAL');
    expect(def?.files).toEqual(['speech/providers/local-speech-recognition.provider.ts']);
    expect(def?.dataKind).toBe('AUDIO_RAW');
    const fetchers = speechFiles.filter(({ content }) => count(content, /\bfetch\(/) > 0).map((e) => e.f);
    expect(fetchers).toEqual(['apps/api/src/speech/providers/local-speech-recognition.provider.ts']);
    const provider = file('apps/api/src/speech/providers/local-speech-recognition.provider.ts');
    expect(count(provider, /assertEgressAllowed\(/)).toBe(count(provider, /\bfetch\(/));
    expect(count(provider, /egressRedirectMode\(\)/)).toBe(count(provider, /\bfetch\(/));
  });

  it('VO-7) 음성 설정·인식 숫자 쓰기 호출 파일 ⊆ 허용 목록', () => {
    const write = (model: string) => new RegExp(`\\.${model}\\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\\(`);
    const settingWriters = apiFiles.filter(({ content }) => count(content, write('chatbotVoiceSetting')) > 0).map((e) => e.f);
    const statWriters = apiFiles.filter(({ content }) => count(content, write('speechDailyStat')) > 0).map((e) => e.f);
    expect(settingWriters.sort()).toEqual(['apps/api/src/chatbots/chatbots.service.ts', 'apps/api/src/speech/admin/voice-settings.service.ts']);
    expect(statWriters.sort()).toEqual(['apps/api/src/chatbots/chatbots.service.ts', 'apps/api/src/speech/core/speech-stat.writer.ts']);
    // chatbots.service.ts는 deleteMany만 쓴다.
    const chatbots = file('apps/api/src/chatbots/chatbots.service.ts');
    expect(count(chatbots, /\.(?:chatbotVoiceSetting|speechDailyStat)\.(?:create|createMany|update|updateMany|upsert|delete)\(/)).toBe(0);
  });

  it('VO-8) SpeechDailyStat에 글자·세션·IP·시각 원본 컬럼 0 · logService.record 인자에 speech 0 · 보류 저장소 결과 타입에 speech 글자 필드 0', () => {
    const schema = file('apps/api/prisma/schema.prisma');
    const block = /model SpeechDailyStat \{([\s\S]*?)\n\}/.exec(schema.replace(/\r\n/g, '\n'))![1];
    const columns = block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('///') && !l.startsWith('@@'))
      .map((l) => l.split(/\s+/)[0]);
    expect(columns).toEqual(['id', 'chatbotId', 'chatbot', 'dayBucket', 'ok', 'empty', 'invalid', 'failed', 'busy', 'createdAt', 'updatedAt']);

    const service = file('apps/api/src/conversation/public-conversation.service.ts');
    for (const m of service.matchAll(/logService\.record\(\{([\s\S]*?)\}\);/g)) expect(m[1]).not.toMatch(/\bspeech/i);
    const ragAnswer = file('apps/api/src/rag/rag-answer.service.ts');
    for (const m of ragAnswer.matchAll(/logPort\.record\(\{([\s\S]*?)\}\);/g)) expect(m[1]).not.toMatch(/\bspeech/i);

    const store = file('apps/api/src/rag/pending-answer.store.ts').replace(/\r\n/g, '\n');
    const resultBlock = /export interface PendingAnswerResult \{([\s\S]*?)\n\}/.exec(store)![1];
    expect(resultBlock).not.toMatch(/\bspeech\b/);
    expect(count(resultBlock, /safetyReplaced/)).toBe(1); // 표식(참/없음)뿐 — 글자 아님
  });

  it('VO-10) speech.tone을 만드는 함수 = speech-tone.ts 1개(decideSpeechTone) — 소비는 VoicePublicService뿐', () => {
    const definers = apiFiles.filter(({ content }) => count(content, /export function decideSpeechTone\(/) > 0).map((e) => e.f);
    expect(definers).toEqual(['apps/api/src/speech/lib/speech-tone.ts']);
    const users = apiFiles.filter(({ content }) => count(content, /\bdecideSpeechTone\(/) > 0).map((e) => e.f);
    expect(users.sort()).toEqual(['apps/api/src/speech/lib/speech-tone.ts', 'apps/api/src/speech/reply/voice-public.service.ts']);
    expect(count(file('apps/api/src/speech/reply/voice-public.service.ts'), /tone: decideSpeechTone\(/)).toBe(1);
  });

  it('VO-11) shared-types speech-voice.ts에 import 0', () => {
    const src = file('packages/shared-types/src/speech-voice.ts');
    expect(/^\s*import\s/m.test(src)).toBe(false);
    expect(/\brequire\s*\(/.test(src)).toBe(false);
  });

  it('VO-12) 버킷 접두 sp-ip·sp-key가 기존 접두와 겹치지 않고 기존 4행은 바이트 불변', () => {
    const guard = file('apps/api/src/conversation/guards/public-rate-limit.guard.ts');
    const prefixes = [...guard.matchAll(/(?:ipPrefix|keyPrefix): '([^']+)'/g)].map((m) => m[1]);
    expect(prefixes).toEqual(['poll-ip', 'poll-key', 'fb-ip', 'fb-key', 'pa-rules-ip', 'pa-rules-key', 'pa-ev-ip', 'pa-ev-key', 'sp-ip', 'sp-key']);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const reserved of ['ip', 'session']) expect(prefixes).not.toContain(reserved);
    const norm = guard.replace(/\r\n/g, '\n');
    expect(norm).toContain(`  POLL: { ipPrefix: 'poll-ip', keyPrefix: 'poll-key', ipLimitEnv: 'PUBLIC_POLL_RATE_LIMIT_IP_PER_MIN', ipLimitFallback: 600 },`);
    expect(norm).toContain(`  FEEDBACK: { ipPrefix: 'fb-ip', keyPrefix: 'fb-key', ipLimitEnv: 'PUBLIC_FEEDBACK_RATE_LIMIT_IP_PER_MIN', ipLimitFallback: 120 },`);
    expect(norm).toContain(`  PROACTIVE_RULES: { ipPrefix: 'pa-rules-ip', keyPrefix: 'pa-rules-key', ipLimitEnv: 'PUBLIC_PROACTIVE_RULES_RATE_LIMIT_IP_PER_MIN', ipLimitFallback: 300 },`);
    expect(norm).toContain(`  PROACTIVE_EVENT: { ipPrefix: 'pa-ev-ip', keyPrefix: 'pa-ev-key', ipLimitEnv: 'PUBLIC_PROACTIVE_EVENT_RATE_LIMIT_IP_PER_MIN', ipLimitFallback: 300 },`);
    expect(norm).toContain(`SPEECH: { ipPrefix: 'sp-ip', keyPrefix: 'sp-key', ipLimitEnv: 'PUBLIC_SPEECH_RATE_LIMIT_IP_PER_MIN', ipLimitFallback: 30 },`);
  });

  it('VO-13) Permission 18 불변 · voice.controller @RequirePermission 인자 ⊆ {channel:read, channel:write}', () => {
    expect(Permission.options).toHaveLength(18);
    const controller = file('apps/api/src/speech/voice.controller.ts');
    const args = [...code(controller).matchAll(/@RequirePermission\('([^']+)'\)/g)].map((m) => m[1]);
    expect(args.length).toBe(3);
    for (const a of args) expect(['channel:read', 'channel:write']).toContain(a);
  });

  it('VO-14) RetentionTargetKind·EncryptedFieldId·AuditTargetType·PII_MASK_RULES_VERSION 불변', () => {
    expect(RetentionTargetKind.options).toHaveLength(8);
    expect(EncryptedFieldId.options).toHaveLength(6);
    expect(AuditTargetType.options).toHaveLength(38);
    expect(PII_MASK_RULES_VERSION).toBe(3);
  });

  describe('VO-17 [H-3 · DD-135]', () => {
    const service = file('apps/api/src/conversation/public-conversation.service.ts').replace(/\r\n/g, '\n');

    it('① withSpeech( 호출은 정확히 2개이며 출력 인자가 .slice(를 포함 · 시스템 안내 3종 반환문에 withSpeech·speech 토큰 0', () => {
      const lines = code(service)
        .split('\n')
        .filter((l) => /(?<!function )\bwithSpeech\(/.test(l));
      expect(lines).toHaveLength(2);
      for (const l of lines) expect(l).toContain('.slice(');
      expect(lines[0]).toContain(`'SAFETY'`);
      expect(lines[1]).toMatch(/'ANSWERED' : 'UNANSWERED'/);

      const body = code(service);
      for (const constant of ['BANNED_WORD_GUIDANCE_TEXT', 'VERSION_UNAVAILABLE_FALLBACK_TEXT', 'RAG_WAITING_TEXT']) {
        const declared = body.indexOf(`const ${constant} =`);
        expect(declared).toBeGreaterThanOrEqual(0);
        // 선언 뒤 첫 사용 지점부터 그 반환문 끝(첫 ';\n')까지 — 반환문 블록.
        const use = body.indexOf(constant, declared + constant.length + 10);
        expect(use).toBeGreaterThan(declared);
        const returnAt = body.indexOf('return ', use);
        const end = body.indexOf(';\n', returnAt);
        const block = body.slice(use, end);
        expect(block).not.toMatch(/withSpeech|speech/i);
      }
    });

    it('② SpeechResponseKind 값은 정확히 ANSWERED·UNANSWERED·SAFETY', () => {
      expect([...SpeechResponseKind.options]).toEqual(['ANSWERED', 'UNANSWERED', 'SAFETY']);
    });

    it('③ NODE_ENV 값 읽기 파일 = config/runtime-env.ts 1개', () => {
      const readers = apiFiles.filter(({ content }) => count(content, /\.NODE_ENV\b|\['NODE_ENV'\]|\["NODE_ENV"\]/) > 0).map((e) => e.f);
      expect(readers).toEqual(['apps/api/src/config/runtime-env.ts']);
    });
  });
});
