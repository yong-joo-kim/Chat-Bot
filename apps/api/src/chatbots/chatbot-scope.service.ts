import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';

const NOT_FOUND_MESSAGE = '요청하신 챗봇을 찾을 수 없습니다.';

/**
 * 대화 설계(No.5~9) 6개 모듈이 공유하는 챗봇 스코프 검증 단일 진입점(FR-0-9, FR-0-11).
 * 미존재 → 404(교차 챗봇 접근도 동일하게 404 — NFR-S10, 존재 노출 금지).
 * `ARCHIVED` 챗봇의 쓰기 → 409 `CHATBOT_ARCHIVED`. 조회는 허용한다.
 */
@Injectable()
export class ChatbotScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** [신규 No.40] 반환형 확장 — `select`에 `prodVersionId` 1컬럼 추가(쿼리 수 불변). 기존 호출부는
   * 반환값을 무시하므로 영향이 없다(§7.1). */
  async assertReadable(chatbotId: string): Promise<{ prodVersionId: string | null }> {
    const row = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { id: true, prodVersionId: true } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return { prodVersionId: row.prodVersionId };
  }

  async assertWritable(chatbotId: string): Promise<{ prodVersionId: string | null }> {
    const row = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { status: true, prodVersionId: true } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    if (row.status === 'ARCHIVED') {
      throw new ApiException('CHATBOT_ARCHIVED', 409, '보관된 챗봇은 수정할 수 없습니다. 초안으로 되돌린 뒤 수정해 주세요.');
    }
    return { prodVersionId: row.prodVersionId };
  }
}
