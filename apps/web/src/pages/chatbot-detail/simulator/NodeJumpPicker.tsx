import { useState } from 'react';
import { ResourcePickerField } from '../../../components/ResourcePickerField';
import { MESSAGES } from '../../../constants/messages';

/** `ResourcePickerField`를 감싼 "노드로 바로 테스트" 컨트롤(FR-E2-1 노출, §4.1.3). */
export function NodeJumpPicker({
  chatbotId,
  disabled,
  onSubmit,
}: {
  chatbotId: string;
  disabled: boolean;
  onSubmit: (nodeId: string) => void;
}): JSX.Element {
  const msg = MESSAGES.simulator.nodeJump;
  const [nodeId, setNodeId] = useState<string | null>(null);

  return (
    <div className="node-jump-picker">
      <ResourcePickerField
        id="sim-node-jump"
        label={msg.searchLabel}
        resourceType="node"
        chatbotId={chatbotId}
        multiple={false}
        value={nodeId}
        onChange={(v) => setNodeId((v as string) || null)}
        disabled={disabled}
      />
      <button
        type="button"
        className="btn btn-secondary"
        disabled={disabled || !nodeId}
        onClick={() => {
          if (nodeId) {
            onSubmit(nodeId);
            setNodeId(null);
          }
        }}
      >
        {msg.submit}
      </button>
    </div>
  );
}
