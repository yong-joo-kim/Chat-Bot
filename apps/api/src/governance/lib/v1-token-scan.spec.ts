import { nodeHasV1PlainHeader } from './v1-token-scan';
import type { DialogOutput } from '@chat-bot/shared-types';

describe('governance/lib/v1-token-scan(No.45) — v1 평문 헤더 잔존 판정', () => {
  it('v1 API_CONDITION에 headers가 있으면 true', () => {
    const outputs = [
      {
        type: 'API_CONDITION',
        payload: { method: 'GET', url: 'https://example.com', headers: { Authorization: 'Bearer secret' }, conditions: [{ path: 'a', operator: 'EQ', nextNodeId: 'n1' }] },
      },
    ] as unknown as DialogOutput[];
    expect(nodeHasV1PlainHeader(outputs)).toBe(true);
  });

  it('v1 API_CONDITION이지만 headers가 없으면 false', () => {
    const outputs = [
      { type: 'API_CONDITION', payload: { method: 'GET', url: 'https://example.com', conditions: [{ path: 'a', operator: 'EQ', nextNodeId: 'n1' }] } },
    ] as unknown as DialogOutput[];
    expect(nodeHasV1PlainHeader(outputs)).toBe(false);
  });

  it('v2 API_CONDITION(연결 참조형)은 대상이 아니다', () => {
    const outputs = [
      { type: 'API_CONDITION', payload: { version: 2, connectionId: 'conn-1', method: 'GET', pathTemplate: '/x', pathParams: [], query: [], body: [], responseMappings: [], conditions: [] } },
    ] as unknown as DialogOutput[];
    expect(nodeHasV1PlainHeader(outputs)).toBe(false);
  });

  it('빈 outputs는 false', () => {
    expect(nodeHasV1PlainHeader([])).toBe(false);
  });

  it('API_CONDITION이 아닌 다른 타입은 무시한다', () => {
    const outputs = [{ type: 'TEXT', payload: { text: 'hi' } }] as unknown as DialogOutput[];
    expect(nodeHasV1PlainHeader(outputs)).toBe(false);
  });
});
