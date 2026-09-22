import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RAG_PATHS } from './lib/rag-paths';
import type { RagPathKey } from './lib/rag-paths';

/**
 * `provider`는 상수로 고정한다(J-6, FR-N2-6) — 요청 DTO·설정·환경변수 어디에도 이 필드를
 * 받는 곳이 없다. "받지 않으면 사고가 원천 차단된다."
 */
const RAG_PROVIDER = 'pdf' as const;

const MAX_QUESTION_LENGTH = 200;
const MAX_SCOPE_LENGTH = 200;

export interface RagQueryInput {
  /** 이미 PII 마스킹·길이 절단이 끝난 문장이어야 한다(호출부 책임, FR-N2-14). */
  question: string;
  company: string;
  category?: string;
  subcategory?: string;
  similarityThreshold?: number;
}

export type RagSendResult = { networkError: false; httpStatus: number; body: unknown } | { networkError: true };

/**
 * 외부 RAG 서버로 나가는 **유일한 출구**(ADR-0022, DD-77). 공개 메서드는 정확히 3개이며
 * 경로를 인자로 받는 메서드는 존재하지 않는다 — `send()`는 `private`이고 파라미터 타입이
 * `RagPathKey`라 임의 문자열이 컴파일되지 않는다(불변식 1). `RAG_BASE_URL` 미설정 시
 * 호출 자체를 시도하지 않는다(FR-N2-11).
 */
@Injectable()
export class RagHttpClient {
  private readonly logger = new Logger('RagHttpClient');

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!this.config.get<string>('RAG_BASE_URL');
  }

  async query(input: RagQueryInput, timeoutMs: number): Promise<RagSendResult> {
    const body: Record<string, unknown> = {
      question: input.question.slice(0, MAX_QUESTION_LENGTH),
      company: input.company.slice(0, MAX_SCOPE_LENGTH),
      provider: RAG_PROVIDER,
    };
    if (input.category) body.category = input.category.slice(0, MAX_SCOPE_LENGTH);
    if (input.subcategory) body.subcategory = input.subcategory.slice(0, MAX_SCOPE_LENGTH);
    // §6-1 권고: 특별한 이유가 없으면 이 필드를 아예 보내지 말 것 — null/undefined면 키 자체를 넣지 않는다(FR-N2-8).
    if (input.similarityThreshold !== undefined) body.similarity_threshold = input.similarityThreshold;

    return this.send('QUERY', 'POST', body, timeoutMs);
  }

  async status(timeoutMs = 5000): Promise<RagSendResult> {
    return this.send('STATUS', 'GET', undefined, timeoutMs);
  }

  async documentMetadata(timeoutMs = 5000): Promise<RagSendResult> {
    return this.send('DOCUMENT_METADATA', 'GET', undefined, timeoutMs);
  }

  /** ★ 경로를 문자열로 받지 않는다 — `RagPathKey`(allowlist 3개의 키)만 받는다. */
  private async send(key: RagPathKey, method: 'GET' | 'POST', body: unknown, timeoutMs: number): Promise<RagSendResult> {
    const baseUrl = this.config.get<string>('RAG_BASE_URL');
    if (!baseUrl) return { networkError: true };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}${RAG_PATHS[key]}`, {
        method,
        // §0-2: 헤더를 빠뜨리면 본문이 무시되고 쿼리스트링을 읽는다 — 항상 명시한다(불변식 3).
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      return { networkError: false, httpStatus: res.status, body: json };
    } catch (e) {
      // 타임아웃(AbortError) 포함 — 네트워크 계열 예외는 전부 `networkError`로 수렴한다.
      this.logger.warn(`RAG 서버 호출 실패(${key}): ${e instanceof Error ? e.message : 'unknown'}`);
      return { networkError: true };
    } finally {
      clearTimeout(timer);
    }
  }
}
