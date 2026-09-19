import { useNavigate } from 'react-router-dom';

export interface BlockedRef {
  id: string;
  name: string;
}

/** 삭제 차단 배너가 참조하는 대상의 종류(편집 화면 라우팅에 사용, ui-spec §4.3.2). */
export type BlockedRefKind = 'node' | 'homonym' | 'context';

/**
 * `assertIntentDeletable`/`assertKeywordDeletable`(reference-check.service.ts)는 같은 오류 코드
 * (`INTENT_IN_USE`/`KEYWORD_IN_USE`)라도 참조 종류에 따라 서로 다른 `message`를 던진다.
 * 별도 타입 필드가 없으므로 메시지 문구로 참조 종류를 판별해 편집 화면 링크를 만든다.
 */
export function resolveBlockedRefKind(resourceKind: 'intent' | 'keyword' | 'context' | 'node', message: string): BlockedRefKind {
  if (resourceKind === 'intent' && message.includes('동음이의어')) return 'homonym';
  if (resourceKind === 'keyword' && message.includes('컨텍스트')) return 'context';
  return 'node';
}

function hrefFor(chatbotId: string, kind: BlockedRefKind, refId: string): string {
  switch (kind) {
    case 'homonym':
      return `/chatbots/${chatbotId}/dialogue/homonyms?edit=${refId}`;
    case 'context':
      return `/chatbots/${chatbotId}/dialogue/contexts/${refId}`;
    case 'node':
    default:
      return `/chatbots/${chatbotId}/dialogue/nodes/${refId}`;
  }
}

export interface DeleteBlockedBannerProps {
  chatbotId: string;
  /** 서버 `error.message`를 그대로 배너 제목으로 사용한다(고정 문구 금지, ui-spec §4.3.2). */
  message: string;
  refs: BlockedRef[];
  kind: BlockedRefKind;
  /** 링크 클릭 시 이동 전에 모달을 닫기 위한 콜백. */
  onBeforeNavigate: () => void;
}

/**
 * 모든 리소스(의도/키워드/컨텍스트/노드) 삭제 차단 배너의 공용 구현(ui-spec §4.3.2).
 * 참조 목록 각 항목은 클릭 시 모달을 닫고 해당 참조 리소스의 편집 화면으로 이동하는 링크다.
 */
export function DeleteBlockedBanner({ chatbotId, message, refs, kind, onBeforeNavigate }: DeleteBlockedBannerProps): JSX.Element {
  const navigate = useNavigate();
  const shown = refs.slice(0, 5);
  const extra = refs.length - shown.length;

  function goTo(refId: string): void {
    onBeforeNavigate();
    navigate(hrefFor(chatbotId, kind, refId));
  }

  return (
    <div className="form-banner form-banner--error" role="alert">
      <p>{message}</p>
      <ul>
        {shown.map((r) => (
          <li key={r.id}>
            <button type="button" className="link-button" onClick={() => goTo(r.id)}>
              {r.name}
            </button>
          </li>
        ))}
      </ul>
      {extra > 0 && <p>{`외 ${extra}건`}</p>}
    </div>
  );
}
