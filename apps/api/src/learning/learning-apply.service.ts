import { Injectable } from '@nestjs/common';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';

export type LearningApplyReason = 'UNANSWERED_RESOLVE' | 'UNANSWERED_BULK_RESOLVE';

export interface LearningApplyResult {
  /** 'IMMEDIATE' = 규칙 매칭 즉시 반영(현재) · 'QUEUED' = 학습 Job 적재(향후 No.16/23). */
  mode: 'IMMEDIATE' | 'QUEUED';
  /** 화면이 "반영 완료" vs "학습 중"을 고르는 근거. 컨트롤러/프런트가 하드코딩하지 않는다(K-4). */
  appliedImmediately: boolean;
  /** 현재는 항상 null. Job 큐 전환 시 `TrainingJob.id`가 담긴다. */
  jobId: string | null;
}

/**
 * ★ 재학습 반영의 마지막 단계 — **이 시스템에서 "학습"에 해당하는 유일한 지점**이다(DD-55, ADR-0018).
 * 현행 매칭은 규칙 기반이라(ADR-0008) 예문 추가 + 번들 캐시 무효화로 반영이 완결된다.
 * No.16(DLE 증강학습)·No.23(경량 분류기 재학습) 착수 시 **이 메서드 본문 1곳**이 `TrainingJob`
 * 적재로 교체되고, 반환값이 `{ mode:'QUEUED', appliedImmediately:false, jobId }`가 된다.
 * 그때 컨트롤러·서비스·프런트의 분기 코드는 수정되지 않는다 — 반환값만 바뀐다.
 *
 * 인계 계약(K-1~K-6, §10.3):
 * K-1. `learning` 모듈에서 `DialogueBundleService.invalidate()`를 호출하는 곳은 이 메서드 1곳뿐이다.
 * K-2. 요청당 정확히 1회 호출한다(단건·일괄 공통).
 * K-3. 호출 위치는 상태 전이 성공 이후, DB 트랜잭션 밖이다.
 * K-4. `appliedImmediately`는 이 메서드의 반환값을 그대로 전달한다(하드코딩 금지).
 * K-5. 실패를 삼키지 않는다 — 무효화 실패는 호출부로 전파해 503으로 응답한다.
 * K-6. `POST /retrain` 같은 수동 트리거 API를 만들지 않는다.
 */
@Injectable()
export class LearningApplyService {
  constructor(private readonly bundleService: DialogueBundleService) {}

  async applyLearning(input: {
    chatbotId: string;
    intentIds: string[];
    reason: LearningApplyReason;
    resolvedCount: number;
  }): Promise<LearningApplyResult> {
    void input.intentIds;
    void input.reason;
    void input.resolvedCount;
    this.bundleService.invalidate(input.chatbotId); // ← 현재 구현의 전부(1줄)
    return { mode: 'IMMEDIATE', appliedImmediately: true, jobId: null };
  }
}
