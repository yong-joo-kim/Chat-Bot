import { MESSAGES } from '../../../constants/messages';

/**
 * [3차 보완] 서버 `KbRunView.etaSeconds`(초)를 "약 N분/시간 남음" 문구로 바꾼다. 1시간 미만이면
 * 분 단위로(그렇지 않으면 부정확하게 "약 1시간"으로 과대 표시될 수 있다 — 실제 값을 우선한다는
 * 취지), 그 이상이면 시간 단위로 반올림한다. `etaSeconds <= 0`이면 호출부가 렌더 여부를 판단한다
 * (이 함수는 항상 문자열을 반환한다 — null/0 가드는 호출부 책임).
 */
export function formatEtaSeconds(etaSeconds: number): string {
  const msg = MESSAGES.kbRuns;
  if (etaSeconds < 3600) {
    return msg.etaTextMinutes(Math.max(1, Math.round(etaSeconds / 60)));
  }
  return msg.etaText(Math.max(1, Math.round(etaSeconds / 3600)));
}
