import { ConfigService } from '@nestjs/config';
import { ApiConnectionsService } from './api-connections.service';
import { ReferenceCheckService } from '../dialogue-common/reference-check.service';
import { ApiException } from '../common/api.exception';
import type { CreateApiConnectionDto, UpdateApiConnectionDto } from '@chat-bot/shared-types';

/**
 * 단위 테스트 범위(코드 리뷰 1회차 M-4 일부): CRUD · `allowRawPersonalData` 확인값 플로우 ·
 * 삭제 409와 `details[].chatbotId`(M-2) · `countReferencingNodes` 집계 정확성(M-1, `contains`
 * 사전 필터가 부분 문자열 오탐을 파싱 단계에서 걸러내는지 포함). 통합 시나리오는 다루지 않는다.
 */

const NOW = new Date('2026-01-01T00:00:00Z');

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'conn-1',
    name: '샘플 연결',
    nameNormalized: '샘플 연결',
    description: null,
    baseUrl: 'https://legacy.example.invalid/api',
    allowedMethods: JSON.stringify(['GET']),
    authType: 'NONE',
    authHeaderName: null,
    secretRef: null,
    timeoutMs: 3000,
    rateLimitPerMin: 120,
    allowRawPersonalData: false,
    personalDataLookup: false,
    sampleResponses: JSON.stringify([]),
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** `where.outputs.contains`를 실제 SQLite `contains`처럼 부분 문자열로 필터링하는 가짜 dialogNode.findMany. */
function buildDialogNodeFindMany(rows: Array<{ id: string; name: string; chatbotId: string; outputs: string; chatbot: { name: string } }>) {
  return jest.fn((args: { where?: { outputs?: { contains?: string } } } = {}) => {
    const needle = args.where?.outputs?.contains;
    const filtered = needle ? rows.filter((r) => r.outputs.includes(needle)) : rows;
    return Promise.resolve(filtered);
  });
}

function buildDeps(dialogNodeRows: Array<{ id: string; name: string; chatbotId: string; outputs: string; chatbot: { name: string } }> = []) {
  const apiConnection = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const dialogNode = { findMany: buildDialogNodeFindMany(dialogNodeRows) };
  const prisma = { apiConnection, dialogNode };
  const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;
  const auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
  // 실제 ReferenceCheckService를 사용한다 — M-2(chatbotId 포함) 로직을 목으로 우회하지 않는다.
  const referenceCheck = new ReferenceCheckService(prisma as never);
  const legacyApiService = {
    secretStatus: jest.fn().mockReturnValue('NOT_REQUIRED'),
    isCircuitOpen: jest.fn().mockReturnValue(false),
    testConnection: jest.fn(),
  };
  const callLogService = { stats24h: jest.fn().mockResolvedValue({ calls: 0, failures: 0 }) };

  const service = new ApiConnectionsService(
    prisma as never,
    config,
    auditLogService as never,
    referenceCheck,
    legacyApiService as never,
    callLogService as never,
  );

  return { service, prisma, config, auditLogService, referenceCheck, legacyApiService, callLogService };
}

describe('ApiConnectionsService — CRUD', () => {
  it('create() — 정상 생성 시 감사로그(CREATE)를 남기고 DTO를 반환한다', async () => {
    const { service, prisma, auditLogService } = buildDeps();
    prisma.apiConnection.findUnique.mockResolvedValue(null);
    prisma.apiConnection.create.mockResolvedValue(makeRow());

    const dto: CreateApiConnectionDto = {
      name: '샘플 연결',
      baseUrl: 'https://legacy.example.invalid/api',
      allowedMethods: ['GET'],
      authType: 'NONE',
      allowRawPersonalData: false,
      personalDataLookup: false,
      sampleResponses: [],
      enabled: true,
    };

    const result = await service.create(dto);

    expect(result.id).toBe('conn-1');
    expect(auditLogService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', targetType: 'ApiConnection', targetId: 'conn-1' }));
  });

  it('create() — 이름이 중복되면 409 DUPLICATE_NAME을 던진다', async () => {
    const { service, prisma } = buildDeps();
    prisma.apiConnection.findUnique.mockResolvedValue(makeRow());

    const dto: CreateApiConnectionDto = {
      name: '샘플 연결',
      baseUrl: 'https://legacy.example.invalid/api',
      allowedMethods: ['GET'],
      authType: 'NONE',
      allowRawPersonalData: false,
      personalDataLookup: false,
      sampleResponses: [],
      enabled: true,
    };

    await expect(service.create(dto)).rejects.toBeInstanceOf(ApiException);
  });

  it('findOne() — 존재하지 않으면 404 NOT_FOUND를 던진다', async () => {
    const { service, prisma } = buildDeps();
    prisma.apiConnection.findUnique.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toBeInstanceOf(ApiException);
  });

  it('update() — 이름 변경 시 자기 자신을 제외하고 중복을 검사한다', async () => {
    const { service, prisma } = buildDeps();
    prisma.apiConnection.findUnique.mockResolvedValue(makeRow());
    prisma.apiConnection.findFirst.mockResolvedValue(null);
    prisma.apiConnection.update.mockResolvedValue(makeRow({ name: '새 이름' }));

    await service.update('conn-1', { name: '새 이름' });

    expect(prisma.apiConnection.findFirst).toHaveBeenCalledWith({ where: { nameNormalized: expect.any(String), id: { not: 'conn-1' } } });
  });

  it('remove() — 참조 노드가 없으면 삭제하고 감사로그(DELETE)를 남긴다', async () => {
    const { service, prisma, auditLogService } = buildDeps([]);
    prisma.apiConnection.findUnique.mockResolvedValue(makeRow());
    prisma.apiConnection.delete.mockResolvedValue(undefined);

    await service.remove('conn-1');

    expect(prisma.apiConnection.delete).toHaveBeenCalledWith({ where: { id: 'conn-1' } });
    expect(auditLogService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE', targetId: 'conn-1' }));
  });
});

describe('ApiConnectionsService — allowRawPersonalData 확인값 플로우', () => {
  it('create() — 원문 송신을 켜면서 확인값을 생략하면 400 CONFIRM_NAME_MISMATCH를 던진다', async () => {
    const { service, prisma } = buildDeps();
    prisma.apiConnection.findUnique.mockResolvedValue(null);

    const dto: CreateApiConnectionDto = {
      name: '샘플 연결',
      baseUrl: 'https://legacy.example.invalid/api',
      allowedMethods: ['GET'],
      authType: 'NONE',
      allowRawPersonalData: true,
      personalDataLookup: false,
      sampleResponses: [],
      enabled: true,
    };

    await expect(service.create(dto)).rejects.toBeInstanceOf(ApiException);
    expect(prisma.apiConnection.create).not.toHaveBeenCalled();
  });

  it('create() — 확인값이 연결 이름과 일치하면 통과한다', async () => {
    const { service, prisma } = buildDeps();
    prisma.apiConnection.findUnique.mockResolvedValue(null);
    prisma.apiConnection.create.mockResolvedValue(makeRow({ allowRawPersonalData: true }));

    const dto: CreateApiConnectionDto = {
      name: '샘플 연결',
      baseUrl: 'https://legacy.example.invalid/api',
      allowedMethods: ['GET'],
      authType: 'NONE',
      allowRawPersonalData: true,
      confirmRawPersonalData: '샘플 연결',
      personalDataLookup: false,
      sampleResponses: [],
      enabled: true,
    };

    const result = await service.create(dto);
    expect(result.allowRawPersonalData).toBe(true);
  });

  it('update() — false→true로 전환하면서 확인값을 생략하면 거부된다', async () => {
    const { service, prisma } = buildDeps();
    prisma.apiConnection.findUnique.mockResolvedValue(makeRow({ allowRawPersonalData: false }));

    const dto: UpdateApiConnectionDto = { allowRawPersonalData: true };

    await expect(service.update('conn-1', dto)).rejects.toBeInstanceOf(ApiException);
    expect(prisma.apiConnection.update).not.toHaveBeenCalled();
  });

  it('update() — 이미 true인 연결을 true로 유지하는 요청은 확인값 없이도 통과한다(변경 없음)', async () => {
    const { service, prisma } = buildDeps();
    prisma.apiConnection.findUnique.mockResolvedValue(makeRow({ allowRawPersonalData: true }));
    prisma.apiConnection.update.mockResolvedValue(makeRow({ allowRawPersonalData: true }));

    await expect(service.update('conn-1', { allowRawPersonalData: true })).resolves.toBeDefined();
    expect(prisma.apiConnection.update).toHaveBeenCalled();
  });

  it('update() — true→false(해제)는 확인값 없이 통과한다', async () => {
    const { service, prisma } = buildDeps();
    prisma.apiConnection.findUnique.mockResolvedValue(makeRow({ allowRawPersonalData: true }));
    prisma.apiConnection.update.mockResolvedValue(makeRow({ allowRawPersonalData: false }));

    await expect(service.update('conn-1', { allowRawPersonalData: false })).resolves.toBeDefined();
  });
});

describe('ApiConnectionsService — 삭제 409(API_CONNECTION_IN_USE)와 details[].chatbotId(M-2)', () => {
  it('참조 노드가 있으면 409를 던지고 details에 field=nodeId · message="챗봇명 › 노드명" · chatbotId를 담는다', async () => {
    const referencingNode = {
      id: 'node-1',
      name: '주문조회_API',
      chatbotId: 'bot-1',
      chatbot: { name: '고객지원봇' },
      outputs: JSON.stringify([
        {
          type: 'API_CONDITION',
          payload: { version: 2, connectionId: 'conn-1', method: 'GET', path: '/orders/1', pathParams: [], query: [], body: [], responseMappings: [], conditions: [] },
        },
      ]),
    };
    const { service, prisma } = buildDeps([referencingNode]);
    prisma.apiConnection.findUnique.mockResolvedValue(makeRow({ id: 'conn-1' }));

    let caught: ApiException | undefined;
    try {
      await service.remove('conn-1');
    } catch (e) {
      caught = e as ApiException;
    }

    expect(caught).toBeInstanceOf(ApiException);
    const body = caught?.getResponse() as { code: string; details: Array<{ field: string; message: string; chatbotId?: string }> };
    expect(body.code).toBe('API_CONNECTION_IN_USE');
    expect(caught?.getStatus()).toBe(409);
    expect(body.details).toEqual([{ field: 'node-1', message: '고객지원봇 › 주문조회_API', chatbotId: 'bot-1' }]);
    expect(prisma.apiConnection.delete).not.toHaveBeenCalled();
  });

  it('v1 API_CONDITION(연결 미참조 형식)은 참조로 세지 않는다', async () => {
    const legacyNode = {
      id: 'node-2',
      name: '레거시노드',
      chatbotId: 'bot-1',
      chatbot: { name: '고객지원봇' },
      outputs: JSON.stringify([
        { type: 'API_CONDITION', payload: { method: 'GET', url: 'https://old.example.invalid', conditions: [{ path: 'a', operator: 'EXISTS', nextNodeId: 'n' }] } },
      ]),
    };
    const { service, prisma } = buildDeps([legacyNode]);
    prisma.apiConnection.findUnique.mockResolvedValue(makeRow({ id: 'conn-1' }));
    prisma.apiConnection.delete.mockResolvedValue(undefined);

    await expect(service.remove('conn-1')).resolves.toBeUndefined();
    expect(prisma.apiConnection.delete).toHaveBeenCalled();
  });
});

describe('ApiConnectionsService — countReferencingNodes 집계 정확성(M-1)', () => {
  it('findOne() — contains 사전 필터를 통과했더라도 실제 v2 참조가 아니면 카운트에서 제외한다(부분 문자열 오탐 배제)', async () => {
    const genuineMatch = {
      id: 'node-1',
      name: '진짜참조노드',
      chatbotId: 'bot-1',
      chatbot: { name: '봇' },
      outputs: JSON.stringify([
        { type: 'API_CONDITION', payload: { version: 2, connectionId: 'conn-1', method: 'GET', path: '/x', pathParams: [], query: [], body: [], responseMappings: [], conditions: [] } },
      ]),
    };
    // "conn-1"이 문자열로는 포함되지만(오탐 유발), 실제로는 다른 필드(TEXT.text)에 등장한다 — 참조가 아니다.
    const falsePositive = {
      id: 'node-2',
      name: '가짜매치노드',
      chatbotId: 'bot-1',
      chatbot: { name: '봇' },
      outputs: JSON.stringify([{ type: 'TEXT', payload: { text: 'connectionId는 conn-1 입니다만 이건 그냥 텍스트예요' } }]),
    };
    // connectionId가 다른(prefix가 같은) 별개 연결 — 정확 일치가 아니므로 제외돼야 한다.
    const differentConnection = {
      id: 'node-3',
      name: '다른연결노드',
      chatbotId: 'bot-1',
      chatbot: { name: '봇' },
      outputs: JSON.stringify([
        { type: 'API_CONDITION', payload: { version: 2, connectionId: 'conn-10', method: 'GET', path: '/x', pathParams: [], query: [], body: [], responseMappings: [], conditions: [] } },
      ]),
    };

    const { service, prisma } = buildDeps([genuineMatch, falsePositive, differentConnection]);
    prisma.apiConnection.findUnique.mockResolvedValue(makeRow({ id: 'conn-1' }));

    const result = await service.findOne('conn-1');

    expect(result.referencingNodeCount).toBe(1);
    // contains 사전 필터가 실제로 적용됐는지(전수 스캔이 아님)도 함께 확인한다.
    expect(prisma.dialogNode.findMany).toHaveBeenCalledWith({ where: { outputs: { contains: 'conn-1' } }, select: { outputs: true } });
  });

  it('list() — 연결마다 반복 쿼리하지 않고 dialogNode.findMany를 1회만 호출해 Map으로 집계한다(N+1 제거)', async () => {
    const nodeForConnA = {
      id: 'node-1',
      name: 'A참조',
      chatbotId: 'bot-1',
      chatbot: { name: '봇' },
      outputs: JSON.stringify([
        { type: 'API_CONDITION', payload: { version: 2, connectionId: 'conn-a', method: 'GET', path: '/x', pathParams: [], query: [], body: [], responseMappings: [], conditions: [] } },
      ]),
    };
    const nodesForConnB = [1, 2].map((i) => ({
      id: `node-b${i}`,
      name: `B참조${i}`,
      chatbotId: 'bot-1',
      chatbot: { name: '봇' },
      outputs: JSON.stringify([
        { type: 'API_CONDITION', payload: { version: 2, connectionId: 'conn-b', method: 'GET', path: '/x', pathParams: [], query: [], body: [], responseMappings: [], conditions: [] } },
      ]),
    }));

    const { service, prisma } = buildDeps([nodeForConnA, ...nodesForConnB]);
    prisma.apiConnection.findMany.mockResolvedValue([makeRow({ id: 'conn-a', name: '연결A', nameNormalized: '연결a' }), makeRow({ id: 'conn-b', name: '연결B', nameNormalized: '연결b' })]);

    const { items } = await service.list();

    expect(prisma.dialogNode.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.dialogNode.findMany).toHaveBeenCalledWith({ where: { outputs: { contains: '"type":"API_CONDITION"' } }, select: { outputs: true } });

    const byId = new Map(items.map((i) => [i.id, i.referencingNodeCount]));
    expect(byId.get('conn-a')).toBe(1);
    expect(byId.get('conn-b')).toBe(2);
  });
});
