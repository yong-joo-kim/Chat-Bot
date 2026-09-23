import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DeployScheduleDetail } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { ScheduleResultSummaryPanel } from './ScheduleResultSummaryPanel';

const CHATBOT_ID = 'chatbot-1';

function makeDetail(overrides: Partial<DeployScheduleDetail> = {}): DeployScheduleDetail {
  return {
    id: 'sched-1',
    chatbotId: CHATBOT_ID,
    action: 'RESTORE_VERSION',
    status: 'SUCCEEDED',
    scheduledAt: new Date('2027-11-01T00:00:00.000Z'),
    targetVersionId: 'ver-30',
    targetVersionNo: 30,
    enableWebChannel: null,
    channelEnabled: null,
    memo: null,
    createdByEmail: 'editor@chat-bot.local',
    createdAt: new Date('2026-09-20T09:51:00.000Z'),
    attemptCount: 1,
    lastTransientReason: null,
    delaySeconds: null,
    finishedAt: new Date('2027-11-01T00:00:20.000Z'),
    outcome: 'APPLIED',
    failureReason: null,
    heldReason: null,
    needsAttention: false,
    params: { versionId: 'ver-30' },
    acknowledgeActive: false,
    expectedContentHash: 'a'.repeat(64),
    targetContentHash: 'b'.repeat(64),
    predecessor: null,
    heldBy: null,
    resultSummary: null,
    revert: null,
    postRunTestSetId: null,
    testRunId: null,
    cancelledByEmail: null,
    cancelledAt: null,
    acknowledgedByEmail: null,
    acknowledgedAt: null,
    readinessWarnings: [],
    ...overrides,
  };
}

function renderPanel(detail: DeployScheduleDetail): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ScheduleResultSummaryPanel chatbotId={CHATBOT_ID} detail={detail} />
    </MemoryRouter>,
  );
}

/**
 * 새 테스트 — 구현·리뷰 단계 공백 보강(2026-09-24, No.28 시험 회차).
 * `resultSummary`가 없으면 컴포넌트는 아무것도 렌더하지 않고, 있으면 종류(kind)별로 다른 패널을
 * 렌더한다. RESTORE 변형의 `backupVersionNo`/`backupVersionId`는 NOOP일 때 값이 없을 수 있다
 * (설계서 §13.2, 코드 주석 "항상 존재한다고 가정하지 않는다") — 이 계약을 직접 검증한다.
 */
describe('ScheduleResultSummaryPanel', () => {
  it('resultSummary가 null이면 아무것도 렌더하지 않는다', () => {
    const { container } = renderPanel(makeDetail({ resultSummary: null }));
    expect(container.querySelector('.schedule-result-summary')).not.toBeInTheDocument();
  });

  it('RESTORE APPLIED — 백업 되돌리기 링크가 렌더되고 대상 버전 링크가 올바르다', () => {
    renderPanel(
      makeDetail({
        outcome: 'APPLIED',
        resultSummary: {
          kind: 'RESTORE',
          fromVersionNo: 30,
          backupVersionNo: 33,
          backupVersionId: 'ver-backup-33',
          counts: {},
          reindexWasRunning: false,
          classifierDeleted: false,
        },
      }),
    );

    expect(screen.getByText(MESSAGES.deploySchedules.detail.revertLink(33))).toBeInTheDocument();
    const link = screen.getByRole('link', { name: MESSAGES.deploySchedules.detail.revertAction });
    expect(link).toHaveAttribute('href', `/chatbots/${CHATBOT_ID}/versions/ver-backup-33/content`);
    expect(screen.queryByText(MESSAGES.deploySchedules.detail.noopNotice)).not.toBeInTheDocument();
  });

  it('RESTORE NOOP — backupVersionNo/backupVersionId가 없어도 되돌리기 링크를 렌더하지 않고 NOOP 안내만 표시한다(백엔드 리뷰 M2 계약)', () => {
    renderPanel(
      makeDetail({
        outcome: 'NOOP',
        resultSummary: { kind: 'RESTORE', counts: {}, reindexWasRunning: false, classifierDeleted: false },
      }),
    );

    expect(screen.getByText(MESSAGES.deploySchedules.detail.noopNotice)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: MESSAGES.deploySchedules.detail.revertAction })).not.toBeInTheDocument();
  });

  it('RESTORE RECOVERED — 사후 확인 안내가 함께 표시된다(기동 정리 §7.8)', () => {
    renderPanel(
      makeDetail({
        outcome: 'RECOVERED',
        resultSummary: {
          kind: 'RESTORE',
          backupVersionNo: 33,
          backupVersionId: 'ver-backup-33',
          counts: {},
          reindexWasRunning: false,
          classifierDeleted: false,
        },
      }),
    );

    expect(screen.getByText(MESSAGES.deploySchedules.detail.recoveredNotice)).toBeInTheDocument();
    expect(screen.getByText(MESSAGES.deploySchedules.detail.revertLink(33))).toBeInTheDocument();
  });

  it('지연 실행(delaySeconds>0)이면 지연 안내를 표시하고, 0이면 표시하지 않는다', () => {
    const { rerender } = renderPanel(
      makeDetail({
        outcome: 'APPLIED',
        delaySeconds: 420,
        resultSummary: { kind: 'RESTORE', backupVersionNo: 1, backupVersionId: 'v1', counts: {}, reindexWasRunning: false, classifierDeleted: false },
      }),
    );
    expect(screen.getByText(MESSAGES.deploySchedules.detail.delayedNotice(420))).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ScheduleResultSummaryPanel
          chatbotId={CHATBOT_ID}
          detail={makeDetail({
            outcome: 'APPLIED',
            delaySeconds: 0,
            resultSummary: { kind: 'RESTORE', backupVersionNo: 1, backupVersionId: 'v1', counts: {}, reindexWasRunning: false, classifierDeleted: false },
          })}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/지연 실행/)).not.toBeInTheDocument();
  });

  it('재색인 진행 중·분류기 삭제 안내가 각 플래그에 따라 렌더된다', () => {
    renderPanel(
      makeDetail({
        outcome: 'APPLIED',
        resultSummary: {
          kind: 'RESTORE',
          backupVersionNo: 1,
          backupVersionId: 'v1',
          counts: {},
          reindexWasRunning: true,
          classifierDeleted: true,
        },
      }),
    );
    expect(screen.getByText(MESSAGES.versions.restore.result.reindexContinueNotice)).toBeInTheDocument();
    expect(screen.getByText(MESSAGES.versions.restore.result.classifierDeletedNotice)).toBeInTheDocument();
  });

  it('G3 postRunTest — STARTED면 TC 결과 링크, 그 외(SKIPPED 등)는 안내 문구를 표시한다', () => {
    const { rerender } = renderPanel(
      makeDetail({
        outcome: 'APPLIED',
        resultSummary: {
          kind: 'RESTORE',
          backupVersionNo: 1,
          backupVersionId: 'v1',
          counts: {},
          reindexWasRunning: false,
          classifierDeleted: false,
          postRunTest: { status: 'STARTED', testRunId: 'run-1' },
        },
      }),
    );
    const link = screen.getByRole('link', { name: MESSAGES.deploySchedules.detail.tcResultLink });
    expect(link).toHaveAttribute('href', `/chatbots/${CHATBOT_ID}/validation/runs/run-1`);

    rerender(
      <MemoryRouter>
        <ScheduleResultSummaryPanel
          chatbotId={CHATBOT_ID}
          detail={makeDetail({
            outcome: 'APPLIED',
            resultSummary: {
              kind: 'RESTORE',
              backupVersionNo: 1,
              backupVersionId: 'v1',
              counts: {},
              reindexWasRunning: false,
              classifierDeleted: false,
              postRunTest: { status: 'SKIPPED', reason: 'TEST_SET_EMPTY' },
            },
          })}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(MESSAGES.deploySchedules.detail.postRunTestSkipped)).toBeInTheDocument();
  });

  it('PUBLISH — 상태 전이를 표시하고, 채널 값이 바뀌지 않았으면 채널 줄을 생략한다', () => {
    const { rerender } = renderPanel(
      makeDetail({
        action: 'PUBLISH',
        outcome: 'APPLIED',
        resultSummary: { kind: 'PUBLISH', statusBefore: 'DRAFT', statusAfter: 'ACTIVE', channelBefore: false, channelAfter: true },
      }),
    );
    expect(screen.getByText('DRAFT → ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('false → true')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ScheduleResultSummaryPanel
          chatbotId={CHATBOT_ID}
          detail={makeDetail({
            action: 'PUBLISH',
            outcome: 'NOOP',
            resultSummary: { kind: 'PUBLISH', statusBefore: 'ACTIVE', statusAfter: 'ACTIVE', channelBefore: true, channelAfter: true },
          })}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('ACTIVE → ACTIVE')).toBeInTheDocument();
    expect(screen.queryByText('true → true')).not.toBeInTheDocument();
  });

  it('SET_WEB_CHANNEL — before/after를 렌더한다(before=null이면 대시로 표시)', () => {
    renderPanel(
      makeDetail({
        action: 'SET_WEB_CHANNEL',
        outcome: 'APPLIED',
        resultSummary: { kind: 'SET_WEB_CHANNEL', channelBefore: null, channelAfter: true },
      }),
    );
    expect(screen.getByText('— → true')).toBeInTheDocument();
  });
});
