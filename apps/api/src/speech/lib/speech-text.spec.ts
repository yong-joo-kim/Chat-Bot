import { maskPii } from '@chat-bot/pii-mask';
import { SPEECH_LIMITS } from '@chat-bot/shared-types';
import type { DialogOutput } from '@chat-bot/shared-types';
import { PII_MASK_READ_LABELS, buildSpeechText, cleanSpeechText, outputToSpeechPiece } from './speech-text';

const text = (t: string): DialogOutput => ({ type: 'TEXT', payload: { text: t } });

describe('buildSpeechText(§6.1)', () => {
  it('TEXT는 본문 그대로, 출력 사이 경계는 ". "', () => {
    expect(buildSpeechText([text('안녕하세요'), text('무엇을 도와드릴까요?')])).toBe('안녕하세요. 무엇을 도와드릴까요?');
  });

  it('CARD: 제목. 설명. + 선택지', () => {
    const card: DialogOutput = { type: 'CARD', payload: { title: '요금 안내', description: '월 9,900원입니다', buttons: [{ label: '자세히', action: 'MESSAGE', value: '요금' }, { label: '상담', action: 'MESSAGE', value: '상담' }] } };
    expect(buildSpeechText([card])).toBe('요금 안내. 월 9,900원입니다. 선택지: 자세히, 상담.');
  });

  it('CAROUSEL: 머리글 + N번, 제목. 설명. + 카드 버튼 선택지', () => {
    const carousel: DialogOutput = {
      type: 'CAROUSEL',
      payload: {
        version: 1,
        text: '상품을 골라 주세요',
        cards: [
          { title: 'A상품', description: '가볍다', buttons: [{ label: '구매', action: 'MESSAGE', value: 'A' }] },
          { title: 'B상품' },
        ],
      },
    };
    expect(buildSpeechText([carousel])).toBe('상품을 골라 주세요. 1번, A상품. 가볍다. 선택지: 구매. 2번, B상품.');
  });

  it('BUTTON(일반·바로연결): 머리글 + 선택지(동작 종류 무관 라벨만)', () => {
    const normal: DialogOutput = { type: 'BUTTON', payload: { text: '무엇이 궁금하세요?', buttons: [{ label: '배송', action: 'MESSAGE', value: '배송' }, { label: '홈페이지', action: 'LINK', value: 'https://example.com' }] } };
    const quick: DialogOutput = { type: 'BUTTON', payload: { display: 'QUICK_REPLY', buttons: [{ label: '예', action: 'MESSAGE', value: '예' }, { label: '아니오', action: 'MESSAGE', value: '아니오' }] } };
    expect(buildSpeechText([normal])).toBe('무엇이 궁금하세요? 선택지: 배송, 홈페이지.');
    expect(buildSpeechText([quick])).toBe('선택지: 예, 아니오.');
  });

  it('LINK: 라벨만(주소는 읽지 않는다) · IMAGE: 대체 글 · PHONE_CALL: 고정 문구', () => {
    expect(buildSpeechText([{ type: 'LINK', payload: { label: '약관 보기', url: 'https://example.com/terms', openInNewTab: true } }])).toBe('약관 보기');
    expect(buildSpeechText([{ type: 'IMAGE', payload: { imageUrl: 'https://example.com/a.png', altText: '매장 지도' } }])).toBe('이미지: 매장 지도');
    expect(buildSpeechText([{ type: 'PHONE_CALL', payload: { label: '고객센터', phoneNumber: '02-123-4567' } }])).toBe('전화 연결 버튼이 있습니다.');
  });

  it('PAUSE·CONTEXT_FORM·DIALOG_MOVE·SCENARIO·SURVEY·API_CONDITION·WORKFLOW는 읽지 않는다', () => {
    const outputs = [
      { type: 'PAUSE', payload: { durationMs: 500 } },
      { type: 'CONTEXT_FORM', payload: { contextVariableId: '11111111-1111-4111-8111-111111111111' } },
      { type: 'DIALOG_MOVE', payload: { targetNodeId: '11111111-1111-4111-8111-111111111111' } },
      { type: 'SCENARIO', payload: { scenarioKey: 'x' } },
      { type: 'SURVEY', payload: { surveyId: 's' } },
    ] as unknown as DialogOutput[];
    for (const o of outputs) expect(outputToSpeechPiece(o)).toBe('');
    expect(buildSpeechText(outputs)).toBe('');
  });

  it('읽을 글자가 없으면 빈 문자열(⑨ — speech 키를 만들지 않는다)', () => {
    expect(buildSpeechText([])).toBe('');
    expect(buildSpeechText([{ type: 'PAUSE', payload: { durationMs: 100 } }])).toBe('');
  });
});

describe('cleanSpeechText 정리 9단계', () => {
  it('① 가림 표시 → 읽기', () => {
    expect(cleanSpeechText('카드 [카드번호] 주민 [주민등록번호] 계좌 [계좌번호] 전화 [전화번호] 메일 [이메일]')).toBe(
      '카드 카드번호 가림 주민 주민등록번호 가림 계좌 계좌번호 가림 전화 전화번호 가림 메일 이메일 가림',
    );
  });

  it('② 별표 2개 이상 연속 → "가림"', () => {
    expect(cleanSpeechText('번호는 010-****-5678 입니다')).toBe('번호는 010- 가림 -5678 입니다');
    expect(cleanSpeechText('별 * 하나는 그대로')).toBe('별 * 하나는 그대로');
  });

  it('③ URL 제거', () => {
    expect(cleanSpeechText('자세한 내용은 https://example.com/a?b=1 에서, www.example.com 도 보세요')).toBe('자세한 내용은 에서, 도 보세요');
  });

  it('④ 이모지 제거 · ⑤ 장식 기호 제거(마침표·쉼표·물음표·괄호·퍼센트·원 보존)', () => {
    expect(cleanSpeechText('안녕하세요 😀👍 ★특가★ ※주의 → 할인율 20% (부가세 별도) 5,000원.')).toBe('안녕하세요 특가 주의 할인율 20% (부가세 별도) 5,000원.');
  });

  it('⑥ 전화번호 하이픈 → 쉼', () => {
    expect(cleanSpeechText('전화는 02-123-4567 또는 010-1234-5678 입니다')).toBe('전화는 02, 123, 4567 또는 010, 1234, 5678 입니다');
  });

  it('⑦ 공백 정리 · 줄바꿈 → ". " 경계(이미 문장 부호면 공백만)', () => {
    expect(cleanSpeechText('첫 줄\n\n  둘째   줄!\n셋째')).toBe('첫 줄. 둘째 줄! 셋째');
  });

  it('⑧ 2,000자 초과 → 문장 경계에서 자르고 꼬리 문구', () => {
    const sentence = '이것은 열 글자 문장입니다.';
    const long = Array.from({ length: 300 }, () => sentence).join(' ');
    const out = cleanSpeechText(long);
    expect(out.endsWith(SPEECH_LIMITS.speechTextTail)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(SPEECH_LIMITS.speechTextMaxChars + SPEECH_LIMITS.speechTextTail.length + 1);
    expect(out.slice(0, out.length - SPEECH_LIMITS.speechTextTail.length - 1).endsWith('.')).toBe(true);
  });

  it('⑧ 문장 부호·공백이 없는 긴 글자도 2,000자에서 자른다', () => {
    const out = cleanSpeechText('가'.repeat(5000));
    expect(out).toBe(`${'가'.repeat(2000)} ${SPEECH_LIMITS.speechTextTail}`);
  });

  it('2,000자·캐러셀 10장 변환이 빠르다(NFR-VOP1 목표 ≤ 수 ms)', () => {
    const cards = Array.from({ length: 10 }, (_, i) => ({ title: `상품${i}`, description: '설명 '.repeat(80), buttons: [{ label: '선택', action: 'MESSAGE' as const, value: 'x' }] }));
    const outputs: DialogOutput[] = [{ type: 'CAROUSEL', payload: { version: 1, cards } }, text('가'.repeat(1000)), text('나'.repeat(1000))];
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 50; i += 1) buildSpeechText(outputs);
    const perCallMs = Number(process.hrtime.bigint() - t0) / 1e6 / 50;
    expect(perCallMs).toBeLessThan(200); // 10배 여유 — 부하 플래키 방어(호출당 선형 시간 방어 의도 유지)
  });
});

/** VO-14 표류 감시 — pii-mask가 만들어 내는 `[...]` 가림 표시가 모두 읽기 닫힌 목록에 있어야 한다(C-13 · pii-mask 변경 0). */
describe('가림 표시 표류 감시(VO-14)', () => {
  const samples = [
    '주민번호 901231-1234567 입니다',
    '카드 1234-5678-9012-3456 로 결제',
    '전화 010-1234-5678 로 연락',
    '계좌 110-234-567890 입금',
    '메일 someone@example.com 으로',
    '생년월일 1990-05-12 이고 주민 900101-2345678 카드 4111 1111 1111 1111 전화 02-123-4567 계좌 123-456-789012 메일 a.b@c.co.kr',
  ];
  const known = new Set(PII_MASK_READ_LABELS.map(([mark]) => mark));

  it.each(['PARTIAL', 'FULL'] as const)('%s 방식의 가림 표시는 전부 닫힌 목록 안에 있다', (mode) => {
    const seen = new Set<string>();
    for (const sample of samples) {
      const { maskedText } = maskPii(sample, { mode });
      for (const m of maskedText.matchAll(/\[[^\]]+\]/g)) seen.add(m[0]);
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const mark of seen) expect(known.has(mark)).toBe(true);
  });

  it('FULL 방식은 다섯 표시를 전부 낸다(목록이 실제로 쓰인다)', () => {
    const seen = new Set<string>();
    for (const sample of samples) for (const m of maskPii(sample, { mode: 'FULL' }).maskedText.matchAll(/\[[^\]]+\]/g)) seen.add(m[0]);
    expect([...seen].sort()).toEqual([...known].sort());
  });
});
