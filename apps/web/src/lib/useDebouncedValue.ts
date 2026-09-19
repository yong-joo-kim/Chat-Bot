import { useEffect, useState } from 'react';

/** 값이 `delayMs` 동안 바뀌지 않을 때만 갱신된 값을 반환한다(slug 중복확인 400ms 디바운스 등). */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
