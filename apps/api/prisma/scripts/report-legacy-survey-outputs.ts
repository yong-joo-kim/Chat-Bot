// [No.27 설문관리] v1 SURVEY 잔존 계측(FR-SV11-6, §3.3) — **읽기 전용**.
// 출력: 챗봇별 "v1 SURVEY 보유 노드 수" · 버전(스냅샷) 중 v1 SURVEY 포함 versionId·versionNo 목록.
// 자유 문자열 키 값은 출력하지 않는다(건수·ID만).
// 이 스크립트는 `apps/api/src` 밖이라 본문 참조 봉인(version-sealing.spec.ts V-7)의 대상이 아니다.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface RawOutput {
  type?: string;
  payload?: { version?: number };
}

function parseOutputs(json: string): RawOutput[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as RawOutput[]) : [];
  } catch {
    return [];
  }
}

function countLegacySurvey(outputs: RawOutput[]): number {
  let legacyCount = 0;
  for (const o of outputs) {
    if (o.type !== 'SURVEY') continue;
    const isV1 = o.payload?.version !== 2;
    if (isV1) legacyCount += 1;
  }
  return legacyCount;
}

async function reportLiveNodes(): Promise<void> {
  const chatbots = await prisma.chatbot.findMany({ select: { id: true, name: true } });
  const nodes = await prisma.dialogNode.findMany({ select: { chatbotId: true, outputs: true } });
  const byChatbot = new Map<string, number>();

  for (const node of nodes) {
    const legacyCount = countLegacySurvey(parseOutputs(node.outputs));
    if (legacyCount === 0) continue;
    byChatbot.set(node.chatbotId, (byChatbot.get(node.chatbotId) ?? 0) + 1);
  }

  if (byChatbot.size === 0) {
    // eslint-disable-next-line no-console
    console.log('현재 노드(DialogNode)에 v1 SURVEY가 없습니다.');
    return;
  }

  // eslint-disable-next-line no-console
  console.log('=== 현재 노드(DialogNode) 기준 v1 SURVEY 보유 현황 ===');
  for (const [chatbotId, count] of byChatbot) {
    const chatbot = chatbots.find((c) => c.id === chatbotId);
    // eslint-disable-next-line no-console
    console.log(`- ${chatbot?.name ?? chatbotId}(${chatbotId}): v1 설문 연결 보유 노드 ${count}건`);
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
      if (countLegacySurvey(node.outputs ?? []) > 0) legacyNodeCount += 1;
    }
    if (legacyNodeCount > 0) {
      const chatbot = chatbots.find((c) => c.id === version.chatbotId);
      hits.push({ chatbotName: chatbot?.name ?? version.chatbotId, versionId: version.id, versionNo: version.versionNo, legacyNodeCount });
    }
  }

  if (hits.length === 0) {
    // eslint-disable-next-line no-console
    console.log('저장된 버전(스냅샷)에 v1 SURVEY를 포함한 버전이 없습니다.');
    return;
  }

  // eslint-disable-next-line no-console
  console.log('=== 버전(스냅샷) 기준 v1 SURVEY 포함 버전 목록 ===');
  for (const hit of hits) {
    // eslint-disable-next-line no-console
    console.log(`- ${hit.chatbotName} v${hit.versionNo}(${hit.versionId}): v1 설문 연결 보유 노드 ${hit.legacyNodeCount}건`);
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
