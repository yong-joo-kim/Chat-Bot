import { Injectable } from '@nestjs/common';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';

/**
 * [2026-09-22 학습 고도화] `'AUGMENTATION_ACCEPT'`(No.16 증강 승인) · `'UNANSWERED_DECOMPOSED_RESOLVE'`
 * (No.23 요소분해 통합 반영) 2종 추가 — **타입 확장만**이며 아래 메서드의 본문·반환값은 바뀌지 않는다
 * (ADR-0018 보론, FR-L2-33/34). 이 그룹이 추가하는 학습 연산(증강 생성·분류기 학습)은 대화 반영
 * 경로에 있지 않다 — 반영은 여전히 승인/요소분해 요청 핸들러 안에서 동기·즉시로 일어난다.
 */
export type LearningApplyReason =
  | 'UNANSWERED_RESOLVE'
  | 'UNANSWERED_BULK_RESOLVE'
  | 'AUGMENTATION_ACCEPT'
  | 'UNANSWERED_DECOMPOSED_RESOLVE';

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
 *
 * [2026-09-22 정정, ADR-0018 보론] 이전 예고("No.16·No.23 착수 시 이 메서드 본문이 `TrainingJob`
 * 적재로 교체된다")는 **실제로 착수해 보니 성립하지 않았다** — No.16(증강)·No.23(분류기)이 추가하는
 * 학습 연산은 대화 반영 경로에 있지 않다. 증강은 "예문 편입 → 기존 즉시 반영"이고, 분류기는
 * "대화에 관여하지 않는 추천 제안기"다(ADR-0027 §2). 교체 조건은 "학습 착수"가 아니라 **"대화 반영이
 * 즉시가 아니게 되는 시점"**(예: 임베딩/분류기 파인튜닝을 대화 경로에 편입할 때)이며, 이번 그룹은
 * 해당하지 않는다. 따라서 `appliedImmediately`는 **계속 `true`**이고 `mode:'QUEUED'` 분기는 이번에도
 * 켜지지 않는다 — **본문·시그니처·반환값은 무수정**이다.
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
