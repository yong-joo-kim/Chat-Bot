import type { DialogOutput, HomonymDictionary, HomonymMeaning, HomonymPolicy } from '@chat-bot/shared-types';
import { containsWord, normalizeText } from './normalize';

export interface HomonymResolutionResult {
  word: string;
  status: 'RESOLVED' | 'AMBIGUOUS' | 'IGNORED';
  meaningLabel?: string;
  intentId?: string;
  matchedHints: string[];
}

export interface HomonymEvaluation {
  resolution: HomonymResolutionResult | null;
  policy?: HomonymPolicy;
  homonymId?: string;
  clarifyPrompt?: string;
  meanings?: HomonymMeaning[];
}

/**
 * 동음이의어 사전을 입력 문장에 적용해 의미를 판정한다(FR-7-1~9, §7.3 S2).
 * 여러 사전 단어가 동시에 등장하면 사전 배열 순서상 첫 매치를 사용한다(결정성 보장).
 */
export function resolveHomonym(normalizedInput: string, homonyms: HomonymDictionary[]): HomonymEvaluation {
  for (const dict of homonyms) {
    const wordNorm = normalizeText(dict.word);
    if (!containsWord(normalizedInput, wordNorm)) continue;

    const matchedIdx: number[] = [];
    const hintsByMeaning: string[][] = dict.meanings.map(() => []);
    dict.meanings.forEach((meaning, idx) => {
      for (const hint of meaning.contextHints) {
        if (containsWord(normalizedInput, normalizeText(hint))) {
          hintsByMeaning[idx].push(hint);
        }
      }
      if (hintsByMeaning[idx].length > 0) matchedIdx.push(idx);
    });

    if (matchedIdx.length === 1) {
      const idx = matchedIdx[0];
      const meaning = dict.meanings[idx];
      return {
        resolution: {
          word: dict.word,
          status: 'RESOLVED',
          meaningLabel: meaning.label,
          intentId: meaning.intentId,
          matchedHints: hintsByMeaning[idx],
        },
        policy: dict.policy,
        homonymId: dict.id,
        clarifyPrompt: dict.clarifyPrompt,
        meanings: dict.meanings,
      };
    }

    // 힌트가 0건이거나 2건 이상 충돌 — 모호(AC-7-4). 정책에 따라 분기한다.
    if (dict.policy === 'IGNORE') {
      return { resolution: { word: dict.word, status: 'IGNORED', matchedHints: [] }, policy: dict.policy, homonymId: dict.id };
    }

    if (
      dict.policy === 'DEFAULT_MEANING' &&
      dict.defaultMeaningIndex !== undefined &&
      dict.defaultMeaningIndex !== null &&
      dict.meanings[dict.defaultMeaningIndex]
    ) {
      const meaning = dict.meanings[dict.defaultMeaningIndex];
      return {
        resolution: {
          word: dict.word,
          status: 'RESOLVED',
          meaningLabel: meaning.label,
          intentId: meaning.intentId,
          matchedHints: [],
        },
        policy: dict.policy,
        homonymId: dict.id,
        clarifyPrompt: dict.clarifyPrompt,
        meanings: dict.meanings,
      };
    }

    return {
      resolution: { word: dict.word, status: 'AMBIGUOUS', matchedHints: [] },
      policy: dict.policy,
      homonymId: dict.id,
      clarifyPrompt: dict.clarifyPrompt,
      meanings: dict.meanings,
    };
  }

  return { resolution: null };
}

/** `ASK` 정책의 모호 판정을 기존 `BUTTON` 아웃풋으로 표현한다(FR-7-8 — 새 아웃풋 타입 금지). */
export function buildClarifyOutput(evaluation: HomonymEvaluation): DialogOutput {
  const word = evaluation.resolution?.word ?? '';
  const prompt = evaluation.clarifyPrompt?.trim() || `어떤 '${word}'를 말씀하시는 건가요?`;
  const buttons = (evaluation.meanings ?? []).slice(0, 5).map((meaning) => ({
    label: meaning.label,
    action: 'MESSAGE' as const,
    value: meaning.label,
  }));
  return { type: 'BUTTON', payload: { text: prompt, buttons } };
}
