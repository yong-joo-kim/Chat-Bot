import { useEffect, useState } from 'react';
import { findProactiveRulesReferencingNode } from '@chat-bot/shared-types';
import { proactiveApi } from '../../../api/proactive';
import { useAuth } from '../../../context/AuthContext';
import { MESSAGES } from '../../../constants/messages';

/**
 * [신규 No.35] PA-C8 — 노드 삭제 확인 창의 **비차단** 선제 안내 경고(화면 설계서 §3.8).
 * `channel:read` 권한이 없거나 조회가 실패하면 조용히 아무것도 렌더하지 않는다(R-9 — 경고가
 * 삭제 흐름을 막지 않는다). `NodesListPage`의 `ConfirmDialog`가 열릴 때만 마운트된다.
 */
export function ProactiveRuleRefWarning({ chatbotId, nodeId }: { chatbotId: string; nodeId: string }): JSX.Element | null {
  const { can } = useAuth();
  const [names, setNames] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNames(null);
    if (!can('channel:read')) return;
    proactiveApi
      .getOverview(chatbotId)
      .then((overview) => {
        if (cancelled) return;
        const refs = findProactiveRulesReferencingNode(overview.rules, nodeId);
        setNames(refs.map((r) => r.name));
      })
      .catch(() => {
        // 비차단(R-9) — 조회 실패는 조용히 무시한다.
      });
    return () => {
      cancelled = true;
    };
  }, [chatbotId, nodeId, can]);

  if (!names || names.length === 0) return null;

  return (
    <p className="form-banner form-banner--info" role="alert">
      <span aria-hidden="true">ⓘ</span> {MESSAGES.proactive.nodeDeleteWarning(names.length, names)}
    </p>
  );
}
