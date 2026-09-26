import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { maskPii } from '@chat-bot/pii-mask';
import { resumeAfterApiCall } from '@chat-bot/dialogue-engine';
import type { ApiCallSuspension, ApiBoundValue, DialogueTurnResult } from '@chat-bot/dialogue-engine';
import type {
  ApiCallOutcome,
  ApiCallResult,
  ApiCallSource,
  ApiConnectionAuthType,
  ApiConnectionTestResult,
  ApiSecretStatus,
  DialogueBundle,
} from '@chat-bot/shared-types';
import { ApiException } from '../common/api.exception';
import { ApiConnectionCatalogService } from '../api-connections/catalog/api-connection-catalog.service';
import { ApiCallLogService } from './api-call-log.service';
import { LegacyApiGateService } from './legacy-api-gate.service';
import { LegacyApiHttpClient } from './legacy-api-http.client';
import { LegacyApiSecretResolver } from './legacy-api-secret.resolver';
import { buildLegacyRequest } from './lib/build-request';
import { classifyOutcome } from './lib/outcome-class';
import { isJsonContentType, parseJsonBody } from './lib/response-check';

export interface CompleteTurnContext {
  chatbotId: string | null;
  conversationLogId?: string | null;
  source: ApiCallSource;
  bundle: DialogueBundle;
  now: Date;
}

const DEFAULT_MAX_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 262_144;

/**
 * [No.26] 외부 호출 서비스 — 턴 완결(§7.1) · 연결 테스트(§7.9) · 관리 화면이 필요로 하는 상태
 * 파생값(`secretStatus`·`isCircuitOpen`)의 유일한 창구(다른 모듈은 이 서비스만 주입할 수 있다 — L-4).
 * 어떤 단계의 예외도 삼켜 실패로 수렴한다(엔진 가용성 규약과 대칭).
 */
@Injectable()
export class LegacyApiService {
  private readonly logger = new Logger('LegacyApiService');

  constructor(
    private readonly config: ConfigService,
    private readonly catalog: ApiConnectionCatalogService,
    private readonly gate: LegacyApiGateService,
    private readonly httpClient: LegacyApiHttpClient,
    private readonly secretResolver: LegacyApiSecretResolver,
    private readonly callLogService: ApiCallLogService,
  ) {}

  secretStatus(authType: ApiConnectionAuthType, secretRef: string | null): ApiSecretStatus {
    return this.secretResolver.status(authType, secretRef);
  }

  isCircuitOpen(connectionId: string): boolean {
    return this.gate.isCircuitOpen(connectionId);
  }

  /** `resolveTurn()`이 반환한 정지 동봉본을 실제 호출로 완결한다(§6.1). `apiCall`이 없으면 그대로 반환. */
  async completeTurn(result: DialogueTurnResult, ctx: CompleteTurnContext): Promise<DialogueTurnResult> {
    const suspension = result.apiCall;
    if (!suspension) return result;
    const startedAt = Date.now();

    try {
      if (!(this.config.get<boolean>('LEGACY_API_ENABLED') ?? true)) {
        return this.finishWithFailure(result, suspension, ctx, 'FEATURE_DISABLED', startedAt);
      }
      if (!suspension.request) {
        return this.finishWithFailure(result, suspension, ctx, 'BINDING_MISSING', startedAt);
      }

      const connection = await this.catalog.findForCall(suspension.payload.connectionId);
      if (!connection) return this.finishWithFailure(result, suspension, ctx, 'CONNECTION_MISSING', startedAt);
      if (!connection.enabled) return this.finishWithFailure(result, suspension, ctx, 'CONNECTION_DISABLED', startedAt, connection.name);
      if (!connection.allowedMethods.includes(suspension.request.method)) {
        return this.finishWithFailure(result, suspension, ctx, 'METHOD_NOT_ALLOWED', startedAt, connection.name);
      }
      if (connection.authType !== 'NONE' && this.secretResolver.status(connection.authType as ApiConnectionAuthType, connection.secretRef) === 'MISSING') {
        return this.finishWithFailure(result, suspension, ctx, 'SECRET_MISSING', startedAt, connection.name);
      }

      const acquired = this.gate.tryAcquire(connection.id, connection.rateLimitPerMin);
      if (!acquired.ok) {
        return this.finishWithFailure(result, suspension, ctx, acquired.outcome, startedAt, connection.name);
      }

      let gateClass: ReturnType<typeof classifyOutcome> = 'NEUTRAL';
      try {
        let personalDataMasked = false;
        const maskValue = (v: ApiBoundValue): string => {
          if (connection.allowRawPersonalData || v.source !== 'SLOT') return v.value;
          const masked = maskPii(v.value);
          if (masked.maskedText !== v.value) personalDataMasked = true;
          return masked.maskedText;
        };

        const built = buildLegacyRequest({
          baseUrl: connection.baseUrl,
          method: suspension.request.method,
          pathTemplate: suspension.request.pathTemplate,
          pathValues: suspension.request.pathValues.map(maskValue),
          query: suspension.request.query.map((q) => ({ name: q.name, value: maskValue(q.value) })),
          body: suspension.request.body.map((b) => ({ field: b.field, value: maskValue(b.value) })),
        });
        if (!built.ok) {
          return this.finishWithFailure(result, suspension, ctx, 'BLOCKED_URL', startedAt, connection.name, personalDataMasked);
        }

        const effectiveTimeout = Math.min(connection.timeoutMs, this.config.get<number>('LEGACY_API_MAX_TIMEOUT_MS') ?? DEFAULT_MAX_TIMEOUT_MS);
        const maxBytes = this.config.get<number>('LEGACY_API_MAX_RESPONSE_BYTES') ?? DEFAULT_MAX_RESPONSE_BYTES;

        const httpResult = await this.httpClient.send(
          built.request,
          { authType: connection.authType as ApiConnectionAuthType, authHeaderName: connection.authHeaderName, secretRef: connection.secretRef },
          { timeoutMs: effectiveTimeout, maxBytes },
        );

        let apiResult: ApiCallResult;
        let outcome: ApiCallOutcome;
        let httpStatus: number | undefined;
        let responseBytes: number | undefined;

        if (httpResult.kind === 'ERROR') {
          outcome = httpResult.outcome;
          apiResult = { kind: 'FAILURE', outcome };
        } else {
          httpStatus = httpResult.status;
          responseBytes = httpResult.bytes;
          if (httpStatus < 200 || httpStatus >= 300) {
            outcome = 'HTTP_ERROR';
            apiResult = { kind: 'FAILURE', outcome, httpStatus };
          } else if (!isJsonContentType(httpResult.contentType)) {
            outcome = 'INVALID_RESPONSE';
            apiResult = { kind: 'FAILURE', outcome };
          } else {
            const parsed = parseJsonBody(httpResult.body.toString('utf8'));
            if (!parsed.ok) {
              outcome = 'INVALID_RESPONSE';
              apiResult = { kind: 'FAILURE', outcome };
            } else {
              outcome = 'SUCCESS';
              apiResult = { kind: 'SUCCESS', httpStatus, json: parsed.json };
            }
          }
        }

        gateClass = classifyOutcome(outcome, httpStatus);

        const resumed = resumeAfterApiCall(result as DialogueTurnResult & { apiCall: ApiCallSuspension }, apiResult, ctx.bundle, ctx.now);

        this.callLogService.record({
          chatbotId: ctx.chatbotId,
          connectionId: connection.id,
          connectionName: connection.name,
          nodeId: suspension.nodeId,
          conversationLogId: ctx.conversationLogId,
          source: ctx.source,
          method: suspension.request.method,
          pathTemplate: suspension.request.pathTemplate,
          outcome,
          httpStatus,
          latencyMs: Date.now() - startedAt,
          responseBytes,
          branch: resumed.apiStep?.branch,
          conditionIndex: resumed.apiStep?.conditionIndex,
          personalDataMasked,
        });

        return resumed;
      } finally {
        this.gate.release(connection.id, gateClass);
      }
    } catch (e) {
      // ⚠ 예외 message를 로그에 넣지 않는다(호스트 내부 경로·해석된 URL이 섞일 수 있다, FR-0-105).
      this.logger.warn(`레거시 API 처리 중 예외 발생(connectionId=${suspension.payload.connectionId}, name=${e instanceof Error ? e.name : 'unknown'})`);
      return this.finishWithFailure(result, suspension, ctx, 'NETWORK_ERROR', startedAt);
    }
  }

  /** 외부 호출 0(§7.1 표 "실패 결과") 경로 공용 — trace·outputs를 재진입 규약대로 확정하고 메타데이터만 기록한다. */
  private finishWithFailure(
    result: DialogueTurnResult,
    suspension: ApiCallSuspension,
    ctx: CompleteTurnContext,
    outcome: Exclude<ApiCallOutcome, 'SUCCESS' | 'MAPPING_MISSING'>,
    startedAt: number,
    connectionName?: string,
    personalDataMasked = false,
  ): DialogueTurnResult {
    const resumed = resumeAfterApiCall(result as DialogueTurnResult & { apiCall: ApiCallSuspension }, { kind: 'FAILURE', outcome }, ctx.bundle, ctx.now);
    this.callLogService.record({
      chatbotId: ctx.chatbotId,
      connectionId: suspension.payload.connectionId,
      connectionName: connectionName ?? suspension.payload.connectionId,
      nodeId: suspension.nodeId,
      conversationLogId: ctx.conversationLogId,
      source: ctx.source,
      method: suspension.payload.method,
      pathTemplate: suspension.payload.path,
      outcome,
      latencyMs: Date.now() - startedAt,
      branch: resumed.apiStep?.branch,
      conditionIndex: resumed.apiStep?.conditionIndex,
      personalDataMasked,
    });
    return resumed;
  }

  /** 연결 테스트(§7.9) — 대화 경로와 같은 조립기·클라이언트·IP 정책·타임아웃·크기 상한을 쓴다(AC-L4-8). */
  async testConnection(connectionId: string, path: string): Promise<ApiConnectionTestResult> {
    const startedAt = Date.now();
    if (!(this.config.get<boolean>('LEGACY_API_ENABLED') ?? true)) {
      return {
        outcome: 'FEATURE_DISABLED',
        latencyMs: 0,
        jsonParsable: false,
        guidance: '레거시 API 연동이 비활성화되어 있습니다(LEGACY_API_ENABLED). 서버 운영자에게 문의하세요.',
      };
    }

    const connection = await this.catalog.findForCall(connectionId);
    if (!connection) throw new ApiException('NOT_FOUND', 404, '요청하신 연결을 찾을 수 없습니다.');

    const built = buildLegacyRequest({ baseUrl: connection.baseUrl, method: 'GET', pathTemplate: path, pathValues: [], query: [], body: [] });
    if (!built.ok) {
      return { outcome: 'BLOCKED_URL', latencyMs: 0, jsonParsable: false, guidance: '요청 경로 형식이 올바르지 않습니다. 경로를 다시 확인해 주세요.' };
    }

    const acquired = this.gate.tryAcquire(connection.id, connection.rateLimitPerMin, { bypass: true });
    if (!acquired.ok) {
      return {
        outcome: 'RATE_LIMITED',
        latencyMs: 0,
        jsonParsable: false,
        guidance: '지금은 동시에 진단할 수 있는 요청 수를 초과했습니다. 잠시 후 다시 시도해 주세요.',
      };
    }

    try {
      const effectiveTimeout = Math.min(connection.timeoutMs, this.config.get<number>('LEGACY_API_MAX_TIMEOUT_MS') ?? DEFAULT_MAX_TIMEOUT_MS);
      const maxBytes = this.config.get<number>('LEGACY_API_MAX_RESPONSE_BYTES') ?? DEFAULT_MAX_RESPONSE_BYTES;
      const httpResult = await this.httpClient.send(
        built.request,
        { authType: connection.authType as ApiConnectionAuthType, authHeaderName: connection.authHeaderName, secretRef: connection.secretRef },
        { timeoutMs: effectiveTimeout, maxBytes },
      );
      const latencyMs = Date.now() - startedAt;

      let response: ApiConnectionTestResult;
      if (httpResult.kind === 'ERROR') {
        response = {
          outcome: httpResult.outcome,
          latencyMs,
          jsonParsable: false,
          blockedAddress: httpResult.blockedAddress,
          guidance: this.guidanceFor(httpResult.outcome, httpResult.blockedAddress),
        };
      } else {
        const jsonParsable = isJsonContentType(httpResult.contentType) && parseJsonBody(httpResult.body.toString('utf8')).ok;
        const outcome: ApiCallOutcome = httpResult.status >= 200 && httpResult.status < 300 ? 'SUCCESS' : 'HTTP_ERROR';
        response = {
          outcome,
          httpStatus: httpResult.status,
          latencyMs,
          contentType: httpResult.contentType,
          bytes: httpResult.bytes,
          jsonParsable,
          guidance: this.guidanceFor(outcome),
        };
      }

      this.callLogService.record({
        chatbotId: null,
        connectionId: connection.id,
        connectionName: connection.name,
        source: 'CONNECTION_TEST',
        method: 'GET',
        pathTemplate: path,
        outcome: response.outcome,
        httpStatus: response.httpStatus,
        latencyMs,
        responseBytes: response.bytes,
        personalDataMasked: false,
      });

      return response;
    } finally {
      this.gate.release(connection.id, 'NEUTRAL', { bypass: true });
    }
  }

  private guidanceFor(outcome: ApiCallOutcome, blockedAddress?: string): string {
    switch (outcome) {
      case 'SUCCESS':
        return '정상적으로 응답을 받았습니다.';
      case 'HTTP_ERROR':
        return '대상 서버가 오류 상태 코드를 반환했습니다. 경로와 서버 상태를 확인하세요.';
      case 'TIMEOUT':
        return '응답이 시간 내에 오지 않았습니다. 대상 서버 상태나 타임아웃 설정을 확인하세요.';
      case 'NETWORK_ERROR':
        return '대상 서버에 연결할 수 없습니다. 주소와 네트워크 상태를 확인하세요.';
      case 'BLOCKED_ADDRESS':
        return blockedAddress
          ? `주소(${blockedAddress})는 보안상 호출할 수 없습니다. 사설 주소(10.x 등)는 서버 허용 목록에 추가를 요청하고, 같은 서버 주소(localhost 등)는 보안상 허용할 수 없습니다 — 사내 주소로 노출한 뒤 허용 목록에 추가하세요.`
          : '대상 주소는 보안상 호출할 수 없습니다.';
      case 'REDIRECT_NOT_ALLOWED':
        return '대상 서버가 리다이렉트 응답을 반환했습니다. 최종 주소를 직접 등록해 주세요.';
      case 'RESPONSE_TOO_LARGE':
        return '응답 본문이 허용 크기를 초과했습니다.';
      case 'BLOCKED_URL':
        return '요청 경로가 허용되지 않는 형식입니다.';
      case 'SECRET_MISSING':
        return '시크릿이 설정되지 않았습니다. 서버 환경변수를 확인하세요.';
      case 'EGRESS_BLOCKED':
        return '이 주소는 서버의 외부 전송 허용 목록에 없습니다. 서버 설정(DATA_EGRESS_ALLOWED_HOSTS)에 추가해야 합니다.';
      default:
        return '확인 중 문제가 발생했습니다.';
    }
  }
}
