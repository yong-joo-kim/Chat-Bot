import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import type { ApiConditionOutputPayloadV2 } from '@chat-bot/shared-types';
import { ApiConditionEditorV2 } from './ApiConditionEditorV2';

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));
vi.mock('../../../../api/apiConnections', () => ({
  apiConnectionsApi: {
    picker: vi.fn().mockResolvedValue({ items: [] }),
    samples: vi.fn().mockResolvedValue({ items: [] }),
  },
}));
vi.mock('../../../../api/dialogue', () => ({
  contextsApi: { list: vi.fn(), findOne: vi.fn() },
  dialogNodesApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }), findOne: vi.fn() },
}));

function basePayload(overrides: Partial<ApiConditionOutputPayloadV2> = {}): ApiConditionOutputPayloadV2 {
  return {
    version: 2,
    connectionId: '11111111-1111-1111-1111-111111111111',
    method: 'GET',
    path: '/orders',
    pathParams: [],
    query: [{ name: 'phone', value: { kind: 'CONST', value: '' } }],
    body: [],
    responseMappings: [{ name: 'status', path: 'data.status', required: false, maxLength: 200 }],
    conditions: [{ path: 'data.status', operator: 'EQ', value: 'A', nextNodeId: '22222222-2222-2222-2222-222222222222' }],
    defaultNodeId: '33333333-3333-3333-3333-333333333333',
    failureNodeId: '44444444-4444-4444-4444-444444444444',
    ...overrides,
  };
}

function Harness({ fieldErrors, initial }: { fieldErrors: Record<string, string>; initial: ApiConditionOutputPayloadV2 }): JSX.Element {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLElement | null>(null);
  return (
    <ApiConditionEditorV2
      value={value}
      onChange={setValue}
      chatbotId="bot-1"
      nodeContextVariableId={null}
      errPrefix="outputs.0.payload"
      fieldErrors={fieldErrors}
      firstFieldRef={ref}
    />
  );
}

/**
 * [No.26 1차 코드리뷰 반영] v2 폼 인라인 오류 연결 회귀. 서버 zod 검증 오류(`ZodValidationPipe`)는
 * `issue.path.join('.')`을 그대로 `details[].field`로 쓰므로, 각 필드는 `outputs.<i>.payload.X`
 * 경로(중간 "apiCondition" 세그먼트 없음)로 매핑돼야 한다.
 */
describe('ApiConditionEditorV2 — 인라인 오류 연결', () => {
  it('조건 행(path/operator/value/nextNodeId)의 서버 오류가 각 필드 아래 표시된다', () => {
    render(
      <Harness
        initial={basePayload()}
        fieldErrors={{
          'outputs.0.payload.conditions.0.path': '응답 경로 형식이 올바르지 않습니다.',
          'outputs.0.payload.conditions.0.nextNodeId': '선택한 노드를 찾을 수 없습니다. 목록을 새로고침해 주세요.',
        }}
      />,
    );

    expect(screen.getByText('응답 경로 형식이 올바르지 않습니다.')).toBeInTheDocument();
    expect(screen.getByText('선택한 노드를 찾을 수 없습니다. 목록을 새로고침해 주세요.')).toBeInTheDocument();
  });

  it('불일치 시/호출 실패 시 노드 피커의 서버 오류가 표시된다', () => {
    render(
      <Harness
        initial={basePayload()}
        fieldErrors={{
          'outputs.0.payload.defaultNodeId': '불일치 시 노드를 찾을 수 없습니다.',
          'outputs.0.payload.failureNodeId': '실패 시 노드를 찾을 수 없습니다.',
        }}
      />,
    );

    expect(screen.getByText('불일치 시 노드를 찾을 수 없습니다.')).toBeInTheDocument();
    expect(screen.getByText('실패 시 노드를 찾을 수 없습니다.')).toBeInTheDocument();
  });

  it('쿼리 이름 중복 오류(query.<j>.name)가 해당 행에 표시된다', () => {
    render(<Harness initial={basePayload()} fieldErrors={{ 'outputs.0.payload.query.0.name': '쿼리 이름 "phone"이(가) 중복됩니다.' }} />);

    expect(screen.getByText('쿼리 이름 "phone"이(가) 중복됩니다.')).toBeInTheDocument();
  });

  it('본문 필드 오류(body.<j>.field)가 POST 메서드일 때 해당 행에 표시된다', () => {
    render(
      <Harness
        initial={basePayload({ method: 'POST', body: [{ field: 'a', value: { kind: 'CONST', value: '1' } }] })}
        fieldErrors={{ 'outputs.0.payload.body.0.field': '본문 필드 "a"이(가) 다른 필드와 충돌합니다.' }}
      />,
    );

    expect(screen.getByText('본문 필드 "a"이(가) 다른 필드와 충돌합니다.')).toBeInTheDocument();
  });

  it('응답 매핑 오류(responseMappings.<j>.name/path)가 해당 행에 표시된다', () => {
    render(
      <Harness
        initial={basePayload()}
        fieldErrors={{
          'outputs.0.payload.responseMappings.0.name': '매핑 이름 "status"이(가) 중복됩니다.',
          'outputs.0.payload.responseMappings.0.path': '응답 경로 형식이 올바르지 않습니다.',
        }}
      />,
    );

    expect(screen.getByText('매핑 이름 "status"이(가) 중복됩니다.')).toBeInTheDocument();
    expect(screen.getByText('응답 경로 형식이 올바르지 않습니다.')).toBeInTheDocument();
  });

  it('연결/메서드/경로 최상위 오류도 함께 표시된다', () => {
    render(
      <Harness
        initial={basePayload()}
        fieldErrors={{
          'outputs.0.payload.connectionId': '선택한 연결을 찾을 수 없습니다. 목록을 새로고침해 주세요.',
          'outputs.0.payload.path': '경로 자리표시자 수와 경로 값 수가 일치해야 합니다.',
        }}
      />,
    );

    expect(screen.getByText('선택한 연결을 찾을 수 없습니다. 목록을 새로고침해 주세요.')).toBeInTheDocument();
    expect(screen.getByText('경로 자리표시자 수와 경로 값 수가 일치해야 합니다.')).toBeInTheDocument();
  });
});
