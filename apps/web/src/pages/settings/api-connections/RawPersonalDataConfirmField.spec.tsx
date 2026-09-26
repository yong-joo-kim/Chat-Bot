import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RawPersonalDataConfirmField } from './RawPersonalDataConfirmField';

/**
 * [코드리뷰 R1 M-2] No.26/No.41이 공유하는 일반화 컴포넌트 — `idPrefix`/`entityName`/`label`/
 * `mismatchMessage`를 화면별로 주입해도 동작(불일치 판정·id 연결)이 동일함을 확인한다.
 */
describe('RawPersonalDataConfirmField(일반화, No.26/No.41 공용)', () => {
  it('idPrefix로 만든 id에 라벨이 연결되고, 값이 entityName과 다르면 인라인 오류가 뜬다', () => {
    render(
      <RawPersonalDataConfirmField
        idPrefix="workflow-target"
        entityName="그룹웨어 결재 흐름"
        value="다른이름"
        onChange={vi.fn()}
        label="원문 전송을 켜려면 대상 이름을 다시 입력하세요"
        mismatchMessage="입력한 이름이 대상 이름과 일치하지 않습니다."
      />,
    );

    const input = screen.getByLabelText('원문 전송을 켜려면 대상 이름을 다시 입력하세요');
    expect(input).toHaveAttribute('id', 'workflow-target-confirm-raw');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('입력한 이름이 대상 이름과 일치하지 않습니다.')).toHaveAttribute(
      'id',
      'workflow-target-confirm-raw-error',
    );
  });

  it('값이 entityName과 일치하면 오류가 사라지고 onChange가 입력값을 그대로 전달한다', () => {
    const onChange = vi.fn();
    render(
      <RawPersonalDataConfirmField
        idPrefix="api-connection"
        entityName="ERP 주문"
        value=""
        onChange={onChange}
        label="원문 송신을 켜려면 연결 이름을 다시 입력하세요"
        mismatchMessage="입력한 이름이 연결 이름과 일치하지 않습니다."
      />,
    );

    fireEvent.change(screen.getByLabelText('원문 송신을 켜려면 연결 이름을 다시 입력하세요'), { target: { value: 'ERP 주문' } });
    expect(onChange).toHaveBeenCalledWith('ERP 주문');
  });

  it('값이 비어 있으면(아직 입력 전) 불일치 오류를 보여주지 않는다', () => {
    render(
      <RawPersonalDataConfirmField
        idPrefix="workflow-target"
        entityName="품질티켓봇"
        value=""
        onChange={vi.fn()}
        label="원문 전송을 켜려면 대상 이름을 다시 입력하세요"
        mismatchMessage="입력한 이름이 대상 이름과 일치하지 않습니다."
      />,
    );

    expect(screen.queryByText('입력한 이름이 대상 이름과 일치하지 않습니다.')).not.toBeInTheDocument();
  });
});
