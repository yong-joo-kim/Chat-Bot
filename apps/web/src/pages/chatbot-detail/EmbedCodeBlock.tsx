import { useRef, useState } from 'react';
import { MESSAGES } from '../../constants/messages';

/**
 * 읽기 전용이나 복사/붙여넣기·텍스트 선택을 제한하지 않는 코드 블록(FR-4-11, UIUX §5).
 * 클립보드 API 실패 시 코드 전체를 자동 선택해 "Ctrl+C로 복사" 안내로 폴백한다(EX-4-2).
 */
export function EmbedCodeBlock({ label, code }: { label: string; code: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  async function handleCopy(): Promise<void> {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setFallback(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setFallback(true);
      if (preRef.current) {
        const range = document.createRange();
        range.selectNodeContents(preRef.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }

  return (
    <div className="embed-code-block">
      <div className="embed-code-block-header">
        <span>{label}</span>
        <button type="button" className="btn btn-secondary" onClick={handleCopy}>
          {copied ? `✔ ${MESSAGES.common.copied}` : MESSAGES.common.copy}
        </button>
      </div>
      <pre ref={preRef} className="embed-code-pre">
        <code>{code}</code>
      </pre>
      {fallback && <p className="copy-fallback-hint">{MESSAGES.common.copyFallback}</p>}
    </div>
  );
}
