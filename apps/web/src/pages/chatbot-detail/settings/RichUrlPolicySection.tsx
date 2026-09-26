import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RichUrlHostRule, RichUrlPolicyResponse } from '@chat-bot/shared-types';
import { RichUrlHostSchema } from '@chat-bot/shared-types';
import { richMessagesApi } from '../../../api/richMessages';
import { ApiError } from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../components/Toast';
import { SkeletonRow } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/ErrorState';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { SeverityBadge } from '../../../components/SeverityBadge';
import { MESSAGES } from '../../../constants/messages';

/**
 * RM-5 — 챗봇 설정 "이미지·링크 허용 도메인"(channel-rich-messages-ui-spec.md §3.5, D-6 확정 이름).
 * 조회는 `chatbot:read`(서브탭 진입 자체로 보장), 저장은 `chatbot:write`일 때만 폼 요소를 렌더한다.
 */
export function RichUrlPolicySection({ chatbotId, isArchived }: { chatbotId: string; isArchived: boolean }): JSX.Element {
  const msg = MESSAGES.richUrlPolicy;
  const { can } = useAuth();
  const { showToast } = useToast();
  const canWrite = can('chatbot:write');

  const [data, setData] = useState<RichUrlPolicyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hosts, setHosts] = useState<RichUrlHostRule[]>([]);
  const [newHost, setNewHost] = useState('');
  const [newIncludeSubdomains, setNewIncludeSubdomains] = useState(false);
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  function load(): void {
    setLoading(true);
    setError(false);
    richMessagesApi
      .getUrlPolicy(chatbotId)
      .then((res) => {
        setData(res);
        setHosts(res.hosts);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbotId]);

  function handleAdd(): void {
    setAddError(undefined);
    // [코드 리뷰 R1 Medium] 50개 상한 분기는 여기 없다 — "+ 추가" 버튼이 상한에서 이미 비활성이라
    // 이 함수 자체가 호출되지 않는다(도달할 수 없는 코드였다). 상한 안내는 항상 보이는 힌트로
    // 대체했다(아래 JSX `hosts.length >= 50`).
    const parsed = RichUrlHostSchema.safeParse(newHost);
    if (!parsed.success) {
      setAddError(msg.hostFormatError);
      return;
    }
    if (hosts.some((h) => h.host === parsed.data)) {
      setAddError(msg.duplicateHostError);
      return;
    }
    setHosts((prev) => [...prev, { host: parsed.data, includeSubdomains: newIncludeSubdomains }]);
    setNewHost('');
    setNewIncludeSubdomains(false);
  }

  function handleRemove(host: string): void {
    setHosts((prev) => prev.filter((h) => h.host !== host));
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      const res = await richMessagesApi.updateUrlPolicy(chatbotId, { hosts });
      setData(res);
      setHosts(res.hosts);
      showToast(msg.saveSuccess);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CHATBOT_ARCHIVED') {
        showToast(msg.archivedSaveError);
      } else if (e instanceof ApiError) {
        showToast(e.message);
      } else {
        showToast(MESSAGES.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </>
    );
  }
  if (error || !data) return <ErrorState title={msg.loadFailed} onRetry={load} />;

  return (
    <div className="rich-url-policy-section">
      <p className="field-hint">{msg.intro}</p>
      <p className="field-hint">{msg.outsideEnvironmentNotice}</p>

      {data.governanceModeOn && hosts.length === 0 && <SeverityBadge severity="WARNING" label={msg.governanceWarningBadge} />}

      {hosts.length === 0 ? (
        <p className="field-hint">{msg.empty}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{msg.hostColumnLabel}</th>
              <th scope="col">{msg.includeSubdomainsColumnLabel}</th>
              {canWrite && <th scope="col">{msg.removeButton}</th>}
            </tr>
          </thead>
          <tbody>
            {hosts.map((h) => (
              <tr key={h.host}>
                <td>{h.host}</td>
                <td>{h.includeSubdomains ? '☑' : '☐'}</td>
                {canWrite && (
                  <td>
                    <button type="button" className="btn btn-secondary" disabled={isArchived} onClick={() => handleRemove(h.host)}>
                      {msg.removeButton}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="field-label-static">{msg.hostsTitle(hosts.length)}</p>

      {canWrite && (
        <>
          <div className="node-form-section">
            <h3>{msg.addSectionTitle}</h3>
            <div className="form-field form-field--inline">
              <label htmlFor="rich-url-policy-new-host">{msg.addHostInputLabel}</label>
              <input
                id="rich-url-policy-new-host"
                type="text"
                value={newHost}
                disabled={isArchived}
                onChange={(e) => setNewHost(e.target.value)}
                aria-invalid={Boolean(addError)}
              />
              <input
                id="rich-url-policy-include-subdomains"
                type="checkbox"
                checked={newIncludeSubdomains}
                disabled={isArchived}
                onChange={(e) => setNewIncludeSubdomains(e.target.checked)}
              />
              <label htmlFor="rich-url-policy-include-subdomains">{msg.addIncludeSubdomainsLabel}</label>
              <button type="button" className="btn btn-secondary" disabled={isArchived || hosts.length >= 50} onClick={handleAdd}>
                {msg.addButton}
              </button>
              {/* [코드 리뷰 R1 Medium] 상한 안내를 상시 표시한다(`ReorderableList`의 `addLimitLabel`과 같은 원칙). */}
              {hosts.length >= 50 && <span className="field-hint">{msg.limitExceededError}</span>}
            </div>
            <InlineFieldError id="rich-url-policy-new-host-error" message={addError} />
          </div>

          {data.outsideNodeCount > 0 && (
            <p className="field-hint">
              {msg.outsideNodeCountLabel(data.outsideNodeCount)} <Link to={`/chatbots/${chatbotId}/dialogue/nodes`}>{msg.goToNodesLink}</Link>
            </p>
          )}

          <div className="form-actions">
            <button type="button" className="btn btn-primary" disabled={saving || isArchived} onClick={() => void handleSave()}>
              {saving ? MESSAGES.common.saving : msg.save}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
