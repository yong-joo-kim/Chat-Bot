import { MESSAGES } from '../../../constants/messages';

/** EN1 모드 꺼짐 레이아웃(`environment-separation-ui-spec.md` §4.1.1). */
export function EnvironmentOffPanel({ canDeploy, onEnableClick }: { canDeploy: boolean; onEnableClick: () => void }): JSX.Element {
  const msg = MESSAGES.environment.off;
  return (
    <div className="environment-off-panel">
      <h1>{msg.title}</h1>
      <p>{msg.description1}</p>
      <p>{msg.description2}</p>
      <p>{msg.description3}</p>
      <ul>
        <li>{msg.envListItems.draft}</li>
        <li>{msg.envListItems.staging}</li>
        <li>{msg.envListItems.prod}</li>
      </ul>
      {canDeploy && (
        <button type="button" className="btn btn-primary" onClick={onEnableClick}>
          {msg.enableButton}
        </button>
      )}
      {/* [신규 No.36] 2인 승인 패널은 환경 분리가 켜진 뒤에만 있다 — 그 사실만 한 줄로 알린다(ui-spec §9.2). */}
      <p className="field-hint">{MESSAGES.switchApproval.policy.offModeHint}</p>
    </div>
  );
}
