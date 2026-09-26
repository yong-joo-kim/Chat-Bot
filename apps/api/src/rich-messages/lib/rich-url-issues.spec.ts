import type { DialogOutput } from '@chat-bot/shared-types';
import { countNodesOutsideRichUrlPolicy, findDisallowedRichUrl, richUrlDesignIssues } from './rich-url-issues';

function carouselOutputs(imageUrl: string): DialogOutput[] {
  return [{ type: 'CAROUSEL', payload: { version: 1, cards: [{ title: '카드1', imageUrl, altText: '대체' }, { title: '카드2' }] } } as unknown as DialogOutput];
}

describe('richUrlDesignIssues — RICH_URL_NOT_ALLOWED · RICH_URL_SUSPICIOUS', () => {
  it('허용 목록이 비어 있으면 NOT_ALLOWED가 나지 않는다', () => {
    const issues = richUrlDesignIssues([{ id: 'n1', name: '노드1', outputs: carouselOutputs('https://blocked.example.com/a.png') }], []);
    expect(issues.some((i) => i.code === 'RICH_URL_NOT_ALLOWED')).toBe(false);
  });

  it('허용 목록이 있고 호스트가 목록 밖이면 WARNING RICH_URL_NOT_ALLOWED', () => {
    const issues = richUrlDesignIssues(
      [{ id: 'n1', name: '노드1', outputs: carouselOutputs('https://blocked.example.com/a.png') }],
      [{ host: 'allowed.example.com', includeSubdomains: false }],
    );
    expect(issues).toEqual([expect.objectContaining({ code: 'RICH_URL_NOT_ALLOWED', severity: 'WARNING', resourceId: 'n1', resourceName: '노드1' })]);
  });

  it('퓨니코드·IP·단축 URL은 INFO RICH_URL_SUSPICIOUS(허용 목록과 무관)', () => {
    const issues = richUrlDesignIssues([{ id: 'n1', name: '노드1', outputs: carouselOutputs('https://127.0.0.1/a.png') }], []);
    expect(issues).toEqual([expect.objectContaining({ code: 'RICH_URL_SUSPICIOUS', severity: 'INFO' })]);
  });

  it('새 컴포넌트 URL이 없는 노드는 이슈를 내지 않는다', () => {
    const issues = richUrlDesignIssues([{ id: 'n1', name: '노드1', outputs: [{ type: 'TEXT', payload: { text: '안녕' } }] }], [{ host: 'x.example.com', includeSubdomains: false }]);
    expect(issues).toEqual([]);
  });
});

describe('countNodesOutsideRichUrlPolicy — EX-RM-13', () => {
  it('목록이 비면 항상 0', () => {
    expect(countNodesOutsideRichUrlPolicy([{ id: 'n1', name: 'n', outputs: carouselOutputs('https://blocked.example.com/a.png') }], [])).toBe(0);
  });

  it('목록 밖 노드 수만 센다(같은 노드 여러 URL이어도 1건)', () => {
    const count = countNodesOutsideRichUrlPolicy([{ id: 'n1', name: 'n', outputs: carouselOutputs('https://blocked.example.com/a.png') }], [{ host: 'allowed.example.com', includeSubdomains: false }]);
    expect(count).toBe(1);
  });
});

describe('findDisallowedRichUrl — 저장 검증용 첫 위반 위치', () => {
  it('목록이 비면 null', () => {
    expect(findDisallowedRichUrl(carouselOutputs('https://blocked.example.com/a.png'), [])).toBeNull();
  });

  it('목록 밖 호스트의 field·host를 돌려준다', () => {
    const result = findDisallowedRichUrl(carouselOutputs('https://blocked.example.com/a.png'), [{ host: 'allowed.example.com', includeSubdomains: false }]);
    expect(result).toEqual({ field: 'outputs.0.payload.cards.0.imageUrl', host: 'blocked.example.com' });
  });

  it('목록 안 호스트면 null', () => {
    expect(findDisallowedRichUrl(carouselOutputs('https://allowed.example.com/a.png'), [{ host: 'allowed.example.com', includeSubdomains: false }])).toBeNull();
  });
});
