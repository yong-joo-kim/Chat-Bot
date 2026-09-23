import type { VersionChangeKind } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';

/**
 * 버전 이력(No.25) 차이 변경유형 3종(`version-history-ui-spec.md` §3.3-2, FR-H4-7).
 * `JudgmentBadge`(검증/품질 고도화)와 같은 "기호+텍스트+색" 3중 패턴을 쓰되, 도메인 유니온이
 * 달라 별도 컴포넌트로 둔다(이 코드베이스의 기존 관행).
 */
const CONFIG: Record<VersionChangeKind, { symbol: string; bg: string; fg: string }> = {
  ADDED: { symbol: '+', bg: '#DCFCE7', fg: '#166534' },
  REMOVED: { symbol: '−', bg: '#FEE2E2', fg: '#991B1B' },
  MODIFIED: { symbol: '~', bg: '#FEF3C7', fg: '#92400E' },
};

const LABEL_KEY: Record<VersionChangeKind, 'changeLabelAdded' | 'changeLabelRemoved' | 'changeLabelModified'> = {
  ADDED: 'changeLabelAdded',
  REMOVED: 'changeLabelRemoved',
  MODIFIED: 'changeLabelModified',
};

export function ChangeKindBadge({ change }: { change: VersionChangeKind }): JSX.Element {
  const cfg = CONFIG[change];
  const text = MESSAGES.versions.diff[LABEL_KEY[change]];
  return (
    <span className="change-kind-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <span aria-hidden="true">{cfg.symbol}</span> {text}
    </span>
  );
}
