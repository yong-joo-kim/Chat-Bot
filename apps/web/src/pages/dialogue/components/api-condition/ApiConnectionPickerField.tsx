import { useEffect, useState } from 'react';
import type { ApiHttpMethod } from '@chat-bot/shared-types';
import { ResourcePickerField } from '../../../../components/ResourcePickerField';
import { apiConnectionsApi } from '../../../../api/apiConnections';
import { useAuth } from '../../../../context/AuthContext';
import { MESSAGES } from '../../../../constants/messages';

export interface ApiConnectionPickerFieldProps {
  id: string;
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  errorMessage?: string;
  required?: boolean;
}

interface ConnectionInfo {
  allowedMethods: ApiHttpMethod[];
  enabled: boolean;
  personalDataLookup: boolean;
}

/**
 * D1a-v2 — `ApiConnectionPickerField`(ui-spec §2.2). `ResourcePickerField`의 5번째(`apiConnection`)
 * `resourceType`을 그대로 쓰되, 선택 결과에 GET/POST 허용 여부·개인정보 조회형 안내를 덧붙인다.
 * `chatbotId`를 요구하지 않는다(연결은 전역 자원).
 */
export function ApiConnectionPickerField({ id, label, value, onChange, errorMessage, required }: ApiConnectionPickerFieldProps): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;
  const acMsg = MESSAGES.apiConnections;
  const { can } = useAuth();
  const canManageConnections = can('security:write');
  const [info, setInfo] = useState<ConnectionInfo | null>(null);

  useEffect(() => {
    if (!value) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    apiConnectionsApi
      .picker()
      .then((res) => {
        if (cancelled) return;
        const found = res.items.find((c) => c.id === value);
        setInfo(found ? { allowedMethods: found.allowedMethods, enabled: found.enabled, personalDataLookup: found.personalDataLookup } : null);
      })
      .catch(() => setInfo(null));
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div>
      <ResourcePickerField
        id={id}
        label={label}
        resourceType="apiConnection"
        multiple={false}
        value={value}
        onChange={(v) => onChange((v as string) ?? null)}
        required={required}
        errorMessage={errorMessage}
        helpText={msg.apiConnectionHelp}
        noResultMessage={acMsg.pickerNoResult}
        createLinkLabel={acMsg.pickerCreateLink}
        createHref={canManageConnections ? '/settings/api-connections' : undefined}
        createHint={canManageConnections ? undefined : acMsg.pickerCreateHint}
      />
      {info && (
        <p className="field-hint">
          {info.allowedMethods.length === 2 ? MESSAGES.apiConnections.pickerMethodsAll : MESSAGES.apiConnections.pickerMethodsGetOnly}
          {' · '}
          {info.enabled ? MESSAGES.apiConnections.badgeEnabled : MESSAGES.apiConnections.badgeDisabled}
        </p>
      )}
      {info?.personalDataLookup && (
        <p className="form-banner form-banner--info">
          <span aria-hidden="true">ⓘ</span> {msg.personalDataLookupWarning}
        </p>
      )}
    </div>
  );
}
