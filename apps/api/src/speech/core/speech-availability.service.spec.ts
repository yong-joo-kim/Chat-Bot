import type { ConfigService } from '@nestjs/config';
import type { SpeechRecognitionProvider } from '../providers/speech-recognition-provider.port';
import { SpeechAvailabilityService } from './speech-availability.service';

function build(healthy: () => Promise<boolean>, threshold = 3) {
  const values: Record<string, unknown> = { SPEECH_ENABLED: true, SPEECH_HEALTH_CACHE_MS: 30_000, SPEECH_FAILURE_THRESHOLD: threshold };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService;
  const provider = { providerId: 'mock', transcribe: jest.fn(), healthy: jest.fn(healthy) } as unknown as SpeechRecognitionProvider;
  return { service: new SpeechAvailabilityService(config, provider), provider };
}

describe('SpeechAvailabilityService 하락 정책(M-3)', () => {
  it('TIMEOUT·HTTP_5XX 1~2회는 하락시키지 않고 연속 3회째에 하락한다', async () => {
    const { service, provider } = build(async () => true);
    expect(await service.isAvailable()).toBe(true);
    service.reportFailure('TIMEOUT');
    service.reportFailure('HTTP_5XX');
    expect(await service.isAvailable()).toBe(true);
    service.reportFailure('TIMEOUT');
    expect(await service.isAvailable()).toBe(false);
    expect(provider.healthy).toHaveBeenCalled();
  });

  it('성공이 끼면 연속 계수가 초기화된다', async () => {
    const { service } = build(async () => true);
    await service.isAvailable();
    service.reportFailure('TIMEOUT');
    service.reportFailure('TIMEOUT');
    service.reportSuccess();
    service.reportFailure('TIMEOUT');
    service.reportFailure('TIMEOUT');
    expect(await service.isAvailable()).toBe(true);
  });

  it('NETWORK는 즉시 하락 · 설정 문제(NOT_CONFIGURED·INVALID_RESPONSE)는 영향 없음', async () => {
    const { service } = build(async () => true);
    await service.isAvailable();
    service.reportFailure('INVALID_RESPONSE');
    service.reportFailure('NOT_CONFIGURED');
    expect(await service.isAvailable()).toBe(true);
    service.reportFailure('NETWORK');
    expect(await service.isAvailable()).toBe(false);
  });

  it('임계 값은 설정으로 바꾼다(1 = 1회 즉시 하락)', async () => {
    const { service } = build(async () => true, 1);
    await service.isAvailable();
    service.reportFailure('HTTP_5XX');
    expect(await service.isAvailable()).toBe(false);
  });

  it('healthy() 재확인이 false를 주면 연속 계수 미달이어도 하락한다', async () => {
    let healthy = true;
    const { service } = build(async () => healthy);
    expect(await service.isAvailable()).toBe(true);
    healthy = false;
    service.reportFailure('TIMEOUT');
    await new Promise((r) => setImmediate(r));
    expect(await service.isAvailable()).toBe(false);
  });

  it('경합 — markUnavailable() 전에 시작된 갱신이 뒤늦게 true로 끝나도 되돌리지 않는다', async () => {
    let resolveSlow!: (v: boolean) => void;
    let calls = 0;
    const { service } = build(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve(true); // 첫 조회
      return new Promise<boolean>((resolve) => {
        resolveSlow = resolve;
      });
    });
    expect(await service.isAvailable()).toBe(true);
    // 느린 갱신을 시작시킨다(재확인 요청) — 아직 끝나지 않음
    service.reportFailure('TIMEOUT');
    expect(calls).toBe(2);
    service.markUnavailable();
    resolveSlow(true);
    await new Promise((r) => setImmediate(r));
    expect(await service.isAvailable()).toBe(false);
  });
});
