import { DialogOutputSchema, isApiConditionV2, renderApiTokens } from '@chat-bot/shared-types';
import type { ContextSessionState, DialogOutput, DialogOutputType, DialogueBundle, TraceStep } from '@chat-bot/shared-types';
import { DEFAULT_FALLBACK_RESPONSE, HOP_LIMIT, SESSION_SWITCH_MESSAGE, UNSUPPORTED_OUTPUT_NOTICE, API_FAILURE_NOTICE } from './constants';
import { promptOutputsForSlot, startContextSession } from './context-session';
import { bindRequest } from './api-call';
import type { ApiSuspensionRequest, CompletedFormInfo } from './api-call';

function textOutput(text: string): DialogOutput {
  return { type: 'TEXT', payload: { text } };
}

function truncateCodePoints(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('') : s;
}

/**
 * `{api.*}` 텍스트 치환(§8). 대상은 텍스트 필드만(`TEXT.text`·`CARD` 제목/설명·`BUTTON` 문구/라벨).
 * URL 필드·`MESSAGE`/`NODE` 버튼 값은 치환하지 않는다(AC-L3-9). 치환 후 필수 필드가 빈 문자열이 되면
 * 그 아웃풋을 버리고(`null`) `API_VALUE_DROPPED` trace를 남긴다.
 */
function applyApiVariables(output: DialogOutput, vars: Record<string, string>, trace: TraceStep[]): DialogOutput | null {
  switch (output.type) {
    case 'TEXT': {
      const text = truncateCodePoints(renderApiTokens(output.payload.text, vars), 1000);
      if (text.length === 0) {
        trace.push({ stage: 'API', code: 'API_VALUE_DROPPED', targetName: 'TEXT.text' });
        return null;
      }
      return { type: 'TEXT', payload: { text } };
    }
    case 'CARD': {
      const title = truncateCodePoints(renderApiTokens(output.payload.title, vars), 100);
      if (title.length === 0) {
        trace.push({ stage: 'API', code: 'API_VALUE_DROPPED', targetName: 'CARD.title' });
        return null;
      }
      const description =
        output.payload.description !== undefined ? truncateCodePoints(renderApiTokens(output.payload.description, vars), 500) : undefined;
      const buttons = output.payload.buttons
        ?.map((b) => ({ ...b, label: truncateCodePoints(renderApiTokens(b.label, vars), 40) }))
        .filter((b) => b.label.length > 0);
      return { type: 'CARD', payload: { ...output.payload, title, description, buttons } };
    }
    case 'BUTTON': {
      const text = output.payload.text !== undefined ? truncateCodePoints(renderApiTokens(output.payload.text, vars), 500) : undefined;
      const buttons = output.payload.buttons
        .map((b) => ({ ...b, label: truncateCodePoints(renderApiTokens(b.label, vars), 40) }))
        .filter((b) => b.label.length > 0);
      if (buttons.length === 0) {
        trace.push({ stage: 'API', code: 'API_VALUE_DROPPED', targetName: 'BUTTON.buttons' });
        return null;
      }
      return { type: 'BUTTON', payload: { text, buttons } };
    }
    default:
      return output;
  }
}

export interface ExecuteOutputsOptions {
  hopLimit?: number;
  /** CONTEXT_FORM 실행 시점에 이미 진행 중인 세션이 있으면 전환 고지를 출력한다(EX-S-7). */
  existingSession?: ContextSessionState | null;
  /** [No.26] 시작 아웃풋 목록의 소유 노드 id. `DIALOG_MOVE` 후에는 대상 노드 id로 바뀐다. */
  sourceNodeId?: string;
  /** [No.26] hop 초기값(재진입 시 이어서 센다). */
  initialHops?: number;
  /** [No.26] 이번 턴에 완료된 폼만 담는다(§5.3). */
  completedForm?: CompletedFormInfo;
  /** [No.26] `1`이면 v2 `API_CONDITION`에서 정지, `0`이면 턴당 1회 초과 처리. */
  apiCallsRemaining?: number;
  /** [No.26] 있으면 텍스트 필드 `{api.*}` 치환(§8). */
  apiVariables?: Record<string, string>;
}

export interface ExecuteOutputsResult {
  outputs: DialogOutput[];
  unsupportedOutputs: DialogOutputType[];
  nextSession: ContextSessionState | null;
  trace: TraceStep[];
  /** [No.26] v2 `API_CONDITION`에서 정지했을 때만 채워진다. */
  suspended?: ApiSuspensionRequest;
  /** [No.26] 최종 hop. */
  hops: number;
}

interface QueueItem {
  output: DialogOutput;
  nodeId: string;
  index: number;
}

/**
 * 노드 아웃풋 실행기(FR-E-5~7). `DIALOG_MOVE`는 hop limit(기본 10)로 무한루프를 차단하고,
 * `CONTEXT_FORM`은 세션을 시작한 뒤 남은 아웃풋을 버린다(다음 턴으로 이어짐).
 * [No.26] v2 `API_CONDITION`을 만나면 실행을 멈추고 `suspended`를 채운 뒤 반환한다(뒤 아웃풋 미실행) —
 * `resumeAfterApiCall`(엔진 밖 호출 뒤 재진입)이 나머지를 잇는다.
 * 어떤 경우에도 예외를 던지지 않고, 최소 1건의 아웃풋을 보장한다(FR-E-9, AC-E-10, 정지 시는 예외).
 */
export function executeOutputs(
  startOutputs: DialogOutput[],
  bundle: DialogueBundle,
  now: Date,
  opts: ExecuteOutputsOptions = {},
): ExecuteOutputsResult {
  const hopLimit = opts.hopLimit ?? HOP_LIMIT;
  const apiCallsRemaining = opts.apiCallsRemaining ?? 1;
  const out: DialogOutput[] = [];
  const unsupported: DialogOutputType[] = [];
  const trace: TraceStep[] = [];
  let nextSession: ContextSessionState | null = null;
  let hops = opts.initialHops ?? 0;
  let suspended: ApiSuspensionRequest | undefined;
  const sourceNodeId = opts.sourceNodeId ?? '';
  let queue: QueueItem[] = startOutputs.map((output, index) => ({ output, nodeId: sourceNodeId, index }));

  outer: while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const parsed = DialogOutputSchema.safeParse(item.output);
    if (!parsed.success) {
      trace.push({ stage: 'OUTPUT', code: 'PAYLOAD_INVALID' });
      continue;
    }
    const o = parsed.data;

    switch (o.type) {
      case 'TEXT':
      case 'CARD':
      case 'BUTTON': {
        if (opts.apiVariables) {
          const rendered = applyApiVariables(o, opts.apiVariables, trace);
          if (rendered) out.push(rendered);
        } else {
          out.push(o);
        }
        break;
      }

      case 'IMAGE':
      case 'LINK':
      case 'PAUSE':
      case 'PHONE_CALL':
        out.push(o);
        break;

      case 'CONTEXT_FORM': {
        const def = bundle.contexts.find((c) => c.id === o.payload.contextVariableId);
        if (!def) {
          trace.push({ stage: 'OUTPUT', code: 'BROKEN_REFERENCE', targetId: o.payload.contextVariableId });
          break;
        }
        if (opts.existingSession && opts.existingSession.status === 'IN_PROGRESS') {
          out.push(textOutput(SESSION_SWITCH_MESSAGE));
          trace.push({ stage: 'OUTPUT', code: 'SESSION_CANCELLED' });
        }
        nextSession = startContextSession(def, now);
        out.push(...promptOutputsForSlot(def.slots[0]));
        trace.push({ stage: 'OUTPUT', code: 'SESSION_ADVANCED', targetId: def.id, targetName: def.name });
        break outer;
      }

      case 'DIALOG_MOVE': {
        hops += 1;
        if (hops > hopLimit) {
          trace.push({ stage: 'OUTPUT', code: 'HOP_LIMIT_EXCEEDED' });
          out.push(textOutput('요청을 처리하는 중 이동이 너무 많아 중단했어요. 다시 시도해 주세요.'));
          break outer;
        }
        const target = bundle.dialogNodes.find((n) => n.id === o.payload.targetNodeId && n.enabled);
        if (!target) {
          trace.push({ stage: 'OUTPUT', code: 'BROKEN_REFERENCE', targetId: o.payload.targetNodeId });
          break;
        }
        queue = target.outputs.map((output, index) => ({ output, nodeId: target.id, index }));
        break;
      }

      case 'SCENARIO':
      case 'SURVEY':
        unsupported.push(o.type);
        trace.push({ stage: 'OUTPUT', code: 'UNSUPPORTED_OUTPUT', targetId: o.type });
        break;

      case 'API_CONDITION': {
        if (!isApiConditionV2(o.payload)) {
          unsupported.push(o.type);
          trace.push({ stage: 'OUTPUT', code: 'UNSUPPORTED_OUTPUT', targetId: o.type });
          break;
        }
        const payload = o.payload;
        if (apiCallsRemaining >= 1) {
          const request = bindRequest(payload, opts.completedForm);
          trace.push({ stage: 'API', code: 'API_CALL_REQUESTED', targetId: payload.connectionId });
          suspended = { nodeId: item.nodeId, outputIndex: item.index, payload, request };
          break outer;
        }
        // 턴당 1회 초과(§5.2 ③)
        trace.push({ stage: 'API', code: 'API_CALL_LIMIT', targetId: payload.connectionId });
        const failureTarget = payload.failureNodeId
          ? bundle.dialogNodes.find((n) => n.id === payload.failureNodeId && n.enabled)
          : undefined;
        if (failureTarget) {
          hops += 1;
          if (hops > hopLimit) {
            trace.push({ stage: 'OUTPUT', code: 'HOP_LIMIT_EXCEEDED' });
            out.push(textOutput('요청을 처리하는 중 이동이 너무 많아 중단했어요. 다시 시도해 주세요.'));
            break outer;
          }
          queue = failureTarget.outputs.map((output, index) => ({ output, nodeId: failureTarget.id, index }));
          break;
        }
        trace.push({ stage: 'API', code: 'API_FIXED_NOTICE', message: 'CALL_LIMIT' });
        out.push(textOutput(API_FAILURE_NOTICE));
        break outer;
      }
    }
  }

  if (!suspended && out.length === 0) {
    trace.push({ stage: 'OUTPUT', code: 'EMPTY_OUTPUT' });
    out.push(textOutput(unsupported.length > 0 ? UNSUPPORTED_OUTPUT_NOTICE : DEFAULT_FALLBACK_RESPONSE));
  }

  return { outputs: out, unsupportedOutputs: unsupported, nextSession, trace, suspended, hops };
}
