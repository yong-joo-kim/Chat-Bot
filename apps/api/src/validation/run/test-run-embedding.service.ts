import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeText } from '@chat-bot/shared-types';
import type { EmbeddingProvider } from '../../embedding/embedding-provider.port';

/**
 * 실행 로컬 배치 임베딩(J-8, ADR-0030 §2) — **`QueryEmbeddingService`를 주입하지 않는다.**
 * 전역 질의 임베딩 LRU 캐시에 접근할 수단이 이 서비스의 DI 그래프에 없으므로, 오염 코드가
 * 작성돼도 컴파일되지 않는다. `EmbeddingProviderFactory.getProvider()` → `provider.embed()`
 * 직접 배치 호출은 `ClassifierPredictService.predictBatch()`의 선례를 그대로 따른다.
 *
 * 실행 종료와 함께 반환된 `Map`은 GC되며, 이 서비스는 어떤 전역 상태도 갖지 않는다.
 */
@Injectable()
export class TestRunEmbeddingService {
  constructor(private readonly config: ConfigService) {}

  /**
   * 고유 정규화 문자열만 배치(기본 64건/회)로 임베딩한다(NFR-VP3). 2자 미만으로 정규화되는
   * 문장은 시도하지 않는다(운영 경로의 `EX-N1-6`과 동일 게이트). 배치 실패는 예외를 던지지 않고
   * 그 실행을 저하 모드로 흡수하도록 `null`을 반환한다(호출부가 `degradedMode`로 기록한다).
   */
  async embedUniqueTexts(provider: EmbeddingProvider, texts: readonly string[]): Promise<Map<string, Float32Array> | null> {
    const batchSize = this.config.get<number>('TEST_RUN_EMBED_BATCH_SIZE') ?? 64;
    const uniqueNormalized = [...new Set(texts.map((t) => normalizeText(t)).filter((t) => t.length >= 2))];
    const result = new Map<string, Float32Array>();
    if (uniqueNormalized.length === 0) return result;

    try {
      for (let i = 0; i < uniqueNormalized.length; i += batchSize) {
        const batch = uniqueNormalized.slice(i, i + batchSize);
        const vectors = await provider.embed(batch, 'QUERY');
        batch.forEach((text, idx) => {
          const vector = vectors[idx];
          if (vector) result.set(text, vector);
        });
      }
      return result;
    } catch {
      return null; // 배치 실패 — 실행 실패가 아니라 저하 모드로 흡수한다(EX-V-1, AC-V2-13).
    }
  }

  /** M2 오버레이 예문의 실행 시점 배치 임베딩(`PASSAGE`, FR-V2-13). 저장하지 않는다. */
  async embedPassages(provider: EmbeddingProvider, texts: readonly string[]): Promise<Float32Array[] | null> {
    if (texts.length === 0) return [];
    try {
      return await provider.embed([...texts], 'PASSAGE');
    } catch {
      return null;
    }
  }
}
