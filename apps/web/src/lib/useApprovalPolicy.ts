import { useCallback, useEffect, useState } from 'react';
import type { ApprovalPolicyStatus } from '@chat-bot/shared-types';
import { switchApprovalsApi } from '../api/switchApprovals';
import { useLatestRequest } from './useLatestRequest';

export interface UseApprovalPolicyResult {
  status: ApprovalPolicyStatus | null;
  loading: boolean;
  error: boolean;
  reload: () => Promise<void>;
}

/**
 * 챗봇 스코프 2인 승인 정책·요청 조회(`GET …/environment/approval`) — 환경 탭·예약 대화상자·예약 목록/상세가 공용으로 쓴다.
 * `enabled`가 false면 호출하지 않는다(권한이 없거나 필요 없는 화면). 실패해도 화면 전체를 막지 않는다(보조 정보).
 */
export function useApprovalPolicy(chatbotId: string, enabled = true): UseApprovalPolicyResult {
  const [status, setStatus] = useState<ApprovalPolicyStatus | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const guard = useLatestRequest();

  const reload = useCallback(async () => {
    if (!enabled) return;
    const reqId = guard.next();
    setLoading(true);
    setError(false);
    try {
      const res = await switchApprovalsApi.getStatus(chatbotId);
      if (guard.isStale(reqId)) return;
      setStatus(res);
    } catch {
      if (guard.isStale(reqId)) return;
      setError(true);
    } finally {
      if (!guard.isStale(reqId)) setLoading(false);
    }
  }, [chatbotId, enabled, guard]);

  useEffect(() => {
    setStatus(null);
    if (!enabled) {
      setLoading(false);
      return;
    }
    void reload();
  }, [chatbotId, enabled, reload]);

  return { status, loading, error, reload };
}

/** 1분 단위로 갱신되는 현재 시각(남은 시간 표시용 — 낭독 대상이 아니다). */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
