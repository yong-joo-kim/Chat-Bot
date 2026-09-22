import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * NFR-LP1/AC-L4-5 — "이 그룹(No.16/23)은 공개 대화 API의 성능 예산에 어떤 영향도 주지 않는다."
 * 를 정적으로 강제한다(`asset-write-sealing.spec.ts`와 같은 패턴 — 스캔 루트 지정·자기 자신 제외·
 * 0건이 아님을 먼저 단언).
 *
 * 근거: 공개 대화 요청 경로(`PublicConversationController` → `PublicConversationService` 및
 * 그 직접 협력자들, `apps/api/src/conversation/**`)에 classifier·augmentation·TrainingJob 관련
 * 심볼이 0건이면, 이 그룹이 그 경로에 신규 DB 조회·계산을 추가할 수 있는 코드 경로 자체가
 * 존재하지 않는다 — "성능에 영향 없음"을 매 요청 벤치마크가 아니라 **구조로** 증명한다
 * (§4.5 J-6, FR-0-49/NFR-LM3의 dialogue-engine 불가침 검사와 대칭되는 apps/api 쪽 경계).
 */

const REPO_ROOT = resolve(__dirname, '../../../..');
const SELF_ABSOLUTE = resolve(__dirname, 'public-conversation-classifier-isolation.spec.ts');

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
    if (entry === 'node_modules' || entry === 'dist') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, extensions, out);
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(fullPath);
    }
  }
}

function nonCommentOccurrences(content: string, pattern: RegExp): number {
  let count = 0;
  for (const line of content.split('\n')) {
    if (isCommentLine(line)) continue;
    const matches = line.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

describe('공개 대화 API 경로 — classifier/augmentation 무영향 정적 검사(NFR-LP1, AC-L4-5)', () => {
  const conversationFiles: string[] = [];
  walk(join(REPO_ROOT, 'apps/api/src/conversation'), ['.ts'], conversationFiles);
  const filesUnderTest = conversationFiles.filter((f) => f !== SELF_ABSOLUTE);
  const contents = filesUnderTest.map((f) => ({ f, content: readFileSync(f, 'utf8') }));

  it('스캔 대상(공개 대화 경로) 파일이 존재한다(회귀 방지 — 스캔 자체가 조용히 0건이 되는 것을 막는다)', () => {
    expect(filesUnderTest.length).toBeGreaterThan(3);
  });

  it.each(filesUnderTest)('%s에 classifier·augmentation·TrainingJob 심볼이 없다(대소문자 무관, 주석 제외)', (file) => {
    const content = contents.find((x) => x.f === file)!.content;
    expect(nonCommentOccurrences(content, /classifier/gi)).toBe(0);
    expect(nonCommentOccurrences(content, /augmentation/gi)).toBe(0);
    expect(nonCommentOccurrences(content, /trainingjob/gi)).toBe(0);
  });

  it('ConversationModule은 ClassifierModule·AugmentationModule·TrainingJobsModule을 import하지 않는다', () => {
    const moduleFile = contents.find(({ f }) => f.replace(/\\/g, '/').endsWith('conversation/conversation.module.ts'));
    expect(moduleFile).toBeDefined();
    expect(nonCommentOccurrences(moduleFile!.content, /\bClassifierModule\b/g)).toBe(0);
    expect(nonCommentOccurrences(moduleFile!.content, /\bAugmentationModule\b/g)).toBe(0);
    expect(nonCommentOccurrences(moduleFile!.content, /\bTrainingJobsModule\b/g)).toBe(0);
  });

  it('LearningModule에서 ConversationModule이 실제로 주입받는 UnansweredCollectorService 자신도 classifier/augmentation 심볼이 없다(간접 경로 확인)', () => {
    const collectorPath = join(REPO_ROOT, 'apps/api/src/learning/unanswered-collector.service.ts');
    const content = readFileSync(collectorPath, 'utf8');
    expect(nonCommentOccurrences(content, /classifier/gi)).toBe(0);
    expect(nonCommentOccurrences(content, /augmentation/gi)).toBe(0);
  });
});
