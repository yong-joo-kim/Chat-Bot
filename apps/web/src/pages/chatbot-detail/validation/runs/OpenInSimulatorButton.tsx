import { useState } from 'react';
import { MESSAGES } from '../../../../constants/messages';

/**
 * 결과 행 → 시뮬레이터 재현(ui-spec §4.4.1, §6.4). ⚠ 임시 처리: 시뮬레이터(`SimulatorPanel`)에는
 * 현재 질의 자동 프리필 진입점(`?prefillKey=`)이 없다(코드 확인 — 기존 그룹 범위). 이 그룹에서
 * `SimulatorPanel` 내부를 변경하면 이미 시험된 No.10 영역의 회귀 위험이 커지므로, 질문 문장을
 * 클립보드에 복사하고 시뮬레이터 탭을 새 창으로 여는 것으로 축소 구현한다(완료 보고에 기재).
 */
export function OpenInSimulatorButton({ chatbotId, questionText }: { chatbotId: string; questionText: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function handleClick(): Promise<void> {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(questionText);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // 클립보드 실패는 무시한다 — 시뮬레이터 탭 이동 자체는 계속 진행한다.
    }
  }

  return (
    <a
      className="btn btn-secondary"
      href={`/chatbots/${chatbotId}/simulator`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => void handleClick()}
    >
      {copied ? `✔ ${MESSAGES.common.copied}` : MESSAGES.validation.result.openInSimulator}
    </a>
  );
}
