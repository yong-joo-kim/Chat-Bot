import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { FlowNode, FlowTree } from '@chat-bot/shared-types';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonRow } from '../../../components/Skeleton';
import { MESSAGES } from '../../../constants/messages';

export interface FlowPreviewPanelProps {
  chatbotId: string;
  tree: FlowTree | null;
  loading: boolean;
  error: boolean;
  onLoad: () => void;
}

/** D1 — 흐름 미리보기(ui-spec §4.1.1, FR-5-19). 읽기전용 트리를 키보드로 펼침/접기한다(AC-5-14). */
export function FlowPreviewPanel({ chatbotId, tree, loading, error, onLoad }: FlowPreviewPanelProps): JSX.Element {
  const msg = MESSAGES.dialogue.flow;
  return (
    <div className="dialogue-panel">
      <div className="dialogue-panel-header">
        <h3 style={{ margin: 0 }}>{msg.title}</h3>
        <button type="button" className="btn btn-secondary" onClick={onLoad}>
          {msg.refresh}
        </button>
      </div>
      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={onLoad} />}
      {!loading && !error && tree && tree.roots.length === 0 && <EmptyState title={msg.empty} />}
      {!loading && !error && tree && tree.roots.length > 0 && (
        <>
          <ul className="flow-tree">
            {tree.roots.map((node) => (
              <FlowNodeItem key={node.nodeId} node={node} chatbotId={chatbotId} />
            ))}
          </ul>
          {tree.orphanNodes.length > 0 && (
            <div className="flow-tree-orphans">
              <p className="field-label-static">{msg.orphanTitle}</p>
              <ul>
                {tree.orphanNodes.map((n) => (
                  <li key={n.id}>
                    <Link to={`/chatbots/${chatbotId}/dialogue/nodes/${n.id}`}>{n.name}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FlowNodeItem({ node, chatbotId }: { node: FlowNode; chatbotId: string }): JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0 && !node.repeated;
  return (
    <li>
      <button
        type="button"
        className="flow-tree-toggle"
        aria-expanded={hasChildren ? expanded : undefined}
        onClick={() => hasChildren && setExpanded((v) => !v)}
        disabled={!hasChildren}
      >
        <span aria-hidden="true">{hasChildren ? (expanded ? '▾' : '▸') : '·'}</span>{' '}
        {/* [No.26] API 조건분기 대상은 "API 분기 →" 접두로 표시한다(ui-spec §3.6 `ApiBranchLabel`). */}
        {node.via === 'API_BRANCH' && <span className="flow-tree-via-label">{MESSAGES.dialogue.flow.apiBranchLabel} </span>}
        {node.via === 'SURVEY_COMPLETE' && <span className="flow-tree-via-label">{MESSAGES.dialogue.flow.surveyCompleteLabel} </span>}
        <Link to={`/chatbots/${chatbotId}/dialogue/nodes/${node.nodeId}`} onClick={(e) => e.stopPropagation()}>
          {node.name}
        </Link>
        {node.repeated && <span> {MESSAGES.dialogue.flow.repeated}</span>}
        {/* [신규 No.41 2차] WF5 — WORKFLOW 아웃풋을 가진 노드는 비종결·화살표 없음이라 자식 라벨 대신
            작은 아이콘 배지를 붙인다(ui-spec §3.8). 텍스트 대체("업무 요청")도 함께 표시한다. */}
        {node.hasWorkflowOutput && (
          <span className="flow-tree-workflow-badge" aria-label={MESSAGES.dialogue.flow.workflowOutputBadgeAriaLabel}>
            {' '}
            <span aria-hidden="true">🔗</span> {MESSAGES.dialogue.flow.workflowOutputBadgeLabel}
          </span>
        )}
      </button>
      {hasChildren && expanded && (
        <ul>
          {node.children.map((child) => (
            <FlowNodeItem key={`${child.nodeId}-${child.via}`} node={child} chatbotId={chatbotId} />
          ))}
        </ul>
      )}
    </li>
  );
}
