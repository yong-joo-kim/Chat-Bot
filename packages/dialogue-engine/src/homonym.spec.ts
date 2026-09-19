import { buildClarifyOutput, resolveHomonym } from './homonym';
import { normalizeText } from './normalize';
import { makeHomonym } from './test-fixtures';

describe('resolveHomonym — FR-7-1~9', () => {
  it('AC-7-4: 힌트가 없는 모호한 입력은 ASK 정책에서 되묻기(BUTTON) 대상이 된다', () => {
    const dict = makeHomonym({ policy: 'ASK' });
    const evaluation = resolveHomonym(normalizeText('배 얼마예요?'), [dict]);

    expect(evaluation.resolution?.status).toBe('AMBIGUOUS');
    const output = buildClarifyOutput(evaluation);
    expect(output.type).toBe('BUTTON');
  });

  it('AC-7-5: 문맥 힌트가 있으면 해당 의미로 확정되고 연결 의도가 포함된다', () => {
    const dict = makeHomonym({
      policy: 'ASK',
      meanings: [
        { label: '과일', contextHints: ['사과', '포도'], intentId: 'intent-fruit' },
        { label: '선박', contextHints: ['항구', '운항'], intentId: 'intent-ship' },
      ],
    });
    const evaluation = resolveHomonym(normalizeText('항구에서 배 출발 시간'), [dict]);

    expect(evaluation.resolution?.status).toBe('RESOLVED');
    expect(evaluation.resolution?.intentId).toBe('intent-ship');
  });

  it('AC-7-6: IGNORE 정책은 모호해도 되묻지 않고 IGNORED로 반환한다', () => {
    const dict = makeHomonym({ policy: 'IGNORE' });
    const evaluation = resolveHomonym(normalizeText('배가 아파요'), [dict]);
    // '아프다'는 힌트로 등록되지 않았으므로 모호 상태 → IGNORE 정책이라 IGNORED
    expect(evaluation.resolution?.status).toBe('IGNORED');
  });
});
