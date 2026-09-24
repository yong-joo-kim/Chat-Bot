import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK } from '../common/polling/clock';
import type { Clock } from '../common/polling/clock';
import { PollingLoop } from '../common/polling/polling-loop';
import type { TickSignal } from '../common/polling/polling-loop';
import { HandoffThreadService } from './handoff-thread.service';
import { HandoffSettingsCacheService } from './handoff-settings-cache.service';
import { HandoffSettingsService } from './handoff-settings.service';
import { judgeHandoffExpiry } from './lib/handoff-expiry';

const TICK_INTERVAL_MS = 60_000;
const ACTIVE_ROW_CAP = 500;

/**
 * `PollingLoop`(ADR-0032) 두 번째 소비자(§8.6) — 시간 종료 판정과 원문 파기를 60초마다 수행한다.
 * 조회 시점 판정만으로는 아무도 조회하지 않는 상담의 원문이 무기한 남기 때문이다(P-9 (b)).
 * 모든 인스턴스가 실행한다(선점 불필요 — 전부 멱등 CAS·조건부 갱신).
 *
 * [코드리뷰 2회차 M-1] `HANDOFF_SWEEPER_ENABLED=false`면 자동 기동(부트스트랩 즉시 실행·60초
 * 루프)을 하지 않는다(`DeploySchedulesEngine.enabled()` 선례와 동일한 장치) — 시험 환경 기본값은
 * `jest.isolate-env.js`가 `'false'`로 고정한다(AppModule을 로드하는 모든 통합 시험에 불필요한
 * 백그라운드 타이머·쿼리가 생기는 것을 막는다). `tick()`/`runOnce()`는 계속 public이라 필요한
 * 시험은 타이머 없이 직접 호출해 결정론적으로 검증할 수 있다.
 */
@Injectable()
export class HandoffSweeperService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('HandoffSweeper');
  private readonly loop: PollingLoop;

  constructor(
    private readonly prisma: PrismaService,
    private readonly thread: HandoffThreadService,
    private readonly settingsCache: HandoffSettingsCacheService,
    private readonly settingsService: HandoffSettingsService,
    private readonly config: ConfigService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.loop = new PollingLoop({ name: 'handoff-sweeper', intervalMs: TICK_INTERVAL_MS, onTick: (signal) => this.tick(signal), logger: this.logger });
  }

  private enabled(): boolean {
    return this.config.get<boolean>('HANDOFF_SWEEPER_ENABLED') ?? true;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled()) {
      this.logger.log('HANDOFF_SWEEPER_ENABLED=false — 이 인스턴스에서 정리 루프를 가동하지 않습니다(상담 CRUD는 정상 동작).');
      return;
    }
    await this.loop.runOnce();
    this.loop.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.loop.stop(30_000);
  }

  async runOnce(): Promise<void> {
    await this.loop.runOnce();
  }

  async tick(_signal?: TickSignal): Promise<void> {
    const now = this.clock.now();

    const activeRows = await this.prisma.handoffSession.findMany({
      where: { status: { in: ['CONNECTING', 'CONNECTED'] } },
      orderBy: { startedAt: 'asc' },
      take: ACTIVE_ROW_CAP,
    });

    const chatbotIds = Array.from(new Set(activeRows.map((r) => r.chatbotId)));
    const chatbots = await this.prisma.chatbot.findMany({
      where: { id: { in: chatbotIds } },
      select: { id: true, status: true },
    });
    const channels = await this.prisma.channel.findMany({
      where: { chatbotId: { in: chatbotIds }, type: 'WEB' },
      select: { chatbotId: true, enabled: true },
    });
    const chatbotStatusById = new Map(chatbots.map((c) => [c.id, c.status]));
    const channelOpenById = new Map(channels.map((c) => [c.chatbotId, c.enabled]));

    for (const row of activeRows) {
      const settings = await this.settingsCache.get(row.chatbotId);
      const channelOpen = chatbotStatusById.get(row.chatbotId) === 'ACTIVE' && (channelOpenById.get(row.chatbotId) ?? false);
      const reason = judgeHandoffExpiry(
        {
          status: row.status as 'CONNECTING' | 'CONNECTED',
          startedAt: row.startedAt,
          connectedAt: row.connectedAt,
          lastUserMessageAt: row.lastUserMessageAt,
          lastAgentMessageAt: row.lastAgentMessageAt,
          firstAgentReplyAt: row.firstAgentReplyAt,
        },
        settings,
        channelOpen,
        now,
      );
      if (reason) {
        await this.thread.endHandoff({ handoffSessionId: row.id, chatbotId: row.chatbotId, reason, now, settings });
      }
    }

    await this.thread.purgeExpiredRaw(now);

    for (const chatbotId of chatbotIds) {
      const settings = await this.settingsCache.get(chatbotId);
      if (settings.draining) {
        await this.settingsService.clearDrainingIfIdle(chatbotId);
      }
    }
  }
}
