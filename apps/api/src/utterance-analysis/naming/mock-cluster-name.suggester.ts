import type { ClusterNameSuggester, ClusterNameSuggestInput } from './cluster-name-suggester.port';

/** 시험·CI용 — 결정론적 "키워드1 키워드2 문의". 네트워크 호출 0. */
export class MockClusterNameSuggester implements ClusterNameSuggester {
  readonly suggesterId = 'mock' as const;

  async suggest(input: ClusterNameSuggestInput): Promise<string | null> {
    const words = input.keywords.slice(0, 2);
    if (words.length === 0) return null;
    return `${words.join(' ')} 문의`;
  }
}
