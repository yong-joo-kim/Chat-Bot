import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * `mapUniqueConflict` P2002 분기 단위 테스트(code-reviewer Medium #2).
 * `User.email` 유일성 위반이 동시 등록 경합(TOCTOU)으로 여기까지 도달했을 때
 * 기본 분기(DUPLICATE_SLUG)가 아니라 409 DUPLICATE_EMAIL로 매핑되어야 한다(FR-12-26/AC-12C-2).
 */
describe('AllExceptionsFilter — mapUniqueConflict', () => {
  const filter = new AllExceptionsFilter();

  function catchAndCapture(exception: unknown): { statusCode: number; body: unknown } {
    let statusCode = 0;
    let body: unknown;
    const response = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({}),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(exception, host);
    return { statusCode, body };
  }

  function p2002(target: string[]): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.0.0',
      meta: { target },
    });
  }

  it('User.email 유일성 위반은 409 DUPLICATE_EMAIL로 매핑된다(TOCTOU 경합 방어선)', () => {
    const { statusCode, body } = catchAndCapture(p2002(['email']));
    expect(statusCode).toBe(HttpStatus.CONFLICT);
    expect(body).toMatchObject({
      statusCode: HttpStatus.CONFLICT,
      code: 'DUPLICATE_EMAIL',
      message: '이미 등록된 이메일입니다.',
    });
  });

  it('questionNormalized 위반은 여전히 DUPLICATE_FAQ로 매핑된다(회귀 방지)', () => {
    const { body } = catchAndCapture(p2002(['questionNormalized']));
    expect(body).toMatchObject({ code: 'DUPLICATE_FAQ' });
  });

  it('nameNormalized/wordNormalized 위반은 여전히 DUPLICATE_NAME으로 매핑된다(회귀 방지)', () => {
    expect(catchAndCapture(p2002(['nameNormalized'])).body).toMatchObject({ code: 'DUPLICATE_NAME' });
    expect(catchAndCapture(p2002(['wordNormalized'])).body).toMatchObject({ code: 'DUPLICATE_NAME' });
  });

  it('그 외(slug 등) 유일성 위반은 기본값 DUPLICATE_SLUG로 매핑된다', () => {
    const { body } = catchAndCapture(p2002(['slug']));
    expect(body).toMatchObject({ code: 'DUPLICATE_SLUG' });
  });

  /** 운영 예약 배포(No.28) 그룹 추가(code-review M1) — deploy_schedules 부분 유니크 인덱스 위반이
   * 이 필터까지 도달해도 DUPLICATE_SLUG("이미 사용 중인 고유 URL")로 오분류되지 않는 방어선. */
  it('deploy_schedules 부분 유니크 인덱스 위반은 DEPLOY_SCHEDULE_INVALID_TIME으로 매핑된다(방어선)', () => {
    const { statusCode, body } = catchAndCapture(p2002(['deploy_schedules_chatbotId_scheduledAt_active_key']));
    expect(statusCode).toBe(HttpStatus.CONFLICT);
    expect(body).toMatchObject({ code: 'DEPLOY_SCHEDULE_INVALID_TIME' });
  });

  it('deploy_schedules_chatbotId_running_key 위반도 DEPLOY_SCHEDULE_INVALID_TIME으로 매핑된다', () => {
    expect(catchAndCapture(p2002(['deploy_schedules_chatbotId_running_key'])).body).toMatchObject({ code: 'DEPLOY_SCHEDULE_INVALID_TIME' });
  });
});
