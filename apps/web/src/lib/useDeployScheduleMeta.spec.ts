import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { DeployScheduleMeta } from '@chat-bot/shared-types';

const mockMeta = vi.fn();
vi.mock('../api/deploySchedules', () => ({
  deploySchedulesApi: { meta: (...args: unknown[]) => mockMeta(...args) },
}));

// eslint-disable-next-line import/first -- 목 선언 이후에 임포트해야 vi.mock이 먼저 적용된다.
import { resetDeployScheduleMetaCacheForTests, useDeployScheduleMeta, useDeployScheduleTimezone } from './useDeployScheduleMeta';

function baseMeta(overrides: Partial<DeployScheduleMeta> = {}): DeployScheduleMeta {
  return {
    timezone: 'Asia/Seoul',
    timezoneFallback: false,
    engine: { enabledOnThisInstance: true, pollIntervalMs: 1000, misfireGraceMinutes: 10, retryWindowMinutes: 15, leaseMinutes: 5, overduePendingCount: 0 },
    limits: { minLeadMinutes: 5, maxHorizonDays: 90, minSpacingMinutes: 1, maxActivePerChatbot: 5, memoMaxCodePoints: 200, longHorizonWarnDays: 30, listPageSizeDefault: 20, listPageSizeMax: 100 },
    ...overrides,
  };
}

/**
 * 새 테스트 — 구현·리뷰 단계 공백 보강(2026-09-24, No.28 시험 회차). 리뷰 2라운드 M-1이 도입한
 * 모듈 스코프 캐시 + in-flight 공유(`useDeployScheduleMeta.ts` 주석)를 직접 검증하는 전용 스펙이
 * 이전에 없었다 — 각 화면의 컴포넌트 스펙이 `deploySchedulesApi.meta`를 개별로 mock했을 뿐,
 * "여러 컴포넌트가 동시에 마운트돼도 요청은 1건만 나간다"는 계약 자체는 테스트되지 않았다.
 */
describe('useDeployScheduleMeta / useDeployScheduleTimezone', () => {
  beforeEach(() => {
    mockMeta.mockReset();
    resetDeployScheduleMetaCacheForTests();
  });

  it('최초 마운트 시 meta를 조회하고 값을 반환한다', async () => {
    mockMeta.mockResolvedValue(baseMeta({ timezone: 'Asia/Seoul' }));
    const { result } = renderHook(() => useDeployScheduleMeta());

    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current?.timezone).toBe('Asia/Seoul'));
    expect(mockMeta).toHaveBeenCalledTimes(1);
  });

  it('동시에 여러 컴포넌트가 마운트돼도 API 호출은 1건만 나간다(in-flight 공유)', async () => {
    let resolveFn: (m: DeployScheduleMeta) => void = () => undefined;
    mockMeta.mockReturnValue(
      new Promise<DeployScheduleMeta>((resolve) => {
        resolveFn = resolve;
      }),
    );

    const hookA = renderHook(() => useDeployScheduleMeta());
    const hookB = renderHook(() => useDeployScheduleMeta());
    const hookC = renderHook(() => useDeployScheduleTimezone());

    expect(mockMeta).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFn(baseMeta({ timezone: 'America/New_York' }));
      await Promise.resolve();
    });

    await waitFor(() => expect(hookA.result.current?.timezone).toBe('America/New_York'));
    expect(hookB.result.current?.timezone).toBe('America/New_York');
    expect(hookC.result.current).toBe('America/New_York');
    expect(mockMeta).toHaveBeenCalledTimes(1);
  });

  it('이후 마운트되는 컴포넌트는 캐시된 값을 즉시(재조회 없이) 받는다', async () => {
    mockMeta.mockResolvedValue(baseMeta({ timezone: 'Asia/Seoul' }));
    const first = renderHook(() => useDeployScheduleMeta());
    await waitFor(() => expect(first.result.current).not.toBeNull());
    expect(mockMeta).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useDeployScheduleMeta());
    // 캐시 히트 — useState 초기값으로 즉시 채워지므로 waitFor 없이도 값이 있어야 한다.
    expect(second.result.current?.timezone).toBe('Asia/Seoul');
    expect(mockMeta).toHaveBeenCalledTimes(1);
  });

  it('조회 실패 시 캐시하지 않고, 다음 마운트에서 재시도한다', async () => {
    mockMeta.mockRejectedValueOnce(new Error('network error'));
    const first = renderHook(() => useDeployScheduleMeta());
    await waitFor(() => expect(mockMeta).toHaveBeenCalledTimes(1));
    // 실패해도 훅은 null을 유지하고(throw하지 않음) 예외를 삼킨다.
    expect(first.result.current).toBeNull();

    mockMeta.mockResolvedValueOnce(baseMeta({ timezone: 'Asia/Seoul' }));
    const second = renderHook(() => useDeployScheduleMeta());
    await waitFor(() => expect(second.result.current?.timezone).toBe('Asia/Seoul'));
    expect(mockMeta).toHaveBeenCalledTimes(2);
  });

  it('useDeployScheduleTimezone은 meta 로드 전 기본값(Asia/Seoul)으로 폴백한다', () => {
    mockMeta.mockReturnValue(new Promise<DeployScheduleMeta>(() => undefined)); // 영구 대기
    const { result } = renderHook(() => useDeployScheduleTimezone());
    expect(result.current).toBe('Asia/Seoul');
  });
});
