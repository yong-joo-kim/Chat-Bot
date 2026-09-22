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
 * `@Public()`은 정확히 6곳에만 부착된다(FR-12-20, DD-45, AC-C-4 — **갱신**: 5→6, 근거는
 * `docs/02-spec/decisions/ADR-0023-async-pending-answer-delivery.md` §2 및 `nlu-rag-answering-설계.md`
 * §11.1). 6번째는 보류 답변 폴링(`PublicConversationController#pollMessage`)이다. 인가 우회는
 * "추가된 코드"가 아니라 "추가된 예외"로 발생하므로, 예외의 개수를 자동 검증해 리뷰가 놓쳐도
 * CI가 잡게 한다 — 개수 고정 테스트를 무력화하지 않고 **의도적으로 갱신**한다(AC-N4-3).
 */
describe('@Public() 부착 개수 — AC-C-4', () => {
  it('정확히 6곳(health, 공개 대화 2곳, 보류 답변 폴링, 로그인, 로그아웃)에만 부착되어 있다', () => {
    expect(isPublic(HealthController.prototype, 'check')).toBe(true);
    expect(isPublic(PublicConversationController.prototype, 'getConfig')).toBe(true);
    expect(isPublic(PublicConversationController.prototype, 'sendMessage')).toBe(true);
    expect(isPublic(PublicConversationController.prototype, 'pollMessage')).toBe(true);
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
  it('전수 스캔: 등록된 19개 컨트롤러 전체에서 @Public() 총개수가 정확히 6건이다', () => {
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
      ].sort(),
    );
  });
});
