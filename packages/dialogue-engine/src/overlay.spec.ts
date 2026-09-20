import { mergeOverlay } from './overlay';
import { makeBundle, makeIntent, makeNode } from './test-fixtures';

describe('mergeOverlay — FR-10-19, DD-28', () => {
  it('id가 일치하는 항목은 교체된다', () => {
    const intent = makeIntent({ name: '원본', examples: ['원본 예문'] });
    const bundle = makeBundle({ intents: [intent] });
    const replaced = { ...intent, name: '수정본', examples: ['수정 예문'] };

    const merged = mergeOverlay(bundle, { intents: [replaced] });

    expect(merged.intents).toHaveLength(1);
    expect(merged.intents[0].name).toBe('수정본');
  });

  it('draft- 접두 id의 신규 항목은 추가된다', () => {
    const bundle = makeBundle({ intents: [] });
    const draft = makeIntent({ id: 'draft-1', name: '신규의도' });

    const merged = mergeOverlay(bundle, { intents: [draft] });

    expect(merged.intents).toHaveLength(1);
    expect(merged.intents[0].id).toBe('draft-1');
  });

  it('deletedIds에 포함된 id는 제거된다', () => {
    const a = makeIntent({ name: 'A' });
    const b = makeIntent({ name: 'B' });
    const bundle = makeBundle({ intents: [a, b] });

    const merged = mergeOverlay(bundle, { deletedIds: { intents: [a.id] } });

    expect(merged.intents.map((i) => i.id)).toEqual([b.id]);
  });

  it('존재하지 않는 id의 deletedIds는 오류 없이 무시된다(EX-10-8)', () => {
    const bundle = makeBundle({ intents: [makeIntent()] });

    expect(() => mergeOverlay(bundle, { deletedIds: { intents: ['missing-id'] } })).not.toThrow();
  });

  it('원본 bundle을 변형하지 않는다', () => {
    const intent = makeIntent({ name: '원본' });
    const bundle = makeBundle({ intents: [intent] });
    const snapshot = JSON.stringify(bundle);

    mergeOverlay(bundle, { intents: [{ ...intent, name: '변경' }] });

    expect(JSON.stringify(bundle)).toBe(snapshot);
  });

  it('영향받지 않는 종류(dialogNodes)는 그대로 유지된다', () => {
    const node = makeNode();
    const bundle = makeBundle({ dialogNodes: [node] });

    const merged = mergeOverlay(bundle, { intents: [makeIntent()] });

    expect(merged.dialogNodes).toEqual([node]);
  });
});
