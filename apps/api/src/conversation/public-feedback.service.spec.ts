import { ApiException } from '../common/api.exception';
import { PublicFeedbackService } from './public-feedback.service';

/**
 * `PublicFeedbackService` 단위 시험 — 공개 진입점(access.resolve → 스위치 → UUID 형식 → 위임)의
 * 분기를 mock으로 결정적으로 검증한다(리뷰에서 넘어온 공백). 결합 검증·CAS·큐 편입 자체는
 * `MessageFeedbackService`(message-feedback.service.spec.ts)와 통합 시험이 다룬다.
 */
describe('PublicFeedbackService', () => {
  const activeChannel = { config: JSON.stringify({ allowedOrigins: [], greetingMessage: '안녕', feedbackEnabled: true }) };
  const chatbot = { id: 'chatbot-1' };

  function makeAccess(overrides: Partial<Record<string, jest.Mock>> = {}): import('./public-access.service').PublicAccessService {
    return {
      resolve: jest.fn().mockResolvedValue({ chatbot, channel: activeChannel }),
      ...overrides,
    } as unknown as import('./public-access.service').PublicAccessService;
  }

  function makeMessageFeedback(overrides: Partial<Record<string, jest.Mock>> = {}): import('../feedback/message-feedback.service').MessageFeedbackService {
    return {
      submit: jest.fn().mockResolvedValue({ rating: 'UP' }),
      ...overrides,
    } as unknown as import('../feedback/message-feedback.service').MessageFeedbackService;
  }

  const validMessageId = '11111111-1111-4111-8111-111111111111';
  const dto = { sessionId: '22222222-2222-4222-8222-222222222222', rating: 'UP' as const };

  it('정상 경로 — access.resolve 성공 + 스위치 켜짐 + UUID 형식이면 MessageFeedbackService.submit에 위임한다', async () => {
    const access = makeAccess();
    const messageFeedback = makeMessageFeedback();
    const service = new PublicFeedbackService(access, messageFeedback);

    const result = await service.submitFeedback('demo-bot', validMessageId, dto);

    expect(result).toEqual({ rating: 'UP' });
    expect(access.resolve).toHaveBeenCalledWith('demo-bot');
    expect(messageFeedback.submit).toHaveBeenCalledWith({
      chatbotId: chatbot.id,
      messageId: validMessageId,
      sessionId: dto.sessionId,
      rating: dto.rating,
    });
  });

  it('access.resolve가 실패하면(존재하지 않는 슬러그·비공개·채널 비활성) 그 예외를 그대로 전파하고 submit은 호출하지 않는다', async () => {
    const resolveError = new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');
    const access = makeAccess({ resolve: jest.fn().mockRejectedValue(resolveError) });
    const messageFeedback = makeMessageFeedback();
    const service = new PublicFeedbackService(access, messageFeedback);

    await expect(service.submitFeedback('missing-bot', validMessageId, dto)).rejects.toBe(resolveError);
    expect(messageFeedback.submit).not.toHaveBeenCalled();
  });

  it('feedbackEnabled가 꺼져 있으면(WEB 채널 설정) DB 조회 없이 404이고 submit은 호출하지 않는다', async () => {
    const offChannel = { config: JSON.stringify({ allowedOrigins: [], greetingMessage: '안녕', feedbackEnabled: false }) };
    const access = makeAccess({ resolve: jest.fn().mockResolvedValue({ chatbot, channel: offChannel }) });
    const messageFeedback = makeMessageFeedback();
    const service = new PublicFeedbackService(access, messageFeedback);

    try {
      await service.submitFeedback('demo-bot', validMessageId, dto);
      fail('예외가 던져져야 한다');
    } catch (e) {
      expect((e as ApiException).getStatus()).toBe(404);
      expect((e as ApiException).getResponse()).toMatchObject({ code: 'FEEDBACK_TARGET_NOT_FOUND' });
    }
    expect(messageFeedback.submit).not.toHaveBeenCalled();
  });

  it('feedbackEnabled 키 자체가 없으면(선택 키 미설정 = 기본 꺼짐) 404다', async () => {
    const noKeyChannel = { config: JSON.stringify({ allowedOrigins: [], greetingMessage: '안녕' }) };
    const access = makeAccess({ resolve: jest.fn().mockResolvedValue({ chatbot, channel: noKeyChannel }) });
    const messageFeedback = makeMessageFeedback();
    const service = new PublicFeedbackService(access, messageFeedback);

    await expect(service.submitFeedback('demo-bot', validMessageId, dto)).rejects.toThrow(ApiException);
    expect(messageFeedback.submit).not.toHaveBeenCalled();
  });

  it('messageId가 UUID 형식이 아니면 404이고 submit은 호출하지 않는다', async () => {
    const access = makeAccess();
    const messageFeedback = makeMessageFeedback();
    const service = new PublicFeedbackService(access, messageFeedback);

    try {
      await service.submitFeedback('demo-bot', 'not-a-uuid', dto);
      fail('예외가 던져져야 한다');
    } catch (e) {
      expect((e as ApiException).getStatus()).toBe(404);
      expect((e as ApiException).getResponse()).toMatchObject({ code: 'FEEDBACK_TARGET_NOT_FOUND' });
    }
    expect(messageFeedback.submit).not.toHaveBeenCalled();
    // access.resolve는 스위치를 판정하려고 여전히 호출된다 — UUID 형식 검사는 그 다음 단계다.
    expect(access.resolve).toHaveBeenCalledWith('demo-bot');
  });

  it('스위치 꺼짐과 비UUID가 동시에 있어도(둘 다 실패) 같은 코드·같은 문구의 404 1개다', async () => {
    const offChannel = { config: JSON.stringify({ allowedOrigins: [], feedbackEnabled: false }) };
    const access = makeAccess({ resolve: jest.fn().mockResolvedValue({ chatbot, channel: offChannel }) });
    const messageFeedback = makeMessageFeedback();
    const service = new PublicFeedbackService(access, messageFeedback);

    try {
      await service.submitFeedback('demo-bot', 'not-a-uuid', dto);
      fail('예외가 던져져야 한다');
    } catch (e) {
      expect((e as ApiException).getResponse()).toMatchObject({ code: 'FEEDBACK_TARGET_NOT_FOUND' });
    }
  });
});
