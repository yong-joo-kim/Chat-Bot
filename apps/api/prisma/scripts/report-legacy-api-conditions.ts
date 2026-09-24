// [No.26 레거시 API 연동] v1 API_CONDITION 잔존 계측(FR-L9-4, §3.3) — **읽기 전용**.
// 출력: 챗봇별 "v1 API 조건 보유 노드 수" · "헤더 보유 노드 수" · 버전(스냅샷) 중 v1 포함
// versionId·versionNo 목록. URL·헤더 키·값은 출력하지 않는다(건수·ID만).
// 이 스크립트는 `apps/api/src` 밖이라 본문 참조 봉인(version-sealing.spec.ts:233 V-7)의 대상이 아니다.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface RawOutput {
  type?: string;
  payload?: { version?: number; headers?: Record<string, unknown> };
}

function parseOutputs(json: string): RawOutput[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as RawOutput[]) : [];
  } catch {
    return [];
  }
}

function countLegacy(outputs: RawOutput[]): { legacyCount: number; headerCount: number } {
  let legacyCount = 0;
  let headerCount = 0;
  for (const o of outputs) {
    if (o.type !== 'API_CONDITION') continue;
    const isV1 = o.payload?.version !== 2;
    if (!isV1) continue;
    legacyCount += 1;
    if (o.payload?.headers && Object.keys(o.payload.headers).length > 0) headerCount += 1;
  }
  return { legacyCount, headerCount };
}

async function reportLiveNodes(): Promise<void> {
  const chatbots = await prisma.chatbot.findMany({ select: { id: true, name: true } });
  const nodes = await prisma.dialogNode.findMany({ select: { chatbotId: true, outputs: true } });
  const byChatbot = new Map<string, { legacyNodeCount: number; headerNodeCount: number }>();

  for (const node of nodes) {
    const { legacyCount, headerCount } = countLegacy(parseOutputs(node.outputs));
    if (legacyCount === 0) continue;
    const entry = byChatbot.get(node.chatbotId) ?? { legacyNodeCount: 0, headerNodeCount: 0 };
    entry.legacyNodeCount += 1;
    if (headerCount > 0) entry.headerNodeCount += 1;
    byChatbot.set(node.chatbotId, entry);
  }

  if (byChatbot.size === 0) {
    // eslint-disable-next-line no-console
    console.log('현재 노드(DialogNode)에 v1 API_CONDITION이 없습니다.');
    return;
  }

  // eslint-disable-next-line no-console
  console.log('=== 현재 노드(DialogNode) 기준 v1 API_CONDITION 보유 현황 ===');
  for (const [chatbotId, entry] of byChatbot) {
    const chatbot = chatbots.find((c) => c.id === chatbotId);
    // eslint-disable-next-line no-console
    console.log(
      `- ${chatbot?.name ?? chatbotId}(${chatbotId}): v1 조건 보유 노드 ${entry.legacyNodeCount}건, 헤더 보유 노드 ${entry.headerNodeCount}건`,
    );
  }
}

interface SnapshotAssetsShape {
  assets?: { dialogNodes?: Array<{ outputs?: RawOutput[] }> };
}

async function reportSnapshots(): Promise<void> {
  const versions = await prisma.chatbotVersion.findMany({ select: { id: true, versionNo: true, chatbotId: true } });
  const chatbots = await prisma.chatbot.findMany({ select: { id: true, name: true } });
  const hits: Array<{ chatbotName: string; versionId: string; versionNo: number; legacyNodeCount: number }> = [];

  for (const version of versions) {
    const payloadRow = await prisma.chatbotVersionPayload.findUnique({ where: { versionId: version.id }, select: { payload: true } });
    if (!payloadRow) continue;
    let envelope: SnapshotAssetsShape;
    try {
      envelope = JSON.parse(payloadRow.payload) as SnapshotAssetsShape;
    } catch {
      continue;
    }
    const nodes = envelope.assets?.dialogNodes ?? [];
    let legacyNodeCount = 0;
    for (const node of nodes) {
      const { legacyCount } = countLegacy(node.outputs ?? []);
      if (legacyCount > 0) legacyNodeCount += 1;
    }
    if (legacyNodeCount > 0) {
      const chatbot = chatbots.find((c) => c.id === version.chatbotId);
      hits.push({ chatbotName: chatbot?.name ?? version.chatbotId, versionId: version.id, versionNo: version.versionNo, legacyNodeCount });
    }
  }

  if (hits.length === 0) {
    // eslint-disable-next-line no-console
    console.log('저장된 버전(스냅샷)에 v1 API_CONDITION을 포함한 버전이 없습니다.');
    return;
  }

  // eslint-disable-next-line no-console
  console.log('=== 버전(스냅샷) 기준 v1 API_CONDITION 포함 버전 목록 ===');
  for (const hit of hits) {
    // eslint-disable-next-line no-console
    console.log(`- ${hit.chatbotName} v${hit.versionNo}(${hit.versionId}): v1 조건 보유 노드 ${hit.legacyNodeCount}건`);
  }
}

async function main(): Promise<void> {
  await reportLiveNodes();
  await reportSnapshots();
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
