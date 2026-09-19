import { useState } from 'react';
import { MESSAGES } from '../constants/messages';

/** 복사 버튼(FR-4-10). 성공 시 체크 아이콘 피드백, 클립보드 API 실패 시 안내 문구로 폴백(EX-4-2). */
export function CopyButton({ text, label }: { text: string; label?: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFallback(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setFallback(true);
    }
  }

  return (
    <span className="copy-button-wrap">
      <button type="button" className="btn btn-secondary copy-button" onClick={handleCopy}>
        {copied ? `✔ ${MESSAGES.common.copied}` : (label ?? MESSAGES.common.copy)}
      </button>
      {fallback && <span className="copy-fallback-hint">{MESSAGES.common.copyFallback}</span>}
    </span>
  );
}
