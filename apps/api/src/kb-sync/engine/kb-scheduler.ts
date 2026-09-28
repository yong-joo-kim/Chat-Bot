import { Injectable, Logger } from '@nestjs/common';
import { KbRunStore } from '../core/kb-run.store';
import { KbSourcesService } from '../kb-sources.service';
import { computeNextRunAt } from '../lib/schedule-next';
import { kbErrorCode, kbLogLine } from '../lib/kb-log-line';

/**
 * [신규 No.43] 실행 시각이 된 소스를 선점해 실행을 만든다(§9.2). 소스당 동시 실행 1은 `KbSource.
 * activeRunId` CAS가 DB 수준에서 보장한다(쓰기는 `KbSourcesService`에만 있다 — KB-9).
 */
@Injectable()
export class KbScheduler {
  private readonly logger = new Logger('KbScheduler');

  constructor(
    private readonly store: KbRunStore,
    private readonly sourcesService: KbSourcesService,
  ) {}

  async scheduleDueSources(now: Date, limit: number): Promise<string[]> {
    // [pass 5 · RG-5 · NFR-KBR2] 자가 치유 — 종단 상태(또는 부재) 실행을 가리키는 `activeRunId`를 먼저 풀어야 그 소스가 이번 tick에
    // 예약 대상이 된다. 실패해도 예약 자체는 막지 않는다(다음 tick에 다시 시도).
    try {
      await this.sourcesService.healOrphanedActiveRuns();
    } catch (e) {
      this.logger.error(kbLogLine({ host: '-', path: 'heal-orphaned-runs', code: kbErrorCode(e) }));
    }
    const due = await this.store.findDueSources(now, limit);
    const createdRunIds: string[] = [];
    for (const source of due) {
      // [pass 6 · Low-4] 소스 단위로 격리한다 — 한 소스의 예약 처리(허용 호스트 조회·실행 생성)가 예외를 던져도 나머지 소스의 예약과 tick 전체가 멈추지 않는다.
      try {
        const schedule = safeParseSchedule(source.scheduleKind, source.scheduleTime, source.scheduleWeekday);
        const nextRunAt = computeNextRunAt(schedule, now);
        // [pass 8 · PM 결정 2026-09-28] 거버넌스 ON인데 저장된 값이 규칙에 걸리는 소스(모드를 켜기 전에 마스킹을 끄고 저장한 소스 등)는 이번 예약을 건너뛰고 다음 예약 시각으로 넘긴다 — 실행을 만들지 않고,
        // 같은 사유의 로그·감사가 tick마다 쌓이지 않으며(예약 시각당 1건), 이 소스가 tick당 후보 상한을 차지해 다른 소스의 예약을 밀어내지도 않는다. 호스트 겹침 대기보다 먼저 본다(기다릴 이유가 없다).
        const violation = this.sourcesService.governanceViolationOf(source);
        if (violation) {
          if (await this.sourcesService.skipScheduledRunForGovernance(source, nextRunAt, violation)) this.logger.warn(kbLogLine({ host: '-', path: `source/${source.id}`, code: violation }));
          continue;
        }

        // [항목 6 · K-5 · §6.8] 호스트가 겹치는 소스는 이번 tick에 새로 시작하지 않는다 — nextRunAt을
        // 건드리지 않아(claim 자체를 시도하지 않음) 다음 tick에 다시 후보가 된다. (같은 tick에 함께 예약돼 QUEUED가 된 겹침 소스는
        // 크롤 시작 게이트(`claimCrawlLease`)가 한 곳에서 걸러 낸다 — pass 6 · RG-18.)
        const activeHosts = await this.store.findActiveCrawlHosts(source.id);
        if (activeHosts.size > 0) {
          const ownHosts = safeArray(source.allowedHosts);
          if (ownHosts.some((h) => activeHosts.has(h))) continue;
        }

        const approved = source.approvedConfigVersion === source.configVersion && !source.reviewRequiredReason;
        // 소스 선점(CAS)과 실행 행 생성은 한 트랜잭션이다(§9.2) — 선점만 되고 실행 행이 없는 상태가 남지 않는다.
        const run = await this.sourcesService.claimAndCreateRun({
          sourceId: source.id,
          sourceName: source.name,
          kind: approved ? 'SYNC' : 'PREVIEW',
          trigger: 'SCHEDULED',
          configVersion: source.configVersion,
          nextRunAt,
        });
        if (!run) continue;
        createdRunIds.push(run.id);
      } catch (e) {
        // 오류 원문은 남기지 않는다(KB-15) — 소스 id와 클래스명 코드만.
        this.logger.error(kbLogLine({ host: '-', path: `source/${source.id}`, code: kbErrorCode(e) }));
      }
    }
    return createdRunIds;
  }
}

function safeArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeParseSchedule(kind: string, time: string | null, weekday: number | null) {
  if (kind === 'DAILY' && time) return { kind: 'DAILY' as const, time };
  if (kind === 'WEEKLY' && time && weekday !== null) return { kind: 'WEEKLY' as const, time, weekday };
  return { kind: 'MANUAL' as const };
}
