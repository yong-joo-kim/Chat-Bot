import type { ConfigService } from '@nestjs/config';
import type { WorkflowEmission } from '@chat-bot/dialogue-engine';
import { WorkflowTriggerService } from './workflow-trigger.service';
import type { EnqueueTargetInfo } from '../catalog/workflow-catalog.service';
import type { WorkflowRunEnqueueWriter } from './workflow-run-enqueue.writer';

/**
 * `WorkflowTriggerService` 단위 시험(mock Prisma/catalog/writer) — 코드 리뷰 R1 시험 공백 (f).
 * HTTP·발송 계약은 `integration/workflow-automation*.integration.spec.ts`가, 순수 판정(세션 상한·
 * 필드 가공·봉투 조립·dedupeKey)은 `triggers/lib/*.spec.ts`가 다룬다. 이 파일은
 * `enqueueNodeEmissions()`의 적재 분기(§6.1 step 3)만 결정적으로 검증한다.
 */
describe('WorkflowTriggerService — enqueueNodeEmissions 적재 분기', () => {
  function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
    return { get: (key: string) => overrides[key] } as unknown as ConfigService;
  }

  function makePrisma(countValue = 0): import('../../prisma/prisma.service').PrismaService {
    return {
      workflowRun: { count: jest.fn().mockResolvedValue(countValue) },
    } as unknown as import('../../prisma/prisma.service').PrismaService;
  }

  function makeCatalog(targets: Map<string, EnqueueTargetInfo>): import('../catalog/workflow-catalog.service').WorkflowCatalogService {
    return {
      findForEnqueue: jest.fn().mockResolvedValue(targets),
    } as unknown as import('../catalog/workflow-catalog.service').WorkflowCatalogService;
  }

  function makeWriter(): WorkflowRunEnqueueWriter & { enqueue: jest.Mock } {
    return { enqueue: jest.fn().mockResolvedValue({ created: true, id: 'x' }) } as unknown as WorkflowRunEnqueueWriter & { enqueue: jest.Mock };
  }

  function makeEmission(overrides: Partial<WorkflowEmission> = {}): WorkflowEmission {
    return {
      nodeId: 'node-1',
      outputIndex: 0,
      targetId: 'target-1',
      actionKey: 'test.action',
      fields: [{ name: 'a', value: '값', source: 'CONST' }],
      ...overrides,
    };
  }

  const ctx = { chatbot: { id: 'chatbot-1', name: '테스트봇' }, sessionId: 'session-1', messageId: 'message-1', channel: 'WEB' as const, servedVersionId: null, now: new Date() };

  it('FEATURE_DISABLED — WORKFLOW_ENABLED=false면 대상 조회 없이 전부 SKIPPED(FEATURE_DISABLED)로 적재한다', async () => {
    const writer = makeWriter();
    const catalog = makeCatalog(new Map());
    const service = new WorkflowTriggerService(makeConfig({ WORKFLOW_ENABLED: false }), makePrisma(), catalog, writer);

    await service.enqueueNodeEmissions([makeEmission()], ctx);

    expect(catalog.findForEnqueue).not.toHaveBeenCalled();
    expect(writer.enqueue).toHaveBeenCalledTimes(1);
    expect(writer.enqueue.mock.calls[0][0]).toMatchObject({ status: 'SKIPPED', statusReason: 'FEATURE_DISABLED' });
  });

  it('TARGET_UNAVAILABLE — 대상이 없으면 SKIPPED(TARGET_UNAVAILABLE)로 적재한다', async () => {
    const writer = makeWriter();
    const catalog = makeCatalog(new Map());
    const service = new WorkflowTriggerService(makeConfig({ WORKFLOW_ENABLED: true }), makePrisma(), catalog, writer);

    await service.enqueueNodeEmissions([makeEmission()], ctx);

    expect(writer.enqueue.mock.calls[0][0]).toMatchObject({ status: 'SKIPPED', statusReason: 'TARGET_UNAVAILABLE' });
  });

  it('TARGET_UNAVAILABLE — 대상이 꺼져 있으면(enabled=false) SKIPPED(TARGET_UNAVAILABLE)로 적재한다', async () => {
    const writer = makeWriter();
    const targets = new Map<string, EnqueueTargetInfo>([['target-1', { id: 'target-1', name: '대상', enabled: false, paused: false, allowRawPersonalData: false, secretsOk: true }]]);
    const catalog = makeCatalog(targets);
    const service = new WorkflowTriggerService(makeConfig({ WORKFLOW_ENABLED: true }), makePrisma(), catalog, writer);

    await service.enqueueNodeEmissions([makeEmission()], ctx);

    expect(writer.enqueue.mock.calls[0][0]).toMatchObject({ status: 'SKIPPED', statusReason: 'TARGET_UNAVAILABLE' });
  });

  it('TARGET_UNAVAILABLE — 대상 비밀이 없으면(secretsOk=false) SKIPPED(TARGET_UNAVAILABLE)로 적재한다', async () => {
    const writer = makeWriter();
    const targets = new Map<string, EnqueueTargetInfo>([['target-1', { id: 'target-1', name: '대상', enabled: true, paused: false, allowRawPersonalData: false, secretsOk: false }]]);
    const catalog = makeCatalog(targets);
    const service = new WorkflowTriggerService(makeConfig({ WORKFLOW_ENABLED: true }), makePrisma(), catalog, writer);

    await service.enqueueNodeEmissions([makeEmission()], ctx);

    expect(writer.enqueue.mock.calls[0][0]).toMatchObject({ status: 'SKIPPED', statusReason: 'TARGET_UNAVAILABLE' });
  });

  it('BINDING_MISSING — SLOT 바인딩 불충족이면 필드 이름 없이 SKIPPED(BINDING_MISSING)로 적재한다', async () => {
    const writer = makeWriter();
    const targets = new Map<string, EnqueueTargetInfo>([['target-1', { id: 'target-1', name: '대상', enabled: true, paused: false, allowRawPersonalData: false, secretsOk: true }]]);
    const catalog = makeCatalog(targets);
    const service = new WorkflowTriggerService(makeConfig({ WORKFLOW_ENABLED: true }), makePrisma(), catalog, writer);

    await service.enqueueNodeEmissions([makeEmission({ bindingMissing: true, fields: [] })], ctx);

    expect(writer.enqueue.mock.calls[0][0]).toMatchObject({ status: 'SKIPPED', statusReason: 'BINDING_MISSING', fieldNames: [] });
  });

  it('RATE_LIMITED — 세션 상한(§6.6)을 넘으면 SKIPPED(RATE_LIMITED)로 적재한다', async () => {
    const writer = makeWriter();
    const targets = new Map<string, EnqueueTargetInfo>([['target-1', { id: 'target-1', name: '대상', enabled: true, paused: false, allowRawPersonalData: false, secretsOk: true }]]);
    const catalog = makeCatalog(targets);
    const service = new WorkflowTriggerService(makeConfig({ WORKFLOW_ENABLED: true, WORKFLOW_SESSION_LIMIT: 3 }), makePrisma(3), catalog, writer);

    await service.enqueueNodeEmissions([makeEmission()], ctx);

    expect(writer.enqueue.mock.calls[0][0]).toMatchObject({ status: 'SKIPPED', statusReason: 'RATE_LIMITED' });
  });

  it('PAYLOAD_TOO_LARGE — 봉투 바이트가 상한을 넘으면 SKIPPED(PAYLOAD_TOO_LARGE)로 적재한다', async () => {
    const writer = makeWriter();
    const targets = new Map<string, EnqueueTargetInfo>([['target-1', { id: 'target-1', name: '대상', enabled: true, paused: false, allowRawPersonalData: false, secretsOk: true }]]);
    const catalog = makeCatalog(targets);
    const service = new WorkflowTriggerService(makeConfig({ WORKFLOW_ENABLED: true, WORKFLOW_PAYLOAD_MAX_BYTES: 10 }), makePrisma(0), catalog, writer);

    await service.enqueueNodeEmissions([makeEmission()], ctx);

    expect(writer.enqueue.mock.calls[0][0]).toMatchObject({ status: 'SKIPPED', statusReason: 'PAYLOAD_TOO_LARGE' });
  });

  it('HELD — 대상이 정지 중이면 HELD(TARGET)로 적재하고 payloadJson을 싣는다', async () => {
    const writer = makeWriter();
    const targets = new Map<string, EnqueueTargetInfo>([['target-1', { id: 'target-1', name: '대상', enabled: true, paused: true, allowRawPersonalData: false, secretsOk: true }]]);
    const catalog = makeCatalog(targets);
    const service = new WorkflowTriggerService(makeConfig({ WORKFLOW_ENABLED: true }), makePrisma(0), catalog, writer);

    await service.enqueueNodeEmissions([makeEmission()], ctx);

    const call = writer.enqueue.mock.calls[0][0];
    expect(call).toMatchObject({ status: 'HELD', holdReason: 'TARGET' });
    expect(call.payloadJson).toEqual(expect.any(String));
  });

  it('PENDING — 정상 방출은 PENDING으로 적재하고 payloadJson을 싣는다', async () => {
    const writer = makeWriter();
    const targets = new Map<string, EnqueueTargetInfo>([['target-1', { id: 'target-1', name: '대상', enabled: true, paused: false, allowRawPersonalData: false, secretsOk: true }]]);
    const catalog = makeCatalog(targets);
    const service = new WorkflowTriggerService(makeConfig({ WORKFLOW_ENABLED: true }), makePrisma(0), catalog, writer);

    await service.enqueueNodeEmissions([makeEmission()], ctx);

    const call = writer.enqueue.mock.calls[0][0];
    expect(call).toMatchObject({ status: 'PENDING', statusReason: null });
    expect(call.payloadJson).toEqual(expect.any(String));
    const parsed = JSON.parse(call.payloadJson);
    expect(parsed.chatbot).toEqual({ id: 'chatbot-1', name: '테스트봇' });
  });

  it('방출 상한(10건) 초과분은 경고만 남기고 무시한다', async () => {
    const writer = makeWriter();
    const targets = new Map<string, EnqueueTargetInfo>([['target-1', { id: 'target-1', name: '대상', enabled: true, paused: false, allowRawPersonalData: false, secretsOk: true }]]);
    const catalog = makeCatalog(targets);
    const service = new WorkflowTriggerService(makeConfig({ WORKFLOW_ENABLED: true }), makePrisma(0), catalog, writer);

    const emissions = Array.from({ length: 12 }, (_, i) => makeEmission({ outputIndex: i }));
    await service.enqueueNodeEmissions(emissions, ctx);

    expect(writer.enqueue).toHaveBeenCalledTimes(10);
  });

  it('내부 예외는 던지지 않고 enqueueFailures24h를 증가시킨다(봇 응답 불변 원칙)', async () => {
    const writer = { enqueue: jest.fn().mockRejectedValue(new Error('boom')) } as unknown as WorkflowRunEnqueueWriter & { enqueue: jest.Mock };
    const targets = new Map<string, EnqueueTargetInfo>([['target-1', { id: 'target-1', name: '대상', enabled: true, paused: false, allowRawPersonalData: false, secretsOk: true }]]);
    const catalog = makeCatalog(targets);
    const service = new WorkflowTriggerService(makeConfig({ WORKFLOW_ENABLED: true }), makePrisma(0), catalog, writer);

    await expect(service.enqueueNodeEmissions([makeEmission()], ctx)).resolves.toBeUndefined();
    expect(service.enqueueFailures24h()).toBe(1);
  });
});
