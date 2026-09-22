import { Link } from 'react-router-dom';
import { MESSAGES } from '../../constants/messages';

export type LinkWarningEntryType = 'INTENT_UNLINKED' | 'KEYWORD_UNLINKED';

export interface LinkWarningEntry {
  id: string;
  type: LinkWarningEntryType;
  questionText: string;
  /** `INTENT_UNLINKED`면 의도명, `KEYWORD_UNLINKED`면 키워드명. */
  targetName: string;
}

export interface LearningLinkWarningBannerProps {
  chatbotId: string;
  entries: LinkWarningEntry[];
  onCloseOne: (id: string) => void;
  onCloseAll: () => void;
}

/**
 * FR-C-8/NFR-A8 + FR-L2-12(§5.5) — 노드 미연결 경고. 토스트가 아니라 수동으로 닫기 전까지
 * 지속 표시되는 배너다. `NodeUnlinkedWarningBanner`를 일반화해 의도 미연결(기존)과 키워드
 * 미연결(신규, No.23 요소분해)을 함께 담는다 — 같은 배너, 항목 타입만 다르다.
 * 이 세션에서 얻은 반영 응답의 `linkedNodeCount===0`/`keywordLinkedNodeCount===0` 결과만
 * 누적한다(새로고침 시 사라짐, §4.7/§9 알려진 갭).
 * ⚠ `focusIntentId` 사전 채움은 `NodesListPage`가 지원하지 않으므로(확인 완료) 단순 이동만 제공하고
 * 문구도 낮춘 톤("... 화면으로 이동 →")을 쓴다.
 */
export function LearningLinkWarningBanner({ chatbotId, entries, onCloseOne, onCloseAll }: LearningLinkWarningBannerProps): JSX.Element | null {
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
            <span>
              {entry.type === 'INTENT_UNLINKED'
                ? MESSAGES.learning.nodeUnlinkedEntry(entry.questionText, entry.targetName)
                : MESSAGES.learning.keywordUnlinkedEntry(entry.questionText, entry.targetName)}
            </span>{' '}
            <Link to={`/chatbots/${chatbotId}/dialogue/nodes`}>
              {entry.type === 'INTENT_UNLINKED' ? MESSAGES.learning.nodeUnlinkedCreateNodeLinkSoft : MESSAGES.learning.keywordUnlinkedEditLinkSoft}
            </Link>{' '}
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
