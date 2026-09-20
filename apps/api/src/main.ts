import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  // body-parser 기본 상한(100KB)은 오버레이 1MB 상한(FR-10-21, OVERLAY_LIMITS.bodyBytes)보다 작아
  // 정상 요청이 우리 `ApiException`이 아닌 Express의 generic 413으로 실패한다. `bodyParser: false`로
  // Nest 기본 파서 등록을 막고, json/urlencoded 파서를 여유 있게(2MB) 직접 등록한다.
  // 파일 업로드 라우트(`FileInterceptor`, faqs/intents/keywords)는 multer가 별도로 처리하므로 영향받지 않는다.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { limit: '2mb', extended: true });
  app.enableCors();
  // /api/v1/* (health는 VERSION_NEUTRAL로 /api/health 유지) — ADR-0003
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Chat Bot API listening on port ${port}`);
}

bootstrap();
