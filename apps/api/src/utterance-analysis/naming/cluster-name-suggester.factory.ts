import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isNameSuggestAvailable, readUtteranceAnalysisConfig } from '../utterance-analysis.config';
import { ClusterNameHttpClient } from './cluster-name-http.client';
import type { ClusterNameSuggester } from './cluster-name-suggester.port';

/**
 * 이름 제안 구현 **교체 지점 1곳**(No.21 — 설계서 §16.2). 꺼짐이면 인스턴스를 만들지 않는다(`undefined` —
 * 생성 백엔드 호출 0, AC-DC6-1). 시험이 `mock`을 쓰려면 이 클래스를 provider 덮어쓰기로 교체한다.
 */
@Injectable()
export class ClusterNameSuggesterFactory {
  constructor(private readonly config: ConfigService) {}

  /** 이 서버에서 이름 제안이 가용한가(설정 켬 ∧ 로컬 생성기 주소 있음 — 네트워크 확인 없음). */
  isAvailable(): boolean {
    return isNameSuggestAvailable(readUtteranceAnalysisConfig(this.config));
  }

  create(): ClusterNameSuggester | undefined {
    const cfg = readUtteranceAnalysisConfig(this.config);
    if (!isNameSuggestAvailable(cfg)) return undefined;
    return new ClusterNameHttpClient({ baseUrl: cfg.nameSuggestBaseUrl as string, timeoutMs: cfg.nameSuggestTimeoutMs });
  }
}
