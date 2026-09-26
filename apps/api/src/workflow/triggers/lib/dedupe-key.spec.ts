import { eventDedupeKey, nodeDedupeKey } from './dedupe-key';

describe('No.41 발송함 유일 키(§6.1·§6.2)', () => {
  it('nodeDedupeKey — N:<messageId>:<nodeId>:<outputIndex>', () => {
    expect(nodeDedupeKey('m1', 'n1', 0)).toBe('N:m1:n1:0');
  });

  it('eventDedupeKey — E:<subscriptionId>:<sourceKey>', () => {
    expect(eventDedupeKey('sub1', 'src1')).toBe('E:sub1:src1');
  });
});
