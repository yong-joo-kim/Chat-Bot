import { decideManualLink, decideUnlink } from './link-rule';

describe('decideManualLink(순수 함수, §7.2)', () => {
  it('연결이 없으면 생성이다', () => {
    expect(decideManualLink(null, 'cust-1')).toEqual({ action: 'CREATE' });
  });

  it('같은 고객이면 변경 없음이다', () => {
    expect(decideManualLink({ customerId: 'cust-1', source: 'MANUAL' }, 'cust-1')).toEqual({ action: 'NOOP' });
  });

  it('다른 고객의 MANUAL/SYSTEM 연결은 재지정이다', () => {
    expect(decideManualLink({ customerId: 'cust-2', source: 'MANUAL' }, 'cust-1')).toEqual({ action: 'REASSIGN' });
    expect(decideManualLink({ customerId: 'cust-2', source: 'SYSTEM' }, 'cust-1')).toEqual({ action: 'REASSIGN' });
  });

  it('IDENTITY 연결은 잠김이다(FR-OC3-3)', () => {
    expect(decideManualLink({ customerId: 'cust-2', source: 'IDENTITY' }, 'cust-1')).toEqual({ action: 'LOCKED' });
  });
});

describe('decideUnlink(순수 함수, §7.2·§7.3)', () => {
  it('MANUAL은 되돌리기다', () => {
    expect(decideUnlink({ customerId: 'c', source: 'MANUAL' })).toEqual({ action: 'REVERT' });
  });
  it('SYSTEM은 삭제다', () => {
    expect(decideUnlink({ customerId: 'c', source: 'SYSTEM' })).toEqual({ action: 'DELETE' });
  });
  it('IDENTITY는 ADMIN 전용이다', () => {
    expect(decideUnlink({ customerId: 'c', source: 'IDENTITY' })).toEqual({ action: 'ADMIN_ONLY' });
  });
});
