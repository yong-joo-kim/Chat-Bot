import type { ResolvedBundleTarget } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';

/**
 * `BundleTarget`/`ResolvedBundleTarget`의 `kind`+`versionNo`를 화면 표시 라벨로 바꾼다(No.40,
 * `environment-separation-ui-spec.md` §3.3(1) `TargetSelectField`/§4.14 `TargetBadge` 공용).
 * `STAGING`/`PROD`는 각각 "스테이징(vN)"/"운영(vN)", 그 외(과거 운영 이력 등 임의 버전)는 "vN"만 쓴다.
 */
export function targetLabel(target: Pick<ResolvedBundleTarget, 'kind' | 'versionNo'>): string {
  const msg = MESSAGES.environment.targetSelect;
  switch (target.kind) {
    case 'STAGING':
      return msg.staging(target.versionNo);
    case 'PROD':
      return msg.prod(target.versionNo);
    default:
      return msg.version(target.versionNo);
  }
}

export interface TargetBadgeProps {
  /** 없으면(초안) 렌더하지 않는다(§4.14 "대상이 초안이 아닐 때만"). */
  target?: ResolvedBundleTarget;
}

/**
 * TC 실행 목록/상세/비교의 "대상: 스테이징(v44)" 표시(§4.14). `legacyTiebreak`/`semanticMissing`가
 * 있으면 같은 배지에 보조 힌트를 병기한다(색상 단독 금지 원칙 — 텍스트로 전달).
 */
export function TargetBadge({ target }: TargetBadgeProps): JSX.Element | null {
  if (!target) return null;
  const msg = MESSAGES.environment.targetBadge;
  return (
    <span className="target-badge">
      {msg.prefix(targetLabel(target))}
      {target.legacyTiebreak && (
        <span className="field-hint">
          {' '}
          <span aria-hidden="true">ⓘ</span> {msg.legacyTiebreakHint}
        </span>
      )}
      {target.semanticMissing > 0 && <span className="field-hint"> {msg.semanticPendingHint(target.semanticMissing)}</span>}
    </span>
  );
}
