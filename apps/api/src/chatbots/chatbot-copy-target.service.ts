import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { deriveCopyName } from './lib/copy-name.util';
import { deriveCopySlug, SlugDerivationExhaustedError } from './lib/slug.util';

export interface CopyTargetSource {
  name: string;
  slug: string;
  groupId: string;
}

export interface CopyTargetRequest {
  name?: string;
  slug?: string;
  targetGroupId?: string;
}

export interface ResolvedCopyTarget {
  name: string;
  slug: string;
  groupId: string;
}

/**
 * [신규 No.22 — §9.7] `ChatbotsService.copy()`의 이름·slug·그룹 결정 로직을 **동작 불변**으로
 * 추출한다(FR-TP6-13). 토픽 분리(`topic-split.service.ts`)가 재사용한다 — 기존
 * `POST /chatbots/:id/copy`는 여전히 프로필만 복사한다(호출부 무변경).
 */
@Injectable()
export class ChatbotCopyTargetService {
  constructor(private readonly prisma: PrismaService) {}

  private async slugExists(slug: string, excludeChatbotId?: string): Promise<boolean> {
    const row = await this.prisma.chatbot.findUnique({ where: { slug }, select: { id: true } });
    if (!row) return false;
    return row.id !== excludeChatbotId;
  }

  async resolve(original: CopyTargetSource, dto: CopyTargetRequest): Promise<ResolvedCopyTarget> {
    let groupId = original.groupId;
    if (dto.targetGroupId) {
      // 보관된 그룹은 대상에서 제외한다(404) — ADR-0033 §5(기존 copy() 규칙과 동일).
      const group = await this.prisma.chatbotGroup.findFirst({ where: { id: dto.targetGroupId, archivedAt: null } });
      if (!group) throw new ApiException('NOT_FOUND', 404, '요청하신 대상을 찾을 수 없습니다.');
      groupId = dto.targetGroupId;
    }

    const name = dto.name ?? deriveCopyName(original.name);

    let slug: string;
    if (dto.slug) {
      if (await this.slugExists(dto.slug)) {
        throw new ApiException('DUPLICATE_SLUG', 409, '이미 사용 중인 고유 URL입니다. 다른 값을 입력해 주세요.');
      }
      slug = dto.slug;
    } else {
      try {
        slug = await deriveCopySlug(original.slug, (candidate) => this.slugExists(candidate));
      } catch (e) {
        if (e instanceof SlugDerivationExhaustedError) {
          throw new ApiException('DUPLICATE_SLUG', 409, '이미 사용 중인 고유 URL입니다. 다른 값을 입력해 주세요.');
        }
        throw e;
      }
    }

    return { name, slug, groupId };
  }
}
