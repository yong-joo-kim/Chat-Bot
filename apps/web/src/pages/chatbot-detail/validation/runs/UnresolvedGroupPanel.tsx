import type { TestRunResult } from '@chat-bot/shared-types';
import { TestCaseBulkDisableButton } from '../sets/TestCaseBulkDisableButton';
import { MESSAGES } from '../../../../constants/messages';

/** `UNRESOLVED` 결과를 대상별로 그룹핑해 보여주는 패널(ui-spec §4.4.1, S-4). */
export function UnresolvedGroupPanel({
  chatbotId,
  setId,
  items,
  canWrite,
  onDisabled,
}: {
  chatbotId: string;
  setId: string;
  items: TestRunResult[];
  canWrite: boolean;
  onDisabled: () => void;
}): JSX.Element | null {
  if (items.length === 0) return null;
  const msg = MESSAGES.validation.result;

  const groups = new Map<string, TestRunResult[]>();
  for (const item of items) {
    const key = item.expectedTargetName ?? item.expectedTargetId ?? '?';
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  return (
    <div className="unresolved-group-panel">
      <div className="dialogue-toolbar">
        <p className="unresolved-group-panel-title">{msg.unresolvedPanelTitle(items.length)}</p>
        {canWrite && <TestCaseBulkDisableButton chatbotId={chatbotId} setId={setId} caseIds={items.map((i) => i.caseId)} onDone={onDisabled} />}
      </div>
      <ul>
        {Array.from(groups.entries()).map(([name, group]) => (
          <li key={name}>{msg.unresolvedGroupLabel(name, group.length)}</li>
        ))}
      </ul>
    </div>
  );
}
