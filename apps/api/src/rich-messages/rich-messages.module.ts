import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { RichUrlPolicyController } from './rich-url-policy.controller';
import { RichUrlPolicyService } from './rich-url-policy.service';

/**
 * [신규 No.46] 채널별 리치 메시지 — 허용 도메인 목록 관리(§2.2). export는 **0개**다. 노드 저장
 * 검증은 허용 목록을 Prisma로 직접 읽고(1쿼리) `rich-messages/lib`의 순수 함수 파일만 import한다
 * (모듈 순환 없음 — ADR-0043 §7).
 */
@Module({
  imports: [ChatbotsModule],
  controllers: [RichUrlPolicyController],
  providers: [RichUrlPolicyService],
})
export class RichMessagesModule {}
