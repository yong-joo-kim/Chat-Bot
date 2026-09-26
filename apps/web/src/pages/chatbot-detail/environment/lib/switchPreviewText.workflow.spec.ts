import { describe, expect, it } from 'vitest';
import { SwitchWarningText } from './switchPreviewText';

/** WF7 — 운영 전환 미리보기 경고에도 No.25 복원 경고와 같은 문구를 재사용한다(workflow-automation-설계.md §16). */
describe('SwitchWarningText — 업무 자동화(No.41)', () => {
  it('WORKFLOW_TARGET_MISSING — 복원 경고와 동일 문구', () => {
    expect(SwitchWarningText({ code: 'WORKFLOW_TARGET_MISSING', count: 3 })).toBe(
      '대상 버전의 노드 3개가 존재하지 않는 발송 대상을 참조합니다(복원 후 실행 시 발송이 건너뛰어집니다).',
    );
  });

  it('WORKFLOW_TARGET_DISABLED — 복원 경고와 동일 문구', () => {
    expect(SwitchWarningText({ code: 'WORKFLOW_TARGET_DISABLED', count: 1 })).toBe(
      '대상 버전의 노드 1개가 사용 중지된 발송 대상을 참조합니다(복원 후 실행 시 발송이 건너뛰어집니다).',
    );
  });
});
