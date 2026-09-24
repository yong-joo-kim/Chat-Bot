import { useState } from 'react';
import { ConfirmDialog } from '../Modal';
import { MESSAGES } from '../../constants/messages';

export interface RawTextToggleProps {
  /** 담당자·ADMIN·`handoff.status==='CONNECTED'`일 때만 `true`로 넘긴다 — 그 밖에는 이 컴포넌트 자체를 렌더하지 않는다(호출부 책임). */
  visible: boolean;
  /** 기본값은 항상 꺼짐(PM 확정) — 부모가 세션이 바뀔 때마다 `false`로 재설정한다. */
  enabled: boolean;
  onToggle: (next: boolean) => void;
}

/**
 * 원문 보기 토글(hybrid-cs-ui-spec.md §2.2·§3.3). 켤 때만 감사 고지 팝오버를 거친다 — 끄는 동작은
 * 즉시 반영한다. 원문 캐시 삭제·재조회는 호출부(`onToggle`)가 담당한다(이 컴포넌트는 원문을 들고
 * 있지 않는다).
 */
export function RawTextToggle({ visible, enabled, onToggle }: RawTextToggleProps): JSX.Element | null {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const msg = MESSAGES.handoffConsole;

  if (!visible) return null;

  return (
    <>
      <label className="form-field--inline raw-text-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            if (e.target.checked) setConfirmOpen(true);
            else onToggle(false);
          }}
        />
        {msg.rawToggleLabel}
      </label>
      <ConfirmDialog
        isOpen={confirmOpen}
        title={msg.rawToggleConfirmTitle}
        description={msg.rawToggleConfirmDesc}
        confirmLabel={msg.rawToggleLabel}
        onConfirm={() => {
          setConfirmOpen(false);
          onToggle(true);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
