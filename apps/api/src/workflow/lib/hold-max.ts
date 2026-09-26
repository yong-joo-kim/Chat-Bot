import { ConfigService } from '@nestjs/config';

/**
 * [코드 리뷰 R1 H-2] 보류 최대 시간(§7.6·§7.2 step 7) 단일 소스. 발송 루프의 정리 단계
 * (`WorkflowDispatchJob.runMaintenance`)와 대상·구독 수동 재개(`WorkflowTargetsService.resume`·
 * `WorkflowSubscriptionsService.resume`)가 전부 이 헬퍼로 `WORKFLOW_HOLD_MAX_HOURS`(기본 24 —
 * `env.validation.ts` 1~168 제한)를 읽는다. 하드코딩된 `24 * 3_600_000`을 여기 한 곳으로 모은다.
 */
export function workflowHoldMaxMs(config: ConfigService): number {
  return (config.get<number>('WORKFLOW_HOLD_MAX_HOURS') ?? 24) * 3_600_000;
}
