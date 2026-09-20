import type { DialogOutput, DialogOutputType } from '@chat-bot/shared-types';
import { degradeOutputs } from './output-degrade';

describe('degradeOutputs — FR-11-19', () => {
  const webSupported = new Set<DialogOutputType>(['TEXT', 'CARD', 'IMAGE', 'BUTTON', 'LINK', 'PAUSE', 'PHONE_CALL']);

  it('WEB은 전 타입을 지원하므로 격하가 발생하지 않는다', () => {
    const outputs: DialogOutput[] = [
      { type: 'TEXT', payload: { text: '안녕' } },
      { type: 'CARD', payload: { title: '카드' } },
    ];
    const result = degradeOutputs(outputs, webSupported);
    expect(result).toEqual(outputs);
  });

  it('미지원 타입은 TEXT로 격하된다', () => {
    const limited = new Set<DialogOutputType>(['TEXT']);
    const outputs: DialogOutput[] = [{ type: 'CARD', payload: { title: '카드제목' } }];
    const result = degradeOutputs(outputs, limited);
    expect(result).toEqual([{ type: 'TEXT', payload: { text: '[카드] 카드제목' } }]);
  });
});
