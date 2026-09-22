import { Link } from 'react-router-dom';
import { MESSAGES } from '../../constants/messages';

export interface NodeUnlinkedEntry {
  id: string;
  questionText: string;
  intentId: string;
  intentName: string;
}

export interface NodeUnlinkedWarningBannerProps {
  chatbotId: string;
  entries: NodeUnlinkedEntry[];
  onCloseOne: (id: string) => void;
  onCloseAll: () => void;
}

/**
 * FR-C-8/NFR-A8 — 노드 미연결 경고. 토스트가 아니라 수동으로 닫기 전까지 지속 표시되는 배너다.
 * 이 세션에서 반영 응답으로 얻은 `linkedNodeCount===0` 결과만 누적한다(새로고침 시 사라짐, §4.7 알려진 갭).
 * ⚠ `focusIntentId` 사전 채움은 `NodesListPage`가 지원하지 않으므로(확인 완료) 단순 이동만 제공하고
 * 문구도 낮춘 톤("노드 만들기 화면으로 이동 →")을 쓴다.
 */
export function NodeUnlinkedWarningBanner({ chatbotId, entries, onCloseOne, onCloseAll }: NodeUnlinkedWarningBannerProps): JSX.Element | null {
  if (entries.length === 0) return null;
  return (
    <div className="node-unlinked-banner" role="alert">
      <div className="node-unlinked-banner-header">
        <span aria-hidden="true">⚠</span> <strong>{MESSAGES.learning.nodeUnlinkedBannerTitle}</strong>
        <button type="button" className="btn btn-secondary" onClick={onCloseAll}>
          {MESSAGES.learning.closeAllBanners}
        </button>
      </div>
      <ul className="node-unlinked-banner-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <span>{MESSAGES.learning.nodeUnlinkedEntry(entry.questionText, entry.intentName)}</span>{' '}
            <Link to={`/chatbots/${chatbotId}/dialogue/nodes`}>{MESSAGES.learning.nodeUnlinkedCreateNodeLinkSoft}</Link>{' '}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onCloseOne(entry.id)}
              aria-label={MESSAGES.learning.closeBanner(entry.questionText)}
            >
              {MESSAGES.common.close}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
