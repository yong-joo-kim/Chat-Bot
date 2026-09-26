import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { InboxSignal, InboxSignalSink } from '../../common/inbox/inbox-signal.port';
import { InboxParticipationCache } from './inbox-participation.cache';
import { InboxStore } from './inbox.store';
import { evaluateSessionAlert } from '../../handoff/lib/session-alert';
import { computeSessionRef } from '../../handoff/lib/session-ref';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * [신규 No.42] `INBOX_SIGNAL_SINK` 구현(§8.1) — `signal()`은 동기 반환·예외 없음. 내부 처리는
 * 비동기(fire-and-forget)이며 실패는 경고 로그만 남긴다(원천 응답에 영향 0 — NFR-OCR1).
 * `drainForTest()`는 운영 코드가 호출하지 않는다(O-13) — 통합 시험이 적재 완료를 결정적으로 기다린다.
 */
@Injectable()
export class InboxSignalService implements InboxSignalSink {
  private readonly logger = new Logger('InboxSignalService');
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: ConfigService,
    private readonly participation: InboxParticipationCache,
    private readonly store: InboxStore,
    private readonly prisma: PrismaService,
  ) {}

  private enabled(): boolean {
    return this.config.get<boolean>('OMNI_INBOX_ENABLED') ?? true;
  }

  signal(s: InboxSignal): void {
    if (!this.enabled()) return;
    const task = this.process(s).catch((e) => {
      this.logger.warn(`신호 처리 실패: signal=${s.signal} chatbotId=${s.chatbotId} error=${e instanceof Error ? e.constructor.name : 'unknown'}`);
    });
    this.pending = this.pending.then(() => task).catch(() => undefined);
  }

  async drainForTest(): Promise<void> {
    await this.pending;
  }

  private async process(s: InboxSignal): Promise<void> {
    const participating = await this.participation.isParticipating(s.chatbotId);
    if (!participating) return;

    if (s.signal === 'HANDOFF_OPENED') {
      await this.store.ensureThreadForSignal({
        chatbotId: s.chatbotId,
        sessionId: s.sessionId,
        sessionRef: s.sessionRef,
        channelType: s.channelType,
        openReason: 'HANDOFF',
        activityKind: 'HANDOFF',
        now: s.occurredAt,
      });
      return;
    }

    // TURN_RECORDED — 경고 단계 판정(openOnWarning 참여 챗봇의 미응답 턴만).
    if (s.blockedByFilter || s.surveyTurn || s.handoffTurn || s.isAnswered) return;
    const setting = await this.participation.get(s.chatbotId);
    if (!setting?.openOnWarning) return;

    const recentLogs = await this.prisma.conversationLog.findMany({
      where: { chatbotId: s.chatbotId, sessionId: s.sessionId },
      orderBy: { createdAt: 'asc' },
      take: 30,
      select: { isAnswered: true, blockedByFilter: true, surveyTurn: true, handoffTurn: true, apiNotice: true },
    });
    // [코드리뷰 R1 반영 M-1] 임계값 = 챗봇 상담 설정(ChatbotHandoffSetting) · 설정 행이 없으면 2/3(§8.1).
    const handoffSetting = await this.prisma.chatbotHandoffSetting.findUnique({
      where: { chatbotId: s.chatbotId },
      select: { cautionThreshold: true, warningThreshold: true },
    });
    const thresholds = { caution: handoffSetting?.cautionThreshold ?? 2, warning: handoffSetting?.warningThreshold ?? 3 };
    const result = evaluateSessionAlert(recentLogs, thresholds);
    if (result.alertLevel !== 'WARNING') return;

    // [코드리뷰 R1 부수 발견 — I-n] 클레임 확인은 WARNING 판정 "뒤"에만 한다. 판정 앞에서
    // 확인하면(원래 순서) 임계값 미달인 첫 미응답 턴에서 세션당 1회 표식을 미리 써버려, 정작
    // WARNING에 도달한 뒤 턴에서는 이미 "사용됨" 취급되어 영원히 열리지 않는다(커스텀 임계값이
    // 아니어도 기본값에서도 재현되는 버그 — §27 기록).
    // [코드리뷰 R2 반영 H-2] 클레임(CAS 또는 생성)과 스레드 열기를 `InboxStore.openWarningThread()`
    // 한 트랜잭션으로 처리한다 — 사전 `CustomerLink`가 없는 순수 익명 세션도 열려야 한다(§27 I-13).
    await this.store.openWarningThread({
      chatbotId: s.chatbotId,
      sessionId: s.sessionId,
      sessionRef: computeSessionRef(s.chatbotId, s.sessionId),
      channelType: s.channelType,
      now: s.occurredAt,
    });
  }
}
