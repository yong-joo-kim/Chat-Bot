import { Link } from 'react-router-dom';
import { ErrorState } from '../../../components/ErrorState';
import { MESSAGES } from '../../../constants/messages';

/**
 * KB12 — 기능 꺼짐 상태(`kb-crawling-ui-spec.md` §3.9). `meta` 404를 받으면 다시 시도 버튼 없이
 * "설정 메인으로" 링크만 보여준다(서버 설정 문제라 재시도로 해결되지 않는다). 전용 설정 랜딩 라우트가
 * 없어(`SystemSettingsMenu` 드롭다운으로만 진입) 홈으로 연결한다.
 */
export function KbFeatureOffState(): JSX.Element {
  const msg = MESSAGES.kbSources;
  return (
    <div className="kb-feature-off-state">
      <ErrorState title={msg.featureOffTitle} />
      <p>{msg.featureOffDesc}</p>
      <Link to="/" className="btn btn-secondary">
        {msg.featureOffBackLink}
      </Link>
    </div>
  );
}
