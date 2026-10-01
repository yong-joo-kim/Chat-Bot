import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 음성 AI(No.32) 위젯 정적 검사(설계 §14 · VO-9 계열) — 정적 소스 스캔(주석 줄 제외).
 * 서버 쪽 봉인은 `apps/api/src/speech/lib/speech-sealing.spec.ts`가 검사한다.
 */
const SRC = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n'); // Windows 체크아웃(CRLF)·혼합 줄바꿈 모두 허용

function code(rel: string): string {
  return read(rel)
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}

const VOICE_FILES = [
  'constants/speech.ts',
  'core/speech-autoread-storage.ts',
  'core/speech-capture.ts',
  'core/speech-playback.ts',
  'ui/autoread-toggle.ts',
  'ui/dom.ts',
  'ui/mic-button.ts',
  'ui/speech-button.ts',
];

describe('위젯 음성 정적 검사', () => {
  it('읽기(재생) 경로는 글자를 기기 밖으로 보내지 않는다 — fetch·XMLHttpRequest·sendBeacon·WebSocket 0(VO-9)', () => {
    for (const f of ['core/speech-playback.ts', 'ui/speech-button.ts', 'ui/autoread-toggle.ts', 'core/speech-autoread-storage.ts']) {
      expect(code(f), f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/);
    }
  });

  it('녹음 상태기계는 네트워크를 직접 쓰지 않는다(인식 호출은 주입) · 녹음 바이트를 저장소에 쓰지 않는다(FR-VO6-7)', () => {
    const c = code('core/speech-capture.ts');
    expect(c).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/);
    for (const f of VOICE_FILES) {
      expect(code(f), f).not.toMatch(/localStorage|indexedDB|document\.cookie/);
    }
    expect(code('core/speech-capture.ts')).not.toMatch(/sessionStorage/);
  });

  it('getUserMedia·getVoices는 각 코어 한 곳에서만 호출된다(조립 조건 NFR-VOP5의 검사 지점)', () => {
    const files = ['ui/app.ts', 'ui/mic-button.ts', 'ui/composer.ts', 'ui/panel.ts', 'ui/message-list.ts', 'ui/speech-button.ts', 'ui/autoread-toggle.ts'];
    for (const f of files) expect(code(f), f).not.toMatch(/\.getUserMedia\(|\.getVoices\(/);
    expect(code('core/speech-capture.ts')).toMatch(/\.getUserMedia\(/);
    expect(code('core/speech-playback.ts')).toMatch(/\.getVoices\(/);
  });

  it("'speech-v1' 문자열은 constants/speech.ts 한 곳에만 있다", () => {
    for (const f of VOICE_FILES.concat(['api/public-client.ts', 'ui/app.ts'])) {
      const has = /['"`]speech-v1['"`]/.test(code(f));
      expect(has, f).toBe(f === 'constants/speech.ts');
    }
  });

  it('E-10: 음성 코드에 환경 분리(No.40) 금지 토큰이 없다', () => {
    // apps/api E-10 정적 검사(environment-sealing.spec.ts)가 apps/widget/src 전체를 스캔하므로, 이 파일의 소스 텍스트에 금지 단어가
    // 연속된 글자로 나타나지 않게 두 조각으로 나눠 결합한다(런타임 정규식은 동일 — proactive-sealing.spec.ts PA-18 선례).
    const forbidden = new RegExp(['e', 'nvironment'].join(''), 'i');
    for (const f of VOICE_FILES) expect(code(f), f).not.toMatch(forbidden);
  });

  it('법무 확인 전 — 첫 사용 고지 문구·키가 번들에 없다(호출 지점만)', () => {
    expect(code('constants/speech.ts')).not.toMatch(/notice(Body|Confirm|Cancel)/i);
    expect(code('core/speech-capture.ts')).toMatch(/ensureSpeechNoticeAcknowledged/);
  });

  it('듣기·토글 UI는 라이브 영역을 만들지 않는다(읽기 시작·끝 낭독 금지 — 스크린리더와 겹침)', () => {
    for (const f of ['ui/speech-button.ts', 'ui/autoread-toggle.ts', 'ui/mic-button.ts']) {
      expect(code(f), f).not.toMatch(/aria-live|role['"]?\s*[,:]\s*['"](status|alert|log)/);
    }
  });
});

describe('위젯 음성 CSS — 터치 44px · 애니메이션 0 · 투명도로 비활성 표시 금지(대비 4.5:1)', () => {
  const css = read('styles.ts');
  const start = css.indexOf('.cb-composer--voice');
  const end = css.indexOf('@media (max-width: 420px) {\n  .cb-root[data-mode="mobile"] .cb-pa-bubble');
  const block = css.slice(start, end);

  it('음성 규칙 블록을 찾았다(가드)', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  it('말하기·취소·듣기·토글 버튼은 최소 44×44px', () => {
    const rule = block.match(/\.cb-mic, \.cb-voice-cancel, \.cb-listen, \.cb-ar-switch \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/min-width: 44px/);
    expect(rule![0]).toMatch(/min-height: 44px/);
  });

  it('animation·transition·opacity를 쓰지 않는다', () => {
    expect(block).not.toMatch(/animation|transition|opacity/);
  });

  it('hidden 속성이 display 규칙에 덮이지 않도록 [hidden] 규칙이 있다', () => {
    expect(block).toMatch(/\.cb-voice-line\[hidden\][^{]*\{ display: none; \}/);
  });

  it('포커스 표시(:focus-visible 아웃라인)가 있다', () => {
    expect(block).toMatch(/\.cb-mic:focus-visible[^{]*\{ outline: 3px solid/);
  });
});
