import { RichUrlPolicyService } from './rich-url-policy.service';

/**
 * [신규 No.46 — 코드 리뷰 R1 M-2·L-1] `RichUrlPolicyService` 단위 시험 — DB 무의존(prisma 목).
 * unchanged 판정 · 변경 없을 때 쓰기·감사 0 · `includeSubdomains` 단독 변경 감지 ·
 * `outsideNodeCount` · 쿼리 재사용(`assertWritable` 결과 재사용 — `this.get()` 재호출 없음).
 */
function buildDeps(overrides: Partial<Record<string, unknown>> = {}) {
  const prisma = {
    chatbotRichUrlPolicy: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    dialogNode: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const scope = {
    assertReadable: jest.fn().mockResolvedValue({ prodVersionId: null }),
    assertWritable: jest.fn().mockResolvedValue({ prodVersionId: null, name: '테스트 챗봇' }),
  };
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) };

  return { prisma, scope, auditLog, ...overrides };
}

function buildService(deps: ReturnType<typeof buildDeps>): RichUrlPolicyService {
  return new RichUrlPolicyService(deps.prisma as never, deps.scope as never, deps.auditLog as never);
}

const CHATBOT_ID = '11111111-1111-1111-1111-111111111111';

function policyRow(hosts: Array<{ host: string; includeSubdomains: boolean }>, updatedAt = new Date('2026-09-01T00:00:00.000Z')) {
  return { chatbotId: CHATBOT_ID, hosts: JSON.stringify(hosts), updatedById: null, createdAt: updatedAt, updatedAt };
}

describe('RichUrlPolicyService.update', () => {
  it('변경 없음(unchanged) — 쓰기·감사 0회, assertWritable 결과(name)를 재사용해 별도 chatbot 조회가 없다', async () => {
    const deps = buildDeps();
    deps.prisma.chatbotRichUrlPolicy.findUnique.mockResolvedValue(policyRow([{ host: 'img.example.com', includeSubdomains: false }]));
    const service = buildService(deps);

    const result = await service.update(CHATBOT_ID, { hosts: [{ host: 'img.example.com', includeSubdomains: false }] });

    expect(deps.prisma.chatbotRichUrlPolicy.upsert).not.toHaveBeenCalled();
    expect(deps.auditLog.record).not.toHaveBeenCalled();
    expect(deps.scope.assertWritable).toHaveBeenCalledTimes(1);
    // [L-1] `get()`을 다시 부르지 않으므로 존재 확인용 `assertReadable`이 호출되지 않는다.
    expect(deps.scope.assertReadable).not.toHaveBeenCalled();
    expect(result.hosts).toEqual([{ host: 'img.example.com', includeSubdomains: false }]);
    expect(result.updatedAt).toEqual(new Date('2026-09-01T00:00:00.000Z'));
  });

  it('호스트 목록이 실제로 바뀌면 쓰기·감사 1회 — 감사 전후 값에 includeSubdomains 포함', async () => {
    const deps = buildDeps();
    deps.prisma.chatbotRichUrlPolicy.findUnique.mockResolvedValue(policyRow([{ host: 'a.example.com', includeSubdomains: false }]));
    deps.prisma.chatbotRichUrlPolicy.upsert.mockResolvedValue(policyRow([{ host: 'b.example.com', includeSubdomains: true }], new Date('2026-09-27T00:00:00.000Z')));
    const service = buildService(deps);

    const result = await service.update(CHATBOT_ID, { hosts: [{ host: 'b.example.com', includeSubdomains: true }] });

    expect(deps.prisma.chatbotRichUrlPolicy.upsert).toHaveBeenCalledTimes(1);
    expect(deps.auditLog.record).toHaveBeenCalledTimes(1);
    const call = deps.auditLog.record.mock.calls[0][0];
    expect(call.before).toEqual({ richUrlHosts: [{ host: 'a.example.com', includeSubdomains: false }] });
    expect(call.after).toEqual({ richUrlHosts: [{ host: 'b.example.com', includeSubdomains: true }] });
    expect(call.targetName).toBe('테스트 챗봇');
    expect(result.hosts).toEqual([{ host: 'b.example.com', includeSubdomains: true }]);
    expect(result.updatedAt).toEqual(new Date('2026-09-27T00:00:00.000Z'));
  });

  it('호스트 수는 같아도 includeSubdomains만 바뀌면 변경으로 감지해 쓰기·감사한다', async () => {
    const deps = buildDeps();
    deps.prisma.chatbotRichUrlPolicy.findUnique.mockResolvedValue(policyRow([{ host: 'a.example.com', includeSubdomains: false }]));
    deps.prisma.chatbotRichUrlPolicy.upsert.mockResolvedValue(policyRow([{ host: 'a.example.com', includeSubdomains: true }]));
    const service = buildService(deps);

    await service.update(CHATBOT_ID, { hosts: [{ host: 'a.example.com', includeSubdomains: true }] });

    expect(deps.prisma.chatbotRichUrlPolicy.upsert).toHaveBeenCalledTimes(1);
    expect(deps.auditLog.record).toHaveBeenCalledTimes(1);
    const call = deps.auditLog.record.mock.calls[0][0];
    // [M-2] 호스트 수가 같아도(1 → 1) summary에 무엇이 바뀌었는지(하위 도메인 포함 변경)가 드러난다.
    expect(call.summary).toContain('하위 도메인 포함 변경');
    expect(call.summary).toContain('a.example.com');
  });

  it('summary에 추가·삭제 호스트도 드러난다', async () => {
    const deps = buildDeps();
    deps.prisma.chatbotRichUrlPolicy.findUnique.mockResolvedValue(policyRow([{ host: 'old.example.com', includeSubdomains: false }]));
    deps.prisma.chatbotRichUrlPolicy.upsert.mockResolvedValue(policyRow([{ host: 'new.example.com', includeSubdomains: false }]));
    const service = buildService(deps);

    await service.update(CHATBOT_ID, { hosts: [{ host: 'new.example.com', includeSubdomains: false }] });

    const call = deps.auditLog.record.mock.calls[0][0];
    expect(call.summary).toContain('추가 1(new.example.com)');
    expect(call.summary).toContain('삭제 1(old.example.com)');
  });

  it('outsideNodeCount — 허용 목록 밖 주소를 쓰는 노드 수를 반영한다', async () => {
    const deps = buildDeps();
    deps.prisma.chatbotRichUrlPolicy.findUnique.mockResolvedValue(policyRow([{ host: 'allowed.example.com', includeSubdomains: false }]));
    deps.prisma.chatbotRichUrlPolicy.upsert.mockResolvedValue(policyRow([{ host: 'allowed.example.com', includeSubdomains: false }]));
    deps.prisma.dialogNode.findMany.mockResolvedValue([
      {
        id: 'node-1',
        name: '노드1',
        outputs: JSON.stringify([
          { type: 'CAROUSEL', payload: { cards: [{ title: 't', imageUrl: 'https://outside.example.com/a.png', buttons: [] }] } },
        ]),
      },
      { id: 'node-2', name: '노드2', outputs: JSON.stringify([{ type: 'TEXT', payload: { text: '안녕' } }]) },
    ]);
    const service = buildService(deps);

    const result = await service.update(CHATBOT_ID, { hosts: [{ host: 'allowed.example.com', includeSubdomains: false }] });

    expect(result.outsideNodeCount).toBe(1);
  });

  it('허용 목록이 빈 배열이면(제한 없음) outsideNodeCount는 노드 스캔 없이 0이다', async () => {
    const deps = buildDeps();
    deps.prisma.chatbotRichUrlPolicy.findUnique.mockResolvedValue(null);
    deps.prisma.chatbotRichUrlPolicy.upsert.mockResolvedValue(policyRow([]));
    const service = buildService(deps);

    const result = await service.update(CHATBOT_ID, { hosts: [] });

    expect(result.outsideNodeCount).toBe(0);
    expect(deps.prisma.dialogNode.findMany).not.toHaveBeenCalled();
  });
});
