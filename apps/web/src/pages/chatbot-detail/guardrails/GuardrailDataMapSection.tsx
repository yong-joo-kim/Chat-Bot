import type { GovernanceGuardrailsMap } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

/**
 * DM-1 — 데이터 지도 "위험 응답 규칙·개인정보 가림·운영 전환 2인 승인" 절(`ai-guardrails-ui-spec.md` §10.2). 읽기 전용이며
 * `guardrails` 선택 키가 있을 때만 호출부가 이 절을 그린다(키 없음 = 미렌더 = 기존과 동일). 서버 스위치는 글자로도 전달한다.
 */
export function GuardrailDataMapSection({ map }: { map: GovernanceGuardrailsMap }): JSX.Element {
  const msg = MESSAGES.guardrails.dataMap;
  return (
    <section className="settings-card" aria-labelledby="gr-data-map-title">
      <h2 id="gr-data-map-title">{msg.title}</h2>
      <dl className="guardrail-datamap-list">
        <div>
          <dt className="sr-only">규칙</dt>
          <dd>{msg.rules(map.chatbotsWithRules, map.rules, map.enabledRules)}</dd>
        </div>
        <div>
          <dt className="sr-only">걸린 기록</dt>
          <dd>
            {msg.eventsPrefix(map.events)}
            <strong>{msg.eventsNoText}</strong>
          </dd>
        </div>
        <div>
          <dt className="sr-only">외부 전송</dt>
          <dd>{msg.noNewExit}</dd>
        </div>
        <div>
          <dt className="sr-only">개인정보 가림</dt>
          <dd>{msg.piiDefault(map.piiExitCustomizedChatbots)}</dd>
        </div>
        <div>
          <dt className="sr-only">2인 승인</dt>
          <dd>{msg.approval(map.approvalPolicyChatbots)}</dd>
        </div>
        <div>
          <dt className="sr-only">서버 스위치</dt>
          <dd>{msg.serverSwitch(map.serverEnabled)}</dd>
        </div>
      </dl>
    </section>
  );
}
