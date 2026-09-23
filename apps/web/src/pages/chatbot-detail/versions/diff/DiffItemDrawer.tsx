import { useEffect, useState } from 'react';
import type { VersionAssetKind, VersionDiffItemDetail, VersionFieldDiff } from '@chat-bot/shared-types';
import { Modal } from '../../../../components/Modal';
import { CopyButton } from '../../../../components/CopyButton';
import { SkeletonRow } from '../../../../components/Skeleton';
import { ErrorState } from '../../../../components/ErrorState';
import { MESSAGES } from '../../../../constants/messages';
import { versionsApi } from '../../../../api/versions';

function FieldRow({ field }: { field: VersionFieldDiff }): JSX.Element {
  const msg = MESSAGES.versions.diff;
  if (field.type === 'SCALAR') {
    return (
      <li>
        <strong>{field.field}</strong>
        <p>{msg.fieldBeforeAfter(String(field.before ?? '—'), String(field.after ?? '—'))}</p>
      </li>
    );
  }
  if (field.type === 'VALUE_SET') {
    return (
      <li>
        <strong>{field.field}</strong>
        {field.reorderedOnly ? (
          <p>{msg.valueSetReorderedOnly}</p>
        ) : (
          <ul className="diff-value-set">
            {field.added.map((v, i) => (
              <li key={`a${i}`} className="diff-value-added">
                + {v} <CopyButton text={v} />
              </li>
            ))}
            {field.removed.map((v, i) => (
              <li key={`r${i}`} className="diff-value-removed">
                − {v}
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  }
  if (field.type === 'REF_SET') {
    return (
      <li>
        <strong>{field.field}</strong>
        <ul className="diff-ref-set">
          {field.added.map((r, i) => (
            <li key={`a${i}`}>+ {r.name ?? msg.refSetUnknownName}</li>
          ))}
          {field.removed.map((r, i) => (
            <li key={`r${i}`}>− {r.name ?? msg.refSetUnknownName}</li>
          ))}
        </ul>
      </li>
    );
  }
  // STRUCT
  const beforeText = JSON.stringify(field.before, null, 2);
  const afterText = JSON.stringify(field.after, null, 2);
  return (
    <li>
      <strong>{field.field}</strong>
      <div className="diff-struct-pair">
        <div>
          <p>{msg.structBefore}</p>
          <pre>{beforeText}</pre>
          <CopyButton text={beforeText} />
        </div>
        <div>
          <p>{msg.structAfter}</p>
          <pre>{afterText}</pre>
          <CopyButton text={afterText} />
        </div>
      </div>
    </li>
  );
}

export interface DiffItemDrawerProps {
  chatbotId: string;
  versionId: string;
  against: string;
  kind: VersionAssetKind;
  itemId: string;
  onClose: () => void;
}

/**
 * L2 항목 클릭 시 상세 드로어(`version-history-ui-spec.md` §4.2 — `DiffItemDrawer`). 접근성을 위해
 * 공용 `Modal`(포커스 트랩·Esc·복귀 포커스)을 재사용한다(시각적으로는 중앙 다이얼로그로 렌더된다).
 */
export function DiffItemDrawer({ chatbotId, versionId, against, kind, itemId, onClose }: DiffItemDrawerProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [detail, setDetail] = useState<VersionDiffItemDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    versionsApi
      .diffItemDetail(chatbotId, versionId, kind, itemId, against)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chatbotId, versionId, kind, itemId, against]);

  return (
    <Modal isOpen title={detail ? `${detail.name} · ${MESSAGES.versions.content.kindTabs[kind]}` : MESSAGES.common.loading} onClose={onClose}>
      {loading && <SkeletonRow />}
      {!loading && error && <ErrorState title={MESSAGES.versions.diff.loadFailed} />}
      {!loading && !error && detail && <ul className="diff-item-fields">{detail.fields.map((f, i) => <FieldRow key={i} field={f} />)}</ul>}
    </Modal>
  );
}
