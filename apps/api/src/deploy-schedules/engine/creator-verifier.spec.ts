import { CreatorVerifier } from './creator-verifier';

/**
 * 새 테스트 — 구현·리뷰 단계 공백 보강(2026-09-24, No.28 시험 회차). 실행 직전 예약자 재검증
 * (FR-D3-12, §8.3)은 이전까지 통합 시험(AC-D4-3 계정 비활성)에서만 간접적으로 검증됐다 — 단위
 * 수준에서 판정 분기 전부(계정 없음·비활성·권한 부족·`mustChangePassword` 무시)를 직접 검증한다.
 */
describe('CreatorVerifier(FR-D3-12, §8.3)', () => {
  function makePrisma(user: unknown) {
    return { user: { findUnique: jest.fn().mockResolvedValue(user) } };
  }

  it('계정이 ACTIVE고 필요 권한을 모두 보유하면 검증된 주체(현재 이메일·역할)를 반환한다', async () => {
    const prisma = makePrisma({ id: 'u1', email: 'editor@chat-bot.local', role: 'EDITOR', status: 'ACTIVE' });
    const verifier = new CreatorVerifier(prisma as never);

    const actor = await verifier.verify('u1', ['dialogue:write', 'chatbot:write']);

    expect(actor).toEqual({ id: 'u1', email: 'editor@chat-bot.local', role: 'EDITOR' });
  });

  it('사용자 행이 없으면(물리 삭제되지 않지만 방어적으로) null이다', async () => {
    const prisma = makePrisma(null);
    const verifier = new CreatorVerifier(prisma as never);

    expect(await verifier.verify('missing', ['chatbot:write'])).toBeNull();
  });

  it('계정이 DISABLED면 null이다(AC-D4-3)', async () => {
    const prisma = makePrisma({ id: 'u1', email: 'editor@chat-bot.local', role: 'EDITOR', status: 'DISABLED' });
    const verifier = new CreatorVerifier(prisma as never);

    expect(await verifier.verify('u1', ['chatbot:write'])).toBeNull();
  });

  it('역할이 강등돼 필요 권한 중 하나라도 없으면 null이다(AC-D4-4, AND 판정)', async () => {
    // VIEWER는 chatbot:write는 있어도(가정) dialogue:write가 없다 — RESTORE_VERSION은 둘 다 필요.
    const prisma = makePrisma({ id: 'u1', email: 'viewer@chat-bot.local', role: 'VIEWER', status: 'ACTIVE' });
    const verifier = new CreatorVerifier(prisma as never);

    expect(await verifier.verify('u1', ['dialogue:write', 'chatbot:write'])).toBeNull();
  });

  it('mustChangePassword는 조회 select에 없으므로 값과 무관하게 검증에 영향을 주지 않는다(권한 박탈이 아니다)', async () => {
    // select에 mustChangePassword를 포함하지 않는다는 것 자체가 "보지 않는다"는 설계 보증이다 —
    // 반환값에 그 필드가 섞여 있어도(과거 스키마 확장 등) 검증 결과가 permissions만으로 결정됨을 확인한다.
    const prisma = makePrisma({ id: 'u1', email: 'editor@chat-bot.local', role: 'EDITOR', status: 'ACTIVE', mustChangePassword: true });
    const verifier = new CreatorVerifier(prisma as never);

    const actor = await verifier.verify('u1', ['chatbot:write']);
    expect(actor).toEqual({ id: 'u1', email: 'editor@chat-bot.local', role: 'EDITOR' });
  });

  it('필요 권한이 빈 배열이면(이론상) 계정 상태만으로 통과한다', async () => {
    const prisma = makePrisma({ id: 'u1', email: 'admin@chat-bot.local', role: 'VIEWER', status: 'ACTIVE' });
    const verifier = new CreatorVerifier(prisma as never);

    expect(await verifier.verify('u1', [])).toEqual({ id: 'u1', email: 'admin@chat-bot.local', role: 'VIEWER' });
  });
});
