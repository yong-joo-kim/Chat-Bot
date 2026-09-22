import { Global, Module } from '@nestjs/common';
import { InMemoryRateLimitStore } from './rate-limit.store';

/**
 * 레이트리미터 `common/` 승격(DD-43). 소비자가 3곳 이상이 되어(공개 API·로그인·PERMISSION_DENIED 합치기)
 * PII 마스킹과 동일한 승격 규칙("소비자 2곳 이상")을 만족한다. 주입 토큰 문자열 `'RateLimitStore'`는 불변이다.
 * 인스턴스가 1개로 통합되므로 키 네임스페이스 접두사 규약을 둔다 —
 * `public:session:*` / `public:ip:*`(기존) · `login:ip:*`(신규) · `audit:denied:*`(신규).
 */
@Global()
@Module({
  providers: [{ provide: 'RateLimitStore', useClass: InMemoryRateLimitStore }],
  exports: ['RateLimitStore'],
})
export class RateLimitModule {}
