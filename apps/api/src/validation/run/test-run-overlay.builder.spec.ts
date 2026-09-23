import { TestRunOverlayBuilder } from './test-run-overlay.builder';

/**
 * M2 오버레이 소스 `AUGMENTATION_SUGGESTIONS` 합성 단위 시험(FR-V2-9~15, §6.5).
 * `AugmentationSuggestion`은 Prisma 모킹으로만 읽는다 — 쓰기 메서드는 이 서비스에 존재하지
 * 않으므로(정적 검사가 별도 단언) 여기서는 **합성 로직 자체의 정확성**(중복 제거·stale
 * 제외·20건 상한·삭제된 의도 제외)을 검증한다.
 */
function buildIntent(id: string, examples: string[]) {
  return { id, chatbotId: 'bot-1', name: `의도-${id}`, examples, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') };
}

function buildPrisma(rows: Array<{ id: string; intentId: string; text: string; status: string; modelId: string; chatbotId?: string }>) {
  return {
    augmentationSuggestion: {
      findMany: jest.fn().mockResolvedValue(rows.map((r) => ({ chatbotId: 'bot-1', ...r }))),
    },
  };
}

describe('TestRunOverlayBuilder.build — FR-V2-9~15', () => {
  it('PENDING 제안을 의도별로 묶어 examples에 append한 오버레이 intent를 만든다(쓰기 0건 — findMany만 호출)', async () => {
    const prisma = buildPrisma([{ id: 's1', intentId: 'intent-1', text: '새로운 예문', status: 'PENDING', modelId: 'm1' }]);
    const builder = new TestRunOverlayBuilder(prisma as never);
    const bundle = { intents: [buildIntent('intent-1', ['기존 예문'])] };

    const result = await builder.build('bot-1', bundle, ['s1'], 'm1');

    expect(result.patch.intents).toHaveLength(1);
    expect(result.patch.intents![0].examples).toEqual(['기존 예문', '새로운 예문']);
    expect(result.excludedSuggestionCount).toBe(0);
    expect(result.vectorTargets).toEqual([{ intentId: 'intent-1', slotIndex: 1, text: '새로운 예문' }]);
    // 쓰기 메서드가 애초에 mock 객체에 없으므로 호출됐다면 TypeError로 즉시 실패했을 것이다.
    expect(prisma.augmentationSuggestion.findMany).toHaveBeenCalledTimes(1);
  });

  it('status가 PENDING이 아니면 조용히 제외하고 제외 건수에 반영한다(요청 전체를 거부하지 않는다)', async () => {
    const prisma = buildPrisma([
      { id: 's1', intentId: 'intent-1', text: '승인된 예문', status: 'ACCEPTED', modelId: 'm1' },
      { id: 's2', intentId: 'intent-1', text: '거절된 예문', status: 'REJECTED', modelId: 'm1' },
    ]);
    const builder = new TestRunOverlayBuilder(prisma as never);
    const bundle = { intents: [buildIntent('intent-1', [])] };

    const result = await builder.build('bot-1', bundle, ['s1', 's2'], 'm1');

    expect(result.patch.intents).toHaveLength(0);
    expect(result.excludedSuggestionCount).toBe(2);
  });

  it('modelId가 현재와 다르면(stale) 제외한다', async () => {
    const prisma = buildPrisma([{ id: 's1', intentId: 'intent-1', text: '예문', status: 'PENDING', modelId: 'old-model' }]);
    const builder = new TestRunOverlayBuilder(prisma as never);
    const bundle = { intents: [buildIntent('intent-1', [])] };

    const result = await builder.build('bot-1', bundle, ['s1'], 'current-model');

    expect(result.excludedSuggestionCount).toBe(1);
    expect(result.patch.intents).toHaveLength(0);
  });

  it('currentModelId가 undefined(임베딩 비활성)이면 modelId 불일치로 제외하지 않는다(저하 모드에서도 규칙 매칭 오버레이는 유효)', async () => {
    const prisma = buildPrisma([{ id: 's1', intentId: 'intent-1', text: '예문', status: 'PENDING', modelId: 'old-model' }]);
    const builder = new TestRunOverlayBuilder(prisma as never);
    const bundle = { intents: [buildIntent('intent-1', [])] };

    const result = await builder.build('bot-1', bundle, ['s1'], undefined);

    expect(result.excludedSuggestionCount).toBe(0);
    expect(result.patch.intents).toHaveLength(1);
  });

  it('요청 id가 DB에 없으면(삭제됨) 제외한다', async () => {
    const prisma = buildPrisma([]);
    const builder = new TestRunOverlayBuilder(prisma as never);
    const bundle = { intents: [buildIntent('intent-1', [])] };

    const result = await builder.build('bot-1', bundle, ['ghost-id'], 'm1');

    expect(result.excludedSuggestionCount).toBe(1);
  });

  it('대상 의도가 이미 삭제된 경우 제외한다', async () => {
    const prisma = buildPrisma([{ id: 's1', intentId: 'deleted-intent', text: '예문', status: 'PENDING', modelId: 'm1' }]);
    const builder = new TestRunOverlayBuilder(prisma as never);
    const bundle = { intents: [buildIntent('intent-1', [])] };

    const result = await builder.build('bot-1', bundle, ['s1'], 'm1');

    expect(result.excludedSuggestionCount).toBe(1);
    expect(result.patch.intents).toHaveLength(0);
  });

  it('정규화 기준 기존 예문과 중복되는 제안은 조용히 건너뛴다(examples에 추가되지 않음, 제외 집계도 하지 않음)', async () => {
    const prisma = buildPrisma([{ id: 's1', intentId: 'intent-1', text: '  기존 예문  ', status: 'PENDING', modelId: 'm1' }]);
    const builder = new TestRunOverlayBuilder(prisma as never);
    const bundle = { intents: [buildIntent('intent-1', ['기존 예문'])] };

    const result = await builder.build('bot-1', bundle, ['s1'], 'm1');

    expect(result.patch.intents![0].examples).toEqual(['기존 예문']);
    expect(result.vectorTargets).toEqual([]);
  });

  it('오버레이 intent 수가 20건(종류별 상한)을 넘으면 그 이후 의도의 제안은 제외한다(FR-V2-10)', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, intentId: `intent-${i}`, text: `예문 ${i}`, status: 'PENDING', modelId: 'm1' }));
    const prisma = buildPrisma(rows);
    const builder = new TestRunOverlayBuilder(prisma as never);
    const bundle = { intents: Array.from({ length: 21 }, (_, i) => buildIntent(`intent-${i}`, [])) };

    const result = await builder.build(
      'bot-1',
      bundle,
      rows.map((r) => r.id),
      'm1',
    );

    expect(result.patch.intents).toHaveLength(20);
    expect(result.excludedSuggestionCount).toBe(1);
  });
});
