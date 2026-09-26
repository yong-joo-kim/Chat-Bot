import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from './public.decorator';
import { HealthController } from '../../health/health.controller';
import { PublicConversationController } from '../../conversation/public-conversation.controller';
import { AuthController } from '../../auth/auth.controller';
import { ChatbotsController } from '../../chatbots/chatbots.controller';
import { UsersController } from '../../users/users.controller';
import { RolesController } from '../../users/roles.controller';
import { AuditLogsController } from '../../audit-logs/audit-logs.controller';
import { BannedWordsController } from '../../banned-words/banned-words.controller';
import { ChannelsController } from '../../channels/channels.controller';
import { ChatbotGroupsController } from '../../chatbot-groups/chatbot-groups.controller';
import { ContextsController } from '../../contexts/contexts.controller';
import { DialogNodesController } from '../../dialog-nodes/dialog-nodes.controller';
import { FaqsController } from '../../faqs/faqs.controller';
import { HomonymsController } from '../../homonyms/homonyms.controller';
import { IntentsController } from '../../intents/intents.controller';
import { KeywordsController } from '../../keywords/keywords.controller';
import { SimulationController } from '../../simulation/simulation.controller';
import { StatsController } from '../../stats/stats.controller';
import { AnswerSettingsController } from '../../answer-settings/answer-settings.controller';
import { EmbeddingController } from '../../embedding/embedding.controller';
import { ApiConnectionsController } from '../../api-connections/api-connections.controller';
import { ApiCallLogsController } from '../../legacy-api/api-call-logs.controller';
// [1차 코드리뷰 지적 보강 — E-1, No.24] 전수 스캔에서 빠져 있던 4개 그룹 컨트롤러를 추가한다
// (기존 결함 — surveys·versions·validation·deploy-schedules 컨트롤러가 목록에 없었다).
import { SurveysController } from '../../surveys/surveys.controller';
import { VersionsController } from '../../versions/versions.controller';
import { TestCasesController } from '../../validation/test-cases.controller';
import { TestRunsController } from '../../validation/test-runs.controller';
import { TestSetsController } from '../../validation/test-sets.controller';
import { DeploySchedulesController } from '../../deploy-schedules/deploy-schedules.controller';
import { DeploySchedulesGlobalController } from '../../deploy-schedules/deploy-schedules-global.controller';
// [신규 No.24] 하이브리드 CS 컨트롤러 5개 — 상담 폴링(공개 7번째)을 제외하면 전부 @Public() 0건이다.
import { LiveSessionsController } from '../../handoff/live-sessions.controller';
import { HandoffsController } from '../../handoff/handoffs.controller';
import { HandoffSettingsController } from '../../handoff/handoff-settings.controller';
import { HandoffConsoleController } from '../../handoff/handoff-console.controller';
import { CannedResponsesController } from '../../canned-responses/canned-responses.controller';
// [신규 No.22] 토픽 시스템 컨트롤러 2개 — 둘 다 @Public() 0건(topic-system-설계.md §17 T-9).
import { TopicsController } from '../../topics/topics.controller';
import { TopicAssignmentsController } from '../../topics/topic-assignments.controller';
// [신규 No.40] 환경 분리 컨트롤러 1개 — @Public() 0건(environment-separation-설계.md E-6).
import { EnvironmentController } from '../../environment/environment.controller';
// [신규 No.45] 데이터 거버넌스 컨트롤러 2개 — 둘 다 @Public() 0건(data-governance-설계.md §14).
import { GovernanceController } from '../../governance/governance.controller';
import { ChatbotRetentionController } from '../../governance/chatbot-retention.controller';

function isPublic(target: object, methodName: string): boolean {
  const handler = (target as Record<string, unknown>)[methodName];
  return Reflect.getMetadata(IS_PUBLIC_KEY, handler as object) === true;
}

/** 컨트롤러 프로토타입에서 실제 라우트 핸들러 메서드명만 추려낸다(1차 리뷰 지적 — 전수 스캔). */
function routeHandlerNames(prototype: object): string[] {
  return Object.getOwnPropertyNames(prototype).filter((name) => {
    if (name === 'constructor') return false;
    const value = (prototype as Record<string, unknown>)[name];
    if (typeof value !== 'function') return false;
    return Reflect.getMetadata(PATH_METADATA, value) !== undefined;
  });
}

/**
 * `@Public()`은 정확히 8곳에만 부착된다(FR-12-20, DD-45, AC-C-4 — **갱신**: 7→8, 근거는
 * `docs/02-spec/decisions/ADR-0038-answer-feedback-message-capability-ledger-and-queue-source-split.md`
 * §2 및 `feedback-loop-설계.md` §7.1). 8번째는 답변 평가(`PublicConversationController#submitFeedback`)다.
 * 인가 우회는 "추가된 코드"가 아니라 "추가된 예외"로 발생하므로, 예외의 개수를 자동 검증해 리뷰가
 * 놓쳐도 CI가 잡게 한다 — 개수 고정 테스트를 무력화하지 않고 **의도적으로 갱신**한다(AC-N4-3).
 */
describe('@Public() 부착 개수 — AC-C-4', () => {
  it('정확히 8곳(health, 공개 대화 2곳, 보류 답변 폴링, 상담 폴링, 답변 평가, 로그인, 로그아웃)에만 부착되어 있다', () => {
    expect(isPublic(HealthController.prototype, 'check')).toBe(true);
    expect(isPublic(PublicConversationController.prototype, 'getConfig')).toBe(true);
    expect(isPublic(PublicConversationController.prototype, 'sendMessage')).toBe(true);
    expect(isPublic(PublicConversationController.prototype, 'pollMessage')).toBe(true);
    expect(isPublic(PublicConversationController.prototype, 'pollHandoff')).toBe(true);
    expect(isPublic(PublicConversationController.prototype, 'submitFeedback')).toBe(true);
    expect(isPublic(AuthController.prototype, 'login')).toBe(true);
    expect(isPublic(AuthController.prototype, 'logout')).toBe(true);
  });

  it('인증이 필요한 대표 핸들러에는 부착되어 있지 않다(과다 적용 방지)', () => {
    expect(isPublic(AuthController.prototype, 'me')).toBe(false);
    expect(isPublic(AuthController.prototype, 'changePassword')).toBe(false);
    expect(isPublic(ChatbotsController.prototype, 'list')).toBe(false);
    expect(isPublic(ChatbotsController.prototype, 'create')).toBe(false);
    expect(isPublic(UsersController.prototype, 'list')).toBe(false);
  });

  /**
   * 1차 코드리뷰 지적(전수 스캔 아님) 보강: `apps/api/src`의 모든 `*.controller.ts`를 여기서
   * 직접 import해 등록하고, 각 컨트롤러의 **모든 라우트 핸들러**를 순회해 `IS_PUBLIC_KEY`가
   * 붙은 총개수를 센다. 신규 컨트롤러/핸들러가 추가돼도 이 목록에 import를 빠뜨리지 않는 한
   * 자동으로 스캔 대상에 포함된다 — 목록에서 컨트롤러가 하나라도 빠지면 아래 카운트 어서션과
   * `find apps/api/src -iname "*.controller.ts"`(공정 산출 기준)의 결과가 어긋나므로,
   * 새 컨트롤러 파일 추가 시 이 파일도 함께 갱신해야 함을 리뷰에서 잡아낼 수 있다.
   */
  it('전수 스캔: 등록된 37개 컨트롤러 전체에서 @Public() 총개수가 정확히 8건이다(No.45 GovernanceController·ChatbotRetentionController 추가 — 35→37)', () => {
    const allControllers = [
      HealthController,
      PublicConversationController,
      AuthController,
      ChatbotsController,
      ChatbotGroupsController,
      UsersController,
      RolesController,
      AuditLogsController,
      BannedWordsController,
      ChannelsController,
      ContextsController,
      DialogNodesController,
      FaqsController,
      HomonymsController,
      IntentsController,
      KeywordsController,
      SimulationController,
      StatsController,
      AnswerSettingsController,
      EmbeddingController,
      // [No.26 레거시 API 연동] 신규 컨트롤러 2개 — 둘 다 @Public() 0건(FR-0-100).
      ApiConnectionsController,
      ApiCallLogsController,
      // [기존 결함 보강 — E-1] 이전까지 이 목록에서 빠져 있던 4개 그룹.
      SurveysController,
      VersionsController,
      TestCasesController,
      TestRunsController,
      TestSetsController,
      DeploySchedulesController,
      DeploySchedulesGlobalController,
      // [신규 No.24 하이브리드 CS] 5개 — 상담 폴링은 PublicConversationController#pollHandoff로 이미 포함.
      LiveSessionsController,
      HandoffsController,
      HandoffSettingsController,
      HandoffConsoleController,
      CannedResponsesController,
      // [신규 No.22] 2개 추가 — 32 → 34.
      TopicsController,
      TopicAssignmentsController,
      // [신규 No.40] 1개 추가 — 34 → 35.
      EnvironmentController,
      // [신규 No.45] 2개 추가 — 35 → 37.
      GovernanceController,
      ChatbotRetentionController,
    ];

    const publicHandlers: string[] = [];
    for (const Ctrl of allControllers) {
      const prototype = Ctrl.prototype as object;
      for (const methodName of routeHandlerNames(prototype)) {
        if (isPublic(prototype, methodName)) {
          publicHandlers.push(`${Ctrl.name}#${methodName}`);
        }
      }
    }

    expect(publicHandlers.sort()).toEqual(
      [
        'AuthController#login',
        'AuthController#logout',
        'HealthController#check',
        'PublicConversationController#getConfig',
        'PublicConversationController#sendMessage',
        'PublicConversationController#pollMessage',
        'PublicConversationController#pollHandoff',
        'PublicConversationController#submitFeedback',
      ].sort(),
    );
  });
});
