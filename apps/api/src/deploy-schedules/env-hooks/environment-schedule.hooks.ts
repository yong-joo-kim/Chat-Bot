import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DeployScheduleRepository } from '../engine/deploy-schedule.repository';

/**
 * [신규 No.40] 환경 모드 켜기/끄기의 예약 처리(C-4) — `DeployScheduleRepository`의 새 메서드 2개에
 * 위임만 한다(쓰기 0 — D-1 불변, `deploySchedule` 쓰기 파일은 여전히 2개다). `DeploySchedulesModule`이
 * export하는 유일한 신규 provider.
 */
@Injectable()
export class EnvironmentScheduleHooks {
  constructor(private readonly repository: DeployScheduleRepository) {}

  holdRestoreForEnvModeChange(tx: Prisma.TransactionClient, chatbotId: string, now: Date): Promise<number> {
    return this.repository.holdRestoreForEnvModeChange(tx, chatbotId, now);
  }

  cancelSwitchForEnvDisable(tx: Prisma.TransactionClient, chatbotId: string, actor: { id: string | null; email: string } | null, now: Date): Promise<number> {
    return this.repository.cancelSwitchForEnvDisable(tx, chatbotId, actor, now);
  }
}
