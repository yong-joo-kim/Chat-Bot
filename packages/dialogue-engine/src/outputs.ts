import { DialogOutputSchema } from '@chat-bot/shared-types';
import type { ContextSessionState, DialogOutput, DialogOutputType, DialogueBundle, TraceStep } from '@chat-bot/shared-types';
import { DEFAULT_FALLBACK_RESPONSE, HOP_LIMIT, SESSION_SWITCH_MESSAGE, UNSUPPORTED_OUTPUT_NOTICE } from './constants';
import { promptOutputsForSlot, startContextSession } from './context-session';

function textOutput(text: string): DialogOutput {
  return { type: 'TEXT', payload: { text } };
}

export interface ExecuteOutputsOptions {
  hopLimit?: number;
  /** CONTEXT_FORM 실행 시점에 이미 진행 중인 세션이 있으면 전환 고지를 출력한다(EX-S-7). */
  existingSession?: ContextSessionState | null;
}

export interface ExecuteOutputsResult {
  outputs: DialogOutput[];
  unsupportedOutputs: DialogOutputType[];
  nextSession: ContextSessionState | null;
  trace: TraceStep[];
}

/**
 * 노드 아웃풋 실행기(FR-E-5~7). `DIALOG_MOVE`는 hop limit(기본 10)로 무한루프를 차단하고,
 * `CONTEXT_FORM`은 세션을 시작한 뒤 남은 아웃풋을 버린다(다음 턴으로 이어짐).
 * 어떤 경우에도 예외를 던지지 않고, 최소 1건의 아웃풋을 보장한다(FR-E-9, AC-E-10).
 */
export function executeOutputs(
  startOutputs: DialogOutput[],
  bundle: DialogueBundle,
  now: Date,
  opts: ExecuteOutputsOptions = {},
): ExecuteOutputsResult {
  const hopLimit = opts.hopLimit ?? HOP_LIMIT;
  const out: DialogOutput[] = [];
  const unsupported: DialogOutputType[] = [];
  const trace: TraceStep[] = [];
  let nextSession: ContextSessionState | null = null;
  let hops = 0;
  let queue: DialogOutput[] = [...startOutputs];

  outer: while (queue.length > 0) {
    const candidate = queue.shift();
    const parsed = DialogOutputSchema.safeParse(candidate);
    if (!parsed.success) {
      trace.push({ stage: 'OUTPUT', code: 'PAYLOAD_INVALID' });
      continue;
    }
    const o = parsed.data;

    switch (o.type) {
      case 'TEXT':
      case 'CARD':
      case 'IMAGE':
      case 'BUTTON':
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
        queue = [...target.outputs];
        break;
      }

      case 'SCENARIO':
      case 'SURVEY':
      case 'API_CONDITION':
        unsupported.push(o.type);
        trace.push({ stage: 'OUTPUT', code: 'UNSUPPORTED_OUTPUT', targetId: o.type });
        break;
    }
  }

  if (out.length === 0) {
    trace.push({ stage: 'OUTPUT', code: 'EMPTY_OUTPUT' });
    out.push(textOutput(unsupported.length > 0 ? UNSUPPORTED_OUTPUT_NOTICE : DEFAULT_FALLBACK_RESPONSE));
  }

  return { outputs: out, unsupportedOutputs: unsupported, nextSession, trace };
}
