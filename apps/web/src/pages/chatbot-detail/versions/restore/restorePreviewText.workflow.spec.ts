import { describe, expect, it } from 'vitest';
import { warningText } from './restorePreviewText';

/** WF7 — 버전 복원 미리보기 경고 2종(workflow-automation-ui-spec.md §3.9). */
describe('restorePreviewText.warningText — 업무 자동화(No.41)', () => {
  it('WORKFLOW_TARGET_MISSING — 존재하지 않는 발송 대상 참조 경고', () => {
    expect(warningText({ code: 'WORKFLOW_TARGET_MISSING', count: 1 })).toBe(
      '대상 버전의 노드 1개가 존재하지 않는 발송 대상을 참조합니다(복원 후 실행 시 발송이 건너뛰어집니다).',
    );
  });

  it('WORKFLOW_TARGET_DISABLED — 사용 중지된 발송 대상 참조 경고', () => {
    expect(warningText({ code: 'WORKFLOW_TARGET_DISABLED', count: 2 })).toBe(
      '대상 버전의 노드 2개가 사용 중지된 발송 대상을 참조합니다(복원 후 실행 시 발송이 건너뛰어집니다).',
    );
  });
});
