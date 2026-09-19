import { MESSAGES } from '../../constants/messages';

/** DRAFT 상태 챗봇의 임베드 탭 주의 문구(FR-4-12, AC-4-10). 코드 확인/복사 자체는 항상 가능하다. */
export function DraftEmbedNotice({ visible, onActivate }: { visible: boolean; onActivate: () => void }): JSX.Element | null {
  if (!visible) return null;
  return (
    <div className="draft-embed-notice" role="status">
      <p>
        <span aria-hidden="true">⚠</span> {MESSAGES.embed.draftNotice}
      </p>
      <button type="button" className="btn btn-secondary" onClick={onActivate}>
        {MESSAGES.embed.activateNow}
      </button>
    </div>
  );
}
