import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TargetRef {
  kind: 'INTENT' | 'FAQ' | 'NODE';
  id: string;
}

/**
 * TC/실행 결과 화면에 필요한 "ID → 이름" 조회 시점 해석(FR-V1-4) — 저장하지 않는다. 이름 변경은
 * 다음 조회부터 자동으로 반영되고, 대상 삭제는 이름이 사라지는 것으로 드러난다(UNRESOLVED와 대칭).
 * `IntentsService`/`FaqsService`/`DialogNodesService`를 주입하지 않고 Prisma로만 읽는다
 * (`ClassifierPredictService`가 `IntentsService`를 주입하지 않는 선례와 동일 — §2.2 봉인).
 */
@Injectable()
export class TargetNameResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveNames(chatbotId: string, refs: readonly TargetRef[]): Promise<Map<string, string>> {
    const intentIds = [...new Set(refs.filter((r) => r.kind === 'INTENT').map((r) => r.id))];
    const faqIds = [...new Set(refs.filter((r) => r.kind === 'FAQ').map((r) => r.id))];
    const nodeIds = [...new Set(refs.filter((r) => r.kind === 'NODE').map((r) => r.id))];

    const [intents, faqs, nodes] = await Promise.all([
      intentIds.length > 0 ? this.prisma.intent.findMany({ where: { chatbotId, id: { in: intentIds } }, select: { id: true, name: true } }) : [],
      faqIds.length > 0 ? this.prisma.faqEntry.findMany({ where: { chatbotId, id: { in: faqIds } }, select: { id: true, question: true } }) : [],
      nodeIds.length > 0 ? this.prisma.dialogNode.findMany({ where: { chatbotId, id: { in: nodeIds } }, select: { id: true, name: true } }) : [],
    ]);

    const map = new Map<string, string>();
    for (const i of intents) map.set(i.id, i.name);
    for (const f of faqs) map.set(f.id, f.question);
    for (const n of nodes) map.set(n.id, n.name);
    return map;
  }
}
