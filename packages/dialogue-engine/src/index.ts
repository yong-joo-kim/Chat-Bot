export { matchIntent, matchFaq, simulate } from './matcher';
export type { IntentMatch, FaqMatch, MatchIntentOptions } from './matcher';

export { resolveResponse, resolveByNodeId } from './resolver';
export type { ResolveOptions } from './resolver';

export { resolveTurn } from './turn';
export type { DialogueTurnInput, DialogueTurnResult } from './turn';

export { sanitizeConversationState } from './conversation-state';
export type { SanitizeConversationStateOptions, SanitizeConversationStateResult } from './conversation-state';

export { mergeOverlay } from './overlay';
export type { BundleOverlayPatch, OverlayDeletedIds } from './overlay';

export { resolveHomonym, buildClarifyOutput } from './homonym';
export type { HomonymEvaluation, HomonymResolutionResult } from './homonym';

export { advanceContextSession, startContextSession, validateSlotValue, promptOutputsForSlot } from './context-session';
export type { AdvanceResult, SlotValueResult } from './context-session';

export { matchFaqEntry, suggestSimilarFaqs } from './faq';
export type { FaqMatchResult, FaqSuggestionResult } from './faq';

export { executeOutputs } from './outputs';
export type { ExecuteOutputsOptions, ExecuteOutputsResult } from './outputs';

export { evaluateNode, rankNodes } from './node-matcher';
export type { EngineContext, NodeEvaluation, BrokenReference } from './node-matcher';

export { validateDialogueDesign, computeIncomingCounts, getOutgoingNodeRefs } from './design-validator';

export { buildFlowTree } from './flow-tree';

export { buildDialogueIndex } from './dialogue-index';
export type { DialogueIndex } from './dialogue-index';

export { normalizeText, tokenize, jaccard, containsWord } from './normalize';

export * from './constants';
