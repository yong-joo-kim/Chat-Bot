import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { isPublicSurface } from './common/cors-policy';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap(): Promise<void> {
  // body-parser 기본 상한(100KB)은 오버레이 1MB 상한(FR-10-21, OVERLAY_LIMITS.bodyBytes)보다 작아
  // 정상 요청이 우리 `ApiException`이 아닌 Express의 generic 413으로 실패한다. `bodyParser: false`로
  // Nest 기본 파서 등록을 막고, json/urlencoded 파서를 여유 있게(2MB) 직접 등록한다.
  // 파일 업로드 라우트(`FileInterceptor`, faqs/intents/keywords)는 multer가 별도로 처리하므로 영향받지 않는다.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // 운영 예약 배포(No.28) §7.9 — SIGTERM에서 onModuleDestroy가 불리도록 한다(엔진 정지 + Prisma 종료
  // 훅). 정합성은 이것에 의존하지 않는다(강제 종료·정전도 임대가 최종 방어선으로 처리한다).
  app.enableShutdownHooks();
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { limit: '2mb', extended: true });

  // CORS 경로 분기(DD-48, ADR-0014 §4) — 공개 API는 현행(`*`, 무자격증명) 100% 보존, 관리자
  // 경로만 `ADMIN_WEB_ORIGIN` allowlist + credentials를 연다. 미설정 시 관리자 경로는 동일 출처만 허용된다.
  const config = app.get(ConfigService);
  const adminOrigins = (config.get<string>('ADMIN_WEB_ORIGIN') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  app.enableCors((req: import('express').Request, callback) => {
    if (isPublicSurface(req.url ?? '')) {
      // [No.24, ADR-0036 §2·§7.1] 상담 폴링이 커스텀 헤더(x-cb-session-id/x-cb-handoff-token)를
      // 쓰기 시작해 프리플라이트가 생긴다 — 브라우저가 최대 10분(600초) 캐시하게 한다.
      // 공개 경로 판정·origin:'*'·무자격증명은 불변이다.
      callback(null, { origin: '*', credentials: false, maxAge: 600 });
      return;
    }
    const origin = req.headers.origin;
    if (origin && adminOrigins.includes(origin)) {
      callback(null, { origin, credentials: true });
      return;
    }
    callback(null, { origin: false });
  });

  // /api/v1/* (health는 VERSION_NEUTRAL로 /api/health 유지) — ADR-0003
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AllExceptionsFilter());

  // 사용자 0명 경고(FR-12-14, AC-12A-12) — 기동 실패로 만들지 않는다(선택 환경변수는 기동 실패
  // 조건을 늘리지 않는다는 원칙이 우선이며, 컨테이너 재시작 루프가 더 나쁜 장애다).
  const prisma = app.get(PrismaService);
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    new Logger('Bootstrap').warn(
      '등록된 사용자가 0명입니다. `pnpm --filter @chat-bot/api prisma:seed`를 실행해 초기 ADMIN 계정을 생성해 주세요.',
    );
  }

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Chat Bot API listening on port ${port}`);
}

bootstrap();
