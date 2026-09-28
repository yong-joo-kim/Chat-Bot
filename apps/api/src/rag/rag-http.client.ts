import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertEgressAllowed, assertNoRedirectResponse, egressRedirectMode } from '../common/egress/egress-guard';
import { RAG_PATHS } from './lib/rag-paths';
import type { RagPathKey } from './lib/rag-paths';
import { toRagTaskId } from './lib/rag-task-id';
import type { RagTaskId } from './lib/rag-task-id';
import { parseRetryAfterMs } from './lib/retry-after';

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

export type RagSendResult = { networkError: false; httpStatus: number; body: unknown; retryAfterMs: number | null } | { networkError: true };

/** [신규 No.43] 적재 파일 — `kb-sync/lib/external-file-name.ts`가 만든 결정적 이름을 담는다(§5.4). */
export interface RagIngestFile {
  name: string;
  bytes: Uint8Array;
  contentType: string;
}

/** [신규 No.43] 적재 입력 — 필드는 이 4개뿐이다(§5.2 · KB-4). 서버 임의 경로 지정·동기 처리 옵션 필드는 받지 않는다. */
export interface RagIngestInput {
  file: RagIngestFile;
  company: string;
  category: string;
  subcategory: string;
}

type RagBody = { kind: 'JSON'; value: unknown } | { kind: 'MULTIPART'; form: FormData };

/**
 * 외부 RAG 서버로 나가는 **유일한 출구**(ADR-0022, DD-77). 공개 메서드는 정확히 5개(No.43 — 적재·
 * 작업 개별 조회 추가)이며 경로를 인자로 받는 메서드는 존재하지 않는다 — `send()`는 `private`이고
 * 파라미터 타입이 `RagPathKey`라 임의 문자열이 컴파일되지 않는다(불변식 1). `RAG_BASE_URL` 미설정 시
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

    return this.send('QUERY', 'POST', { kind: 'JSON', value: body }, timeoutMs);
  }

  async status(timeoutMs = 5000): Promise<RagSendResult> {
    return this.send('STATUS', 'GET', undefined, timeoutMs);
  }

  async documentMetadata(timeoutMs = 5000): Promise<RagSendResult> {
    return this.send('DOCUMENT_METADATA', 'GET', undefined, timeoutMs);
  }

  /**
   * [신규 No.43] 적재(§5.2 · ADR-0044) — `FormData` 4필드(`file`·`company`·`category`·`subcategory`)
   * 뿐이며 동기 처리 옵션은 보내지 않는다(기본 비동기). 호출부는 `kb-sync/engine/kb-ingest.runner.ts`
   * 1파일이다(KB-6).
   */
  async ingest(input: RagIngestInput, timeoutMs = 120_000): Promise<RagSendResult> {
    const form = new FormData();
    form.append('file', new Blob([input.file.bytes], { type: input.file.contentType }), input.file.name);
    form.append('company', input.company);
    form.append('category', input.category);
    form.append('subcategory', input.subcategory);
    return this.send('INGEST', 'POST', { kind: 'MULTIPART', form }, timeoutMs);
  }

  /**
   * [신규 No.43] 작업 개별 조회(§5.2) — `taskId`가 UUID 형식이 아니면 `fetch` 없이 네트워크 오류로
   * 수렴한다(KB-5 — 비UUID·경로 문자 입력에 송신 0).
   */
  async taskStatus(taskId: string, timeoutMs = 10_000): Promise<RagSendResult> {
    const id = toRagTaskId(taskId);
    if (!id) return { networkError: true };
    return this.send('TASK_STATUS', 'GET', undefined, timeoutMs, id);
  }

  /** ★ 경로를 문자열로 받지 않는다 — `RagPathKey`(allowlist 5개의 키)만 받는다. */
  private async send(key: RagPathKey, method: 'GET' | 'POST', body: RagBody | undefined, timeoutMs: number, pathSuffix?: RagTaskId): Promise<RagSendResult> {
    const baseUrl = this.config.get<string>('RAG_BASE_URL');
    if (!baseUrl) return { networkError: true };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${baseUrl}${RAG_PATHS[key]}${pathSuffix ?? ''}`;
      assertEgressAllowed('RAG', url);
      const res = await fetch(url, {
        method,
        // §0-2: JSON 본문은 헤더를 명시해야 한다(불변식 3). 멀티파트는 경계 문자열을 `fetch`가
        // 만들도록 헤더를 지정하지 않는다(§5.2).
        ...(body?.kind === 'JSON' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body.value) } : {}),
        ...(body?.kind === 'MULTIPART' ? { body: body.form } : {}),
        signal: controller.signal,
        redirect: egressRedirectMode(),
      });
      // [신규 No.45] M-1 — 허용 호스트가 비허용 호스트로 리다이렉트하는 우회를 차단한다.
      // 기존 RAG 실패 경로(networkError:true)로 흡수한다(§6.3의 "네트워크 계열 예외" 규약과 동일).
      assertNoRedirectResponse('RAG', url, res.status);
      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      // [신규 No.43 — 항목⑤] 429·503 응답의 Retry-After를 반영한다(§9.5 — 값이 있으면 고정 백오프보다 우선).
      const retryAfterMs = res.status === 429 || res.status === 503 ? parseRetryAfterMs(res.headers?.get('retry-after'), new Date()) : null;
      return { networkError: false, httpStatus: res.status, body: json, retryAfterMs };
    } catch (e) {
      // 타임아웃(AbortError) 포함 — 네트워크 계열 예외는 전부 `networkError`로 수렴한다.
      // 오류 원문(`message`)은 남기지 않는다 — 적재(No.43)도 이 출구를 쓰고, 원문에는 주소·응답 조각이 섞일 수 있다(KB-15). 오류 이름만.
      this.logger.warn(`RAG 서버 호출 실패(${key}): ${e instanceof Error ? e.name : 'unknown'}`);
      return { networkError: true };
    } finally {
      clearTimeout(timer);
    }
  }
}
