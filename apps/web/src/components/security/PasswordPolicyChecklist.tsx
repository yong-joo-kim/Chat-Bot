import { validatePasswordPolicy, type PasswordRuleId } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';

const RULE_ORDER: PasswordRuleId[] = ['LENGTH', 'CHAR_CLASSES', 'EMAIL_LOCALPART'];

/**
 * `validatePasswordPolicy()`(shared-types, F-11)를 그대로 호출해 규칙별 충족 여부를 실시간
 * 렌더한다. 색상만으로 구분하지 않고 아이콘+텍스트를 병기한다(NFR-A3).
 */
export function PasswordPolicyChecklist({ password, email }: { password: string; email?: string }): JSX.Element {
  const result = validatePasswordPolicy(password, { email });
  const violatedRules = new Set(result.violations.map((v) => v.rule));

  return (
    <ul className="password-policy-checklist" aria-label="비밀번호 규칙">
      {RULE_ORDER.map((rule) => {
        const met = password.length > 0 && !violatedRules.has(rule);
        return (
          <li key={rule} className={met ? 'password-policy-item--met' : undefined}>
            <span aria-hidden="true">{met ? '✔' : '○'}</span> {MESSAGES.auth.policy[rule]}
          </li>
        );
      })}
    </ul>
  );
}
