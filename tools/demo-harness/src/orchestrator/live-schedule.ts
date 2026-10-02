// 라이브 예약 C-2(설계 DHD-8 · §7.6) — 진행자가 공연을 시작한 순간(T0)에 예약을 걸고 작성자 요청 + 다른 ADMIN 승인까지 API로 처리한다.
// 예약 시각 = ceilMinute(T0 + 6분) — 장면 5(5:50~7:25) 안에 실행이 끝난다. 시계 주입은 쓰지 않는다(제품과 다른 기동 경로가 생긴다).
import type { ApiSession } from '../data/api-client';
import { ApiError } from '../data/api-client';
import { scheduleWithApproval } from '../data/generator';
import { liveScheduleTime, pickValidScheduleTime } from '../data/schedule-times';
import type { DatasetIds } from '../data/types';
import type { LiveScheduleState } from '../scenario/types';

interface EnvLite {
  prod: { versionId: string; versionNo: number };
  staging: { versionId: string; versionNo: number } | null;
}

/** C 챗봇의 현재 운영·스테이징을 읽어 라이브 예약(대상 = 스테이징, 기준 = 운영)을 만든다. 실패는 던지지 않고 FAILED 상태로 돌려준다(장면 5가 이력 화면으로 대체). */
export async function createLiveSchedule(i: { admin1: ApiSession; admin2: ApiSession; ids: DatasetIds; now?: () => Date; log: (m: string) => void }): Promise<LiveScheduleState> {
  const now = i.now ?? (() => new Date());
  try {
    const env = (await i.admin1.get(`/chatbots/${i.ids.C.id}/environment`)).body as EnvLite;
    if (!env.staging || env.staging.versionId === env.prod.versionId) {
      return { status: 'FAILED', error: '예약 대상이 될 스테이징 버전이 없습니다(이력 예약이 아직 실행되지 않았을 수 있음)' };
    }
    let at = pickValidScheduleTime(liveScheduleTime(now()), now(), []);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await scheduleWithApproval(i.admin1, i.admin2, i.ids.C.id, { targetVersionId: env.staging.versionId, baseVersionId: env.prod.versionId, scheduledAt: at, memo: '시연 중 실행 예약' }, i.log);
        return { status: 'CREATED', scheduleId: r.scheduleId, scheduledAt: r.scheduledAt.toISOString(), approvalId: r.approvalId, targetVersionId: env.staging.versionId, baseVersionId: env.prod.versionId };
      } catch (e) {
        // 서버가 시각 규칙(최소 선행·간격)을 다시 검증해 400이면 다음 분으로 한 번 더 시도한다
        if (attempt === 0 && e instanceof ApiError && e.status === 400) {
          at = new Date(at.getTime() + 60_000);
          continue;
        }
        throw e;
      }
    }
    return { status: 'FAILED', error: '예약 시각을 정하지 못했습니다' };
  } catch (e) {
    return { status: 'FAILED', error: (e as Error).message.slice(0, 300) };
  }
}
