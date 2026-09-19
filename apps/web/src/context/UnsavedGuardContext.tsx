import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';

export interface UnsavedGuardContextValue {
  /** AC-3-8: 저장하지 않은 변경 사항이 있을 때 이동을 가로채기 위해 하위 탭이 등록하는 가드. */
  setGuard: (guard: (() => boolean) | null) => void;
  /** 등록된 가드가 있으면 실행해 이동 가능 여부를 반환한다(가드가 없으면 항상 true). */
  confirmNavigation: () => boolean;
}

const UnsavedGuardContext = createContext<UnsavedGuardContextValue | null>(null);

/**
 * 챗봇 상세 탭(설정/스킨 등)이 등록한 "저장 안 된 변경사항" 가드를 앱 전역(TopBar 포함)에서
 * 공유하기 위한 컨텍스트. `TopBar`는 `ChatbotDetailLayout`의 Outlet 하위가 아니므로
 * `useOutletContext`로는 가드에 접근할 수 없어 별도 Provider로 값을 끌어올린다.
 */
export function UnsavedGuardProvider({ children }: { children: ReactNode }): JSX.Element {
  const guardRef = useRef<(() => boolean) | null>(null);

  const setGuard = useCallback((guard: (() => boolean) | null) => {
    guardRef.current = guard;
  }, []);

  const confirmNavigation = useCallback((): boolean => {
    if (!guardRef.current) return true;
    return guardRef.current();
  }, []);

  const value = useMemo(() => ({ setGuard, confirmNavigation }), [setGuard, confirmNavigation]);

  return <UnsavedGuardContext.Provider value={value}>{children}</UnsavedGuardContext.Provider>;
}

export function useUnsavedGuard(): UnsavedGuardContextValue {
  const ctx = useContext(UnsavedGuardContext);
  if (!ctx) {
    throw new Error('useUnsavedGuard는 UnsavedGuardProvider 하위에서만 사용할 수 있습니다.');
  }
  return ctx;
}
