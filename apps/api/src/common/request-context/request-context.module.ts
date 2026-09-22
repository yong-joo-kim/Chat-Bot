import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { RequestContextService } from './request-context.service';
import { RequestContextMiddleware } from './request-context.middleware';

/** 횡단 관심사 — 소비 모듈이 전역이다(`PrismaModule`과 동일 선례, DD-40). */
@Global()
@Module({
  providers: [RequestContextService],
  exports: [RequestContextService],
})
export class RequestContextModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
