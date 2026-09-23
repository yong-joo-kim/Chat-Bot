import { useEffect, useState } from 'react';
import type { DeployScheduleMeta } from '@chat-bot/shared-types';
import { deploySchedulesApi } from '../api/deploySchedules';

/**
 * No.28 리뷰 2라운드 M-1 — `GET /deploy-schedules/meta`(시간대·엔진·한도)를 세션 동안 1회만
 * 조회해 여러 화면/컴포넌트가 공유한다(전에는 `DeployScheduleListPage`/`DeployScheduleDetailPage`/
 * `VersionListPage`/`ChatbotDetailLayout`/`ChannelCard`가 각자 호출해 중복 조회가 있었다).
 * 모듈 스코프 캐시 + 진행 중인 요청 공유로 동시에 여러 컴포넌트가 마운트돼도 요청은 1건만 나간다.
 */
let cachedMeta: DeployScheduleMeta | null = null;
let inflight: Promise<DeployScheduleMeta> | null = null;

function loadMeta(): Promise<DeployScheduleMeta> {
  if (cachedMeta) return Promise.resolve(cachedMeta);
  if (!inflight) {
    inflight = deploySchedulesApi
      .meta()
      .then((m) => {
        cachedMeta = m;
        inflight = null;
        return m;
      })
      .catch((e) => {
        inflight = null;
        throw e;
      });
  }
  return inflight;
}

export function useDeployScheduleMeta(): DeployScheduleMeta | null {
  const [meta, setMeta] = useState<DeployScheduleMeta | null>(cachedMeta);

  useEffect(() => {
    if (cachedMeta) {
      setMeta(cachedMeta);
      return;
    }
    let cancelled = false;
    loadMeta()
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return meta;
}

/** 표시용 시간대 — meta가 아직 로드되지 않았으면 시스템 기본값(Asia/Seoul)으로 잠깐 폴백한다. */
export function useDeployScheduleTimezone(): string {
  const meta = useDeployScheduleMeta();
  return meta?.timezone ?? 'Asia/Seoul';
}

/** 테스트 전용 — 스위트 간 캐시 오염을 막기 위해 `beforeEach`에서 호출한다. */
export function resetDeployScheduleMetaCacheForTests(): void {
  cachedMeta = null;
  inflight = null;
}
