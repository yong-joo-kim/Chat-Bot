import { useEffect, useRef, useState } from 'react';
import { MESSAGES } from '../../../constants/messages';

/**
 * [신규 No.43] "상태가 바뀔 때만" 화면낭독 알림(§0-2 판단, `kb-crawling-ui-spec.md` §12-①).
 * `AsyncJobProgress`의 기본 `aria-live` 텍스트는 진행률 숫자가 바뀔 때마다 전체를 다시 낭독할
 * 위험이 있어, 이 훅은 `label`(예: 상태 단어)이 **실제로 달라질 때만** "이전 → 다음" 문장을 반환한다.
 * 최초 마운트 시에는 전환 문구를 만들지 않는다(불필요한 낭독 방지).
 */
export function useAnnouncedTransition(label: string): string {
  const prevRef = useRef(label);
  const [announced, setAnnounced] = useState('');

  useEffect(() => {
    if (prevRef.current !== label) {
      // 빈 문자열(추적 대상 없음 → 첫 값)에서 시작하는 전환은 "기준값 설정"으로 보고 낭독하지 않는다.
      if (prevRef.current !== '') {
        setAnnounced(MESSAGES.kbRuns.liveStatusChanged(prevRef.current, label));
      }
      prevRef.current = label;
    }
  }, [label]);

  return announced;
}
