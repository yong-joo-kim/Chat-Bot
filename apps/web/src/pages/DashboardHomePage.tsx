import { Link } from 'react-router-dom';
import { MESSAGES } from '../constants/messages';

export function DashboardHomePage(): JSX.Element {
  return (
    <section>
      <h1>{MESSAGES.common.appName} 관리자 콘솔</h1>
      <p>
        챗봇 그룹과 챗봇을 관리하려면{' '}
        <Link to="/chatbots">{MESSAGES.common.chatbotListNav}</Link>으로 이동하세요.
      </p>
    </section>
  );
}
