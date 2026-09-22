import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ROLE_LABELS } from '@chat-bot/shared-types';
import { useAuth } from '../../context/AuthContext';
import { MESSAGES } from '../../constants/messages';

/**
 * L4 — 403 접근 거부 안내(security-audit-ui-spec.md §3.5). "다시 시도" 버튼은 넣지 않는다
 * (재시도로 해결되는 상태가 아니다). 진입 시 포커스를 제목으로 이동한다(NFR-A5 취지 확장).
 */
export function ForbiddenState({ menuName = MESSAGES.systemSettings.label }: { menuName?: string }): JSX.Element {
  const { user } = useAuth();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const roleLabel = user ? ROLE_LABELS[user.role] : '';

  return (
    <div className="forbidden-state" role="alert">
      <p className="forbidden-state-icon" aria-hidden="true">
        🔒
      </p>
      <h1 ref={headingRef} tabIndex={-1} className="forbidden-state-title">
        {MESSAGES.auth.forbidden.title}
      </h1>
      <p>{MESSAGES.auth.forbidden.desc(roleLabel, menuName)}</p>
      <Link to="/" className="btn btn-primary">
        {MESSAGES.auth.forbidden.backHome}
      </Link>
    </div>
  );
}
