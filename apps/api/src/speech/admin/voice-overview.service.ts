import { Injectable } from '@nestjs/common';
import type { VoiceOverviewResponse, VoiceStatsQuery, VoiceStatsResponse } from '@chat-bot/shared-types';
import { SPEECH_LIMITS } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatbotScopeService } from '../../chatbots/chatbot-scope.service';
import { ApiException } from '../../common/api.exception';
import { SpeechAvailabilityService } from '../core/speech-availability.service';
import { aggregateVoiceStats, resolveVoiceStatsRange } from '../lib/stats-range';
import { VoiceSettingsService } from './voice-settings.service';

/**
 * [신규 No.32] 음성 설정 조회(행 없음 = 기본값) · 서버 상태 · 일별 인식 숫자 — **읽기 전용**(voice-ai-설계.md §10.1).
 * 서버 상태에는 모델 이름·장치·주소를 싣지 않는다(운영 정보는 ml-worker `/speech/health`와 운영 문서).
 */
@Injectable()
export class VoiceOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly settings: VoiceSettingsService,
    private readonly availability: SpeechAvailabilityService,
  ) {}

  async getOverview(chatbotId: string): Promise<VoiceOverviewResponse> {
    await this.scope.assertReadable(chatbotId);
    const chatbot = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { status: true } });
    if (!chatbot) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');
    const channel = await this.prisma.channel.findUnique({ where: { chatbotId_type: { chatbotId, type: 'WEB' } }, select: { enabled: true } });
    const [settings, server] = await Promise.all([this.settings.getView(chatbotId), this.availability.getStatus()]);
    return {
      settings,
      server,
      context: { webChannelEnabled: channel?.enabled ?? false, chatbotStatus: chatbot.status },
      limits: { nodeTonesMax: SPEECH_LIMITS.nodeTonesMax },
    };
  }

  /** `GET /chatbots/:chatbotId/voice/stats?from=&to=` — 원천 = `SpeechDailyStat`만(대화 로그·통계 대화 수 불변). */
  async getStats(chatbotId: string, query: VoiceStatsQuery): Promise<VoiceStatsResponse> {
    await this.scope.assertReadable(chatbotId);
    const { from, to } = resolveVoiceStatsRange(query.from, query.to, new Date());
    const rows = await this.prisma.speechDailyStat.findMany({ where: { chatbotId, dayBucket: { gte: from, lte: to } } });
    return { from, to, ...aggregateVoiceStats(rows, from, to) };
  }
}
