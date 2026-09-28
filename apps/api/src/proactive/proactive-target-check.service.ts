import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import { VersionBundleService, ServingVersionUnavailableError } from '../environment/serving/version-bundle.service';
import { bundleSourceOf } from '../environment/serving/lib/bundle-source';

export interface ServingNodeCheckResult {
  /** "지금 서비스 중인 번들"에서 켜진 상태로 확인된 노드 id 집합. */
  nodeIds: Set<string>;
  /** 버전 읽기 실패로 판정 불가(`SERVING_UNVERIFIABLE`). */
  unverifiable: boolean;
}

/**
 * [신규 No.35] 관리 화면용 "서비스 중 번들" 노드 켜짐 조회(§9.4) — 환경 모드면 운영 포인터 버전,
 * 아니면 초안(비활성 토픽 제외). 공개 조회(`ProactivePublicService`)와 달리 이 서비스는 관리 API
 * 전용이며 `DialogueBundleService`·`VersionBundleService`를 직접 주입받는다(PA-9은 `proactive/public/**`
 * 에만 적용 — 이 파일은 그 경계 밖).
 */
@Injectable()
export class ProactiveTargetCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bundleService: DialogueBundleService,
    private readonly versionBundles: VersionBundleService,
  ) {}

  async enabledNodeIds(chatbotId: string): Promise<ServingNodeCheckResult> {
    const chatbot = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { prodVersionId: true } });
    const source = bundleSourceOf({ prodVersionId: chatbot?.prodVersionId ?? null });

    try {
      if (source.kind === 'DRAFT') {
        const { bundle } = await this.bundleService.getCached(chatbotId);
        return { nodeIds: new Set(bundle.dialogNodes.filter((n) => n.enabled).map((n) => n.id)), unverifiable: false };
      }
      const serving = await this.versionBundles.get(chatbotId, source.versionId, { topics: 'ACTIVE_ONLY' });
      return { nodeIds: new Set(serving.bundle.dialogNodes.filter((n) => n.enabled).map((n) => n.id)), unverifiable: false };
    } catch (e) {
      if (e instanceof ServingVersionUnavailableError) return { nodeIds: new Set(), unverifiable: true };
      throw e;
    }
  }
}
