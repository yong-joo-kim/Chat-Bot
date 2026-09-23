import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface ToastItem {
  id: number;
  message: ReactNode;
}

interface ToastContextValue {
  /** `ReactNode`도 허용한다 — No.25 증강 승인 결과의 자동 스냅샷 안내처럼 링크를 포함한 토스트가 필요할 수 있다(§4.5.3). */
  showToast: (message: ReactNode) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** 성공/일반 안내 토스트(ui-spec §2.3). 3~4초 자동 소멸, `aria-live="polite"`로 스크린리더에 안내. */
export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const showToast = useCallback((message: ReactNode) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toasts.map((t) => (
          <div key={t.id} className="toast" role="status">
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast는 ToastProvider 내부에서만 사용할 수 있습니다.');
  return ctx;
}
