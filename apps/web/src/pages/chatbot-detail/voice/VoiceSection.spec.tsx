import { forwardRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { VoiceOverviewResponse, VoiceStatsResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { ApiError } from '../../../api/client';
import { VoiceSection } from './VoiceSection';

let canWrite = true;
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => (p === 'channel:write' ? canWrite : true) }),
}));

const mockGetOverview = vi.fn();
const mockSave = vi.fn();
const mockGetStats = vi.fn();
vi.mock('../../../api/voice', () => ({
  voiceApi: {
    getOverview: (...a: unknown[]) => mockGetOverview(...a),
    saveSettings: (...a: unknown[]) => mockSave(...a),
    getStats: (...a: unknown[]) => mockGetStats(...a),
  },
}));

const mockFindOne = vi.fn();
vi.mock('../../../api/dialogue', () => ({ dialogNodesApi: { findOne: (...a: unknown[]) => mockFindOne(...a) } }));

const NODE_A = '33333333-3333-4333-8333-333333333333';
const NODE_B = '44444444-4444-4444-8444-444444444444';

/** 검색형 선택기는 실제 컴포넌트가 따로 시험된다 — 여기서는 "선택했다"는 사실만 흉내 낸다. */
vi.mock('../../../components/ResourcePickerField', () => ({
  ResourcePickerField: forwardRef<HTMLInputElement, { id: string; label: string; value: string | null; onChange: (v: string | null) => void; disabled?: boolean; excludeIds?: string[] }>(
    function MockPicker({ id, label, value, onChange, disabled, excludeIds }, ref) {
      return (
        <div>
          <label htmlFor={id}>{label}</label>
          <input id={id} ref={ref} readOnly disabled={disabled} value={value ?? ''} />
          {[NODE_A, NODE_B]
            .filter((n) => !(excludeIds ?? []).includes(n))
            .map((n) => (
              <button key={n} type="button" onClick={() => onChange(n)}>
                {`노드 고르기 ${n.slice(0, 2)}`}
              </button>
            ))}
        </div>
      );
    },
  ),
}));

const EMPTY_STATS: VoiceStatsResponse = {
  from: '2026-09-25',
  to: '2026-10-01',
  totals: { requested: 0, ok: 0, empty: 0, invalid: 0, failed: 0, busy: 0 },
  daily: [{ day: '2026-10-01', requested: 0, ok: 0, empty: 0, invalid: 0, failed: 0, busy: 0 }],
};

function overview(over: Partial<VoiceOverviewResponse> = {}): VoiceOverviewResponse {
  return {
    settings: {
      inputEnabled: false,
      ttsEnabled: false,
      autoReadToggleVisible: true,
      rateMultiplier: 1,
      defaultTone: 'CALM',
      toneByKind: {},
      nodeTones: [],
      updatedAt: null,
    },
    server: { enabled: true, provider: 'local', inputAvailable: true },
    context: { webChannelEnabled: true, chatbotStatus: 'ACTIVE' },
    limits: { nodeTonesMax: 200 },
    ...over,
  } as VoiceOverviewResponse;
}

function renderSection(props: { isArchived?: boolean; onSummary?: (s: { inputEnabled: boolean; ttsEnabled: boolean }) => void } = {}): void {
  render(
    <ToastProvider>
      <VoiceSection chatbotId="bot-1" isArchived={props.isArchived ?? false} onSummary={props.onSummary} />
    </ToastProvider>,
  );
}

async function ready(): Promise<void> {
  await screen.findByRole('switch', { name: '음성 입력 사용' });
}

const sw = (name: string): HTMLElement => screen.getByRole('switch', { name });
/** 말투 라디오 그룹(들어보기에도 같은 이름의 라디오가 있어 그룹으로 범위를 좁힌다). */
const defaultToneGroup = (): HTMLElement => screen.getByRole('group', { name: /^기본 말투/ });
const unansweredToneGroup = (): HTMLElement => screen.getByRole('group', { name: /미응답\(폴백\) 안내 말투/ });

beforeEach(() => {
  canWrite = true;
  mockGetOverview.mockReset().mockResolvedValue(overview());
  mockSave.mockReset().mockResolvedValue({});
  mockGetStats.mockReset().mockResolvedValue(EMPTY_STATS);
  mockFindOne.mockReset().mockImplementation(async (_c: string, id: string) => ({ id, name: id === NODE_A ? '인사' : '환불 안내' }));
});

describe('VO-C1 진입 — 로딩·오류·기본값', () => {
  it('조회 중에는 스켈레톤을 보이고 끝나면 폼으로 바뀐다(최초 1회 조회)', async () => {
    renderSection();
    expect(document.querySelector('.skeleton')).not.toBeNull();
    await ready();
    expect(mockGetOverview).toHaveBeenCalledTimes(1);
    expect(mockGetOverview).toHaveBeenCalledWith('bot-1');
  });

  it('조회 실패는 ErrorState + 재시도 버튼', async () => {
    mockGetOverview.mockRejectedValueOnce(new Error('x'));
    renderSection();
    expect(await screen.findByText('음성 설정을 불러오지 못했습니다.')).toBeInTheDocument();
    mockGetOverview.mockResolvedValue(overview());
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await ready();
  });

  it('행 없음(updatedAt=null)은 오류가 아니라 기본값 폼 + "아직 저장한 적이 없습니다" 한 줄', async () => {
    renderSection();
    await ready();
    expect(screen.getByText('아직 저장한 적이 없습니다. 아래는 기본값입니다.')).toBeInTheDocument();
    expect(sw('음성 입력 사용')).toHaveAttribute('aria-checked', 'false');
    expect(sw('답변 듣기 사용')).toHaveAttribute('aria-checked', 'false');
    expect(sw('답변 소리로 듣기 스위치 보이기')).toHaveAttribute('aria-checked', 'true'); // H-7 기본 켜짐
    expect(screen.getByLabelText('읽기 속도 숫자 입력')).toHaveValue(1);
    expect(within(defaultToneGroup()).getByRole('radio', { name: /차분함/ })).toBeChecked(); // 기본 말투
    expect(within(unansweredToneGroup()).getByRole('radio', { name: /사과 \(기본\)/ })).toBeChecked(); // 미응답 말투 = 사과(기본)
    expect(screen.getByText('지정한 노드가 없습니다. 모든 답은 기본 말투(또는 미응답 말투)로 읽힙니다.')).toBeInTheDocument();
  });

  it('저장된 값이 있으면 그대로 채운다 · 요약을 부모에 알린다', async () => {
    const onSummary = vi.fn();
    mockGetOverview.mockResolvedValue(
      overview({
        settings: { inputEnabled: true, ttsEnabled: true, autoReadToggleVisible: false, rateMultiplier: 1.1, defaultTone: 'BRIGHT', toneByKind: { UNANSWERED: 'CALM' }, nodeTones: [], updatedAt: new Date() },
      } as never),
    );
    renderSection({ onSummary });
    await ready();
    expect(sw('음성 입력 사용')).toHaveAttribute('aria-checked', 'true');
    expect(sw('답변 소리로 듣기 스위치 보이기')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByLabelText('읽기 속도 숫자 입력')).toHaveValue(1.1);
    expect(onSummary).toHaveBeenCalledWith({ inputEnabled: true, ttsEnabled: true });
    expect(screen.queryByText('아직 저장한 적이 없습니다. 아래는 기본값입니다.')).not.toBeInTheDocument();
  });
});

describe('VO-C2 상태 배너', () => {
  it.each([
    [{ enabled: true, provider: 'local', inputAvailable: true }, '사용 가능', '음성 인식 서버를 사용할 수 있습니다.'],
    [{ enabled: true, provider: 'mock', inputAvailable: true }, '모의 인식', /시험용 모의 인식으로 동작 중입니다/],
    [{ enabled: false, provider: 'local', inputAvailable: false, reason: 'SERVER_DISABLED' }, '꺼짐', /서버에서 음성 인식이 꺼져 있습니다/],
    [{ enabled: true, provider: 'local', inputAvailable: false, reason: 'NOT_CONFIGURED' }, '설정 필요', /서버 주소가 설정되지 않았습니다/],
    [{ enabled: true, provider: 'local', inputAvailable: false, reason: 'PROVIDER_UNAVAILABLE' }, '사용 불가', /운영 환경에서 시험용 구성으로 실행 중인 경우입니다/],
  ])('서버 상태 %j → 글자 병기 배너', async (server, label, text) => {
    mockGetOverview.mockResolvedValue(overview({ server } as never));
    renderSection();
    await ready();
    const banner = screen.getByTestId('voice-server-status');
    expect(within(banner).getByText(label)).toBeInTheDocument();
    expect(within(banner).getByText(text)).toBeInTheDocument();
  });

  it('서버에 모델 이름·장치·주소 같은 운영 정보가 화면에 나오지 않는다', async () => {
    mockGetOverview.mockResolvedValue(overview({ server: { enabled: true, provider: 'local', inputAvailable: false, reason: 'PROVIDER_UNAVAILABLE' } } as never));
    renderSection();
    await ready();
    expect(screen.getByTestId('voice-server-status').textContent).not.toMatch(/whisper|cuda|http|:\d{4}|\.internal/i);
  });

  it('음성 입력이 켜져 있는데 서버가 불가이면 "말하기 버튼이 나타나지 않습니다" 한 줄을 더한다', async () => {
    mockGetOverview.mockResolvedValue(
      overview({
        settings: { ...overview().settings, inputEnabled: true },
        server: { enabled: false, provider: 'local', inputAvailable: false, reason: 'SERVER_DISABLED' },
      } as never),
    );
    renderSection();
    await ready();
    expect(screen.getByText(/방문자 화면에 말하기 버튼이 나타나지 않습니다/)).toBeInTheDocument();
  });

  it('법무 확인 전 경고는 상시 · 닫기 버튼이 없고 음성 입력 스위치 설명에 연결된다(켜기를 막지 않는다)', async () => {
    renderSection();
    await ready();
    const notice = screen.getByTestId('voice-legal-notice');
    expect(notice).toHaveTextContent('법무 확인 전입니다.');
    expect(within(notice).queryByRole('button')).toBeNull();
    expect(within(notice).queryByRole('checkbox')).toBeNull();
    expect(sw('음성 입력 사용').getAttribute('aria-describedby')).toContain(notice.id);
    await userEvent.click(sw('음성 입력 사용')); // 코드로 켜기를 막지 않는다
    expect(sw('음성 입력 사용')).toHaveAttribute('aria-checked', 'true');
  });

  it('맥락 배너 — 웹 채널 꺼짐 · 챗봇 비공개', async () => {
    mockGetOverview.mockResolvedValue(overview({ context: { webChannelEnabled: false, chatbotStatus: 'DRAFT' } } as never));
    renderSection();
    await ready();
    expect(screen.getByText('이 챗봇은 웹 채널이 꺼져 있어 방문자에게 표시되지 않습니다.')).toBeInTheDocument();
    expect(screen.getByText('챗봇이 공개되지 않아 방문자에게 표시되지 않습니다.')).toBeInTheDocument();
  });
});

describe('VO-C3 기능 설정 — 스위치 규칙', () => {
  it('서버 불가 ∧ 입력 꺼짐이면 aria-disabled + 이유(포커스 유지) · 눌러도 켜지지 않는다', async () => {
    mockGetOverview.mockResolvedValue(overview({ server: { enabled: false, provider: 'local', inputAvailable: false, reason: 'SERVER_DISABLED' } } as never));
    renderSection();
    await ready();
    const input = sw('음성 입력 사용');
    expect(input).toHaveAttribute('aria-disabled', 'true');
    expect(input).not.toBeDisabled();
    expect(input.getAttribute('aria-describedby')).toContain('reason');
    expect(screen.getByText('서버 음성 인식을 쓸 수 없어 켤 수 없습니다. 위의 서버 상태를 확인하세요.')).toBeInTheDocument();
    await userEvent.click(input);
    expect(input).toHaveAttribute('aria-checked', 'false');
  });

  it('이미 켜져 있으면 서버가 불가여도 끄기는 항상 가능하다(켜진 채 갇히지 않게) + 다시 켜지면 저장값대로 안내', async () => {
    mockGetOverview.mockResolvedValue(
      overview({
        settings: { ...overview().settings, inputEnabled: true },
        server: { enabled: false, provider: 'local', inputAvailable: false, reason: 'SERVER_DISABLED' },
      } as never),
    );
    renderSection();
    await ready();
    const input = sw('음성 입력 사용');
    expect(input).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('서버에서 음성 인식이 다시 켜지면 저장된 값대로 동작합니다.')).toBeInTheDocument();
    await userEvent.click(input);
    expect(input).toHaveAttribute('aria-checked', 'false');
  });

  it('답변 듣기는 서버 상태와 무관하게 조작할 수 있다', async () => {
    mockGetOverview.mockResolvedValue(overview({ server: { enabled: false, provider: 'local', inputAvailable: false, reason: 'SERVER_DISABLED' } } as never));
    renderSection();
    await ready();
    await userEvent.click(sw('답변 듣기 사용'));
    expect(sw('답변 듣기 사용')).toHaveAttribute('aria-checked', 'true');
  });

  it('"답변 소리로 듣기 스위치 보이기"는 듣기가 꺼져 있으면 aria-disabled + 이유(값은 보존)', async () => {
    renderSection();
    await ready();
    const toggle = sw('답변 소리로 듣기 스위치 보이기');
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('답변 듣기를 켜야 의미가 있습니다.')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(sw('답변 듣기 사용'));
    expect(toggle).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('상시 안내 — 목소리를 고를 수 없고 시스템 안내는 읽지 않는다 · 방문자가 직접 켜야 한다', async () => {
    renderSection();
    await ready();
    expect(screen.getByText('방문자 기기마다 목소리가 다릅니다. 목소리는 고를 수 없습니다.')).toBeInTheDocument();
    expect(screen.getByText('금지어 안내 · 일시 장애 · 답변 대기 같은 시스템 안내는 읽지 않습니다.')).toBeInTheDocument();
    expect(screen.getByText(/보이게 해도 소리는 나지 않습니다/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/목소리 선택|음성 선택/)).toBeNull();
  });
});

describe('읽기 속도 — 슬라이더 + 숫자 입력 병행', () => {
  it('두 컨트롤이 모두 있고 서로를 갱신하며 현재 값 텍스트가 상시 보인다', async () => {
    renderSection();
    await ready();
    const slider = screen.getByLabelText('읽기 속도 슬라이더') as HTMLInputElement;
    const number = screen.getByLabelText('읽기 속도 숫자 입력') as HTMLInputElement;
    expect(slider).toHaveAttribute('min', '0.8');
    expect(slider).toHaveAttribute('max', '1.2');
    expect(slider).toHaveAttribute('step', '0.05');
    expect(screen.getByTestId('voice-rate-value')).toHaveTextContent('1.00배');
    fireEvent.change(slider, { target: { value: '1.15' } });
    expect(number).toHaveValue(1.15);
    expect(screen.getByTestId('voice-rate-value')).toHaveTextContent('1.15배');
    fireEvent.change(number, { target: { value: '0.85' } });
    expect(slider.value).toBe('0.85');
    expect(screen.getByTestId('voice-rate-value')).toHaveTextContent('0.85배');
  });

  it('범위 밖·0.05 단위 아님은 저장 시점에 인라인 오류 + 숫자 입력으로 포커스(저장 요청 0)', async () => {
    renderSection();
    await ready();
    const number = screen.getByLabelText('읽기 속도 숫자 입력');
    fireEvent.change(number, { target: { value: '1.5' } });
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('0.8~1.2 사이로 입력하세요.')).toBeInTheDocument();
    expect(number).toHaveFocus();
    expect(number).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(number, { target: { value: '1.13' } });
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('0.05 단위로 입력하세요. (예: 0.95, 1.00, 1.05)')).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe('VO-C4 말투', () => {
  it('라디오 2그룹(fieldset/legend)이 있고 안전 문구는 차분함 고정·내용 불변 안내가 있다', async () => {
    renderSection();
    await ready();
    expect(screen.getByRole('group', { name: /기본 말투/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /미응답\(폴백\) 안내 말투/ })).toBeInTheDocument();
    expect(screen.getByText('안전 문구로 대체된 답변은 항상 "차분함"으로 읽으며 바꿀 수 없습니다.')).toBeInTheDocument();
    expect(screen.getByText(/말투는 글자 내용을 바꾸지 않고/)).toBeInTheDocument();
    // BLOCKED·ERROR 같은 종류는 항목 자체가 없다
    expect(screen.queryByText(/금지어 안내 말투|오류 말투|일시 장애 말투/)).toBeNull();
  });

  it('말투 값 표는 코드의 대응표를 그대로 읽어 렌더하고 "제안값 — 확정 전"을 표시한다(접이식)', async () => {
    renderSection();
    await ready();
    const toggle = screen.getByRole('button', { name: '말투 값 보기' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('제안값입니다. 실제 기기에서 들어 보고 확정하기 전까지 바뀔 수 있습니다.')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: '말투별 읽기 값(제안값)' });
    const calm = within(table).getByRole('row', { name: /차분함/ });
    expect(within(calm).getAllByRole('cell').map((c) => c.textContent)).toEqual(['조금 천천히, 조금 낮게 읽습니다', '0.95', '0.95', '1.0', '제안값 — 실제 기기 청취 후 확정']);
    expect(within(table).getAllByText('제안값 — 실제 기기 청취 후 확정')).toHaveLength(4);
    expect(screen.getByText(/안전 구간\(rate 0\.7~1\.3/)).toBeInTheDocument();
  });

  it('말투가 정해지는 순서 안내는 접이식(기본 닫힘)', async () => {
    renderSection();
    await ready();
    const toggle = screen.getByRole('button', { name: '말투가 정해지는 순서' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(screen.getByText('안전 문구로 대체된 답변은 차분함(고정)')).toBeInTheDocument();
  });
});

describe('저장 — 전체 교체 PUT', () => {
  it('기본값 그대로 저장하면 미응답 말투 키 없이 전체 값을 보낸다 · 저장 후 재조회 · 토스트', async () => {
    renderSection();
    await ready();
    await userEvent.click(sw('답변 듣기 사용'));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave).toHaveBeenCalledWith('bot-1', {
      inputEnabled: false,
      ttsEnabled: true,
      autoReadToggleVisible: true,
      rateMultiplier: 1,
      defaultTone: 'CALM',
      toneByKind: {},
      nodeTones: [],
    });
    expect(await screen.findByText('저장했습니다. 방문자에게 곧바로 반영됩니다.')).toBeInTheDocument();
    await waitFor(() => expect(mockGetOverview).toHaveBeenCalledTimes(2));
  });

  it('말투·속도·노드 말투를 바꾼 값이 그대로 PUT 본문에 담긴다', async () => {
    renderSection();
    await ready();
    await userEvent.click(within(defaultToneGroup()).getByRole('radio', { name: /밝게/ }));
    fireEvent.change(screen.getByLabelText('읽기 속도 숫자 입력'), { target: { value: '0.95' } });
    await userEvent.click(within(unansweredToneGroup()).getByRole('radio', { name: /안내/ }));
    await userEvent.click(screen.getByRole('button', { name: /^노드 고르기 33/ }));
    await userEvent.click(screen.getByRole('button', { name: '추가' }));
    await screen.findByText('인사');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    const body = mockSave.mock.calls[0][1] as Record<string, unknown>;
    expect(body.defaultTone).toBe('BRIGHT');
    expect(body.rateMultiplier).toBe(0.95);
    expect(body.toneByKind).toEqual({ UNANSWERED: 'INFORMATIVE' });
    expect(body.nodeTones).toEqual([{ nodeId: NODE_A, tone: 'BRIGHT' }]);
  });

  it('변경이 있으면 "저장하지 않은 변경이 있습니다."(role=status), 저장 후에는 사라진다', async () => {
    renderSection();
    await ready();
    const status = screen.getAllByRole('status').find((s) => s.className.includes('voice-dirty')) as HTMLElement;
    expect(status).toHaveTextContent('');
    await userEvent.click(sw('답변 듣기 사용'));
    expect(status).toHaveTextContent('저장하지 않은 변경이 있습니다.');
  });

  it('403은 폼이 aria-disabled라 도달 불가지만 방어적으로 토스트', async () => {
    mockSave.mockRejectedValue(new ApiError(403, 'x'));
    renderSection();
    await ready();
    await userEvent.click(sw('답변 듣기 사용'));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('편집 권한이 없습니다.')).toBeInTheDocument();
  });

  it('400 VALIDATION_FAILED는 토스트 + 폼 상단 요약 오류', async () => {
    mockSave.mockRejectedValue(new ApiError(400, 'x', 'VALIDATION_FAILED'));
    renderSection();
    await ready();
    await userEvent.click(sw('답변 듣기 사용'));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    const alerts = await screen.findAllByText('저장하지 못했습니다. 값을 확인한 뒤 다시 시도하세요.');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it('네트워크 오류는 연결 안내 토스트 · 입력값은 유지', async () => {
    mockSave.mockRejectedValue(new TypeError('Failed to fetch'));
    renderSection();
    await ready();
    await userEvent.click(sw('답변 듣기 사용'));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('저장하지 못했습니다. 연결을 확인하고 다시 시도하세요.')).toBeInTheDocument();
    expect(sw('답변 듣기 사용')).toHaveAttribute('aria-checked', 'true');
  });

  it('스냅샷·환경 밖 안내와 반영 지연(캐시) 안내가 폼 하단에 상시 보인다', async () => {
    renderSection();
    await ready();
    expect(screen.getByText(/버전 기록·운영 전환 대상이 아닙니다. 저장하면 방문자에게 곧바로 반영됩니다/)).toBeInTheDocument();
    expect(screen.getByText(/최대 약 1분이 걸릴 수 있습니다/)).toBeInTheDocument();
  });
});

describe('VO-C5 노드별 말투', () => {
  it('추가 버튼은 노드 미선택이면 aria-disabled + 이유 · 선택 후 추가하면 행이 생긴다', async () => {
    renderSection();
    await ready();
    const add = screen.getByRole('button', { name: '추가' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('추가할 노드를 먼저 선택하세요.')).toBeInTheDocument();
    await userEvent.click(add);
    expect(screen.queryByRole('table', { name: '노드별 말투' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^노드 고르기 33/ }));
    expect(screen.getByRole('button', { name: '추가' })).not.toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('button', { name: '추가' }));
    const table = await screen.findByRole('table', { name: '노드별 말투' });
    expect(within(table).getByText('인사')).toBeInTheDocument();
    expect(within(table).getByRole('combobox', { name: '인사 말투' })).toHaveValue('BRIGHT');
    expect(screen.getByText('(1/200)')).toBeInTheDocument();
    // 이미 지정한 노드는 후보에서 제외
    expect(screen.queryByRole('button', { name: /^노드 고르기 33/ })).toBeNull();
  });

  it('삭제는 저장 전까지 서버 반영이 없고, 삭제 뒤 포커스는 다음 행의 삭제 버튼 → 없으면 노드 선택 필드', async () => {
    mockGetOverview.mockResolvedValue(
      overview({
        settings: {
          ...overview().settings,
          nodeTones: [
            { nodeId: NODE_A, tone: 'BRIGHT', nodeName: '인사' },
            { nodeId: NODE_B, tone: 'CALM', nodeName: '환불 안내' },
          ],
        },
      } as never),
    );
    renderSection();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: '인사 노드 말투 삭제' }));
    expect(mockSave).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: '환불 안내 노드 말투 삭제' })).toHaveFocus());
    await userEvent.click(screen.getByRole('button', { name: '환불 안내 노드 말투 삭제' }));
    await waitFor(() => expect(screen.getByLabelText('노드 선택')).toHaveFocus());
    expect(screen.getByText('지정한 노드가 없습니다. 모든 답은 기본 말투(또는 미응답 말투)로 읽힙니다.')).toBeInTheDocument();
  });

  it('삭제된 노드(nodeMissing)는 행을 유지하고 주의 배지를 글자와 함께 보인다', async () => {
    mockGetOverview.mockResolvedValue(
      overview({ settings: { ...overview().settings, nodeTones: [{ nodeId: NODE_A, tone: 'BRIGHT', nodeName: '환불 안내', nodeMissing: true }] } } as never),
    );
    renderSection();
    await ready();
    expect(screen.getByText(/노드를 찾을 수 없음 — 적용되지 않음/)).toBeInTheDocument();
    expect(screen.getByText('환불 안내 (삭제됨)')).toBeInTheDocument();
  });

  it('저장 시 INVALID_REFERENCE면 해당 행에 인라인 오류 + 첫 오류 행으로 포커스', async () => {
    mockGetOverview.mockResolvedValue(
      overview({
        settings: {
          ...overview().settings,
          nodeTones: [
            { nodeId: NODE_A, tone: 'BRIGHT', nodeName: '인사' },
            { nodeId: NODE_B, tone: 'CALM', nodeName: '환불 안내' },
          ],
        },
      } as never),
    );
    mockSave.mockRejectedValue(new ApiError(400, 'x', 'INVALID_REFERENCE', [{ field: 'nodeTones', message: `노드를 찾을 수 없습니다: ${NODE_B}` }]));
    renderSection();
    await ready();
    await userEvent.click(sw('답변 듣기 사용'));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    const error = await screen.findByText('이 챗봇의 노드가 아닙니다. 노드를 다시 선택하세요.');
    expect(error.closest('tr')).toHaveAttribute('data-node-id', NODE_B);
    await waitFor(() => expect(screen.getByRole('combobox', { name: '환불 안내 말투' })).toHaveFocus());
  });

  it('상한 200개에 도달하면 추가 버튼이 aria-disabled + 안내', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ nodeId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, tone: 'CALM' as const, nodeName: `노드${i}` }));
    mockGetOverview.mockResolvedValue(overview({ settings: { ...overview().settings, nodeTones: rows } } as never));
    renderSection();
    await ready();
    expect(screen.getByRole('button', { name: '추가' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('노드별 말투는 최대 200개까지 지정할 수 있습니다.')).toBeInTheDocument();
  });
});

describe('권한 · 보관', () => {
  it('channel:read만 있으면 폼은 보이되 스위치·속도·말투·노드·저장이 aria-disabled + "편집 권한이 없습니다"', async () => {
    canWrite = false;
    renderSection();
    await ready();
    expect(sw('음성 입력 사용')).toHaveAttribute('aria-disabled', 'true');
    expect(sw('답변 듣기 사용')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByLabelText('읽기 속도 슬라이더')).toHaveAttribute('aria-disabled', 'true');
    expect(within(defaultToneGroup()).getByRole('radio', { name: /밝게/ })).toHaveAttribute('aria-disabled', 'true');
    const save = screen.getByRole('button', { name: '저장' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getAllByText('편집 권한이 없습니다.').length).toBeGreaterThan(0);
    await userEvent.click(sw('답변 듣기 사용'));
    expect(sw('답변 듣기 사용')).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(save);
    expect(mockSave).not.toHaveBeenCalled();
    // 들어보기·숫자 조회는 가능
    expect(screen.getByRole('button', { name: /들어보기/ })).toBeInTheDocument();
    expect(mockGetStats).toHaveBeenCalled();
  });

  it('보관됨(ARCHIVED) 챗봇은 쓰기 권한이 있어도 읽기 전용', async () => {
    renderSection({ isArchived: true });
    await ready();
    expect(screen.getByRole('button', { name: '저장' })).toHaveAttribute('aria-disabled', 'true');
    expect(sw('답변 듣기 사용')).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('VO-C7 인식 숫자', () => {
  const STATS: VoiceStatsResponse = {
    from: '2026-09-30',
    to: '2026-10-01',
    totals: { requested: 12, ok: 8, empty: 2, invalid: 1, failed: 1, busy: 0 },
    daily: [
      { day: '2026-09-30', requested: 5, ok: 3, empty: 1, invalid: 1, failed: 0, busy: 0 },
      { day: '2026-10-01', requested: 7, ok: 5, empty: 1, invalid: 0, failed: 1, busy: 0 },
    ],
  };

  it('기본 최근 7일로 1회 조회하고, 표(머리 scope·합계 tfoot)·요약 배지·완료 낭독·열 설명을 보인다(그래프 없음)', async () => {
    mockGetStats.mockResolvedValue(STATS);
    renderSection();
    await ready();
    await waitFor(() => expect(mockGetStats).toHaveBeenCalledTimes(1));
    const [, query] = mockGetStats.mock.calls[0] as [string, { from: string; to: string }];
    const days = (new Date(`${query.to}T00:00:00Z`).getTime() - new Date(`${query.from}T00:00:00Z`).getTime()) / 86400000 + 1;
    expect(days).toBe(7);
    const table = await screen.findByRole('table', { name: '일별 음성 인식 숫자' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['날짜', '요청', '성공', '말소리 없음', '형식 오류', '실패', '혼잡']);
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]).getByRole('rowheader')).toHaveTextContent('2026-10-01'); // 최신 위
    const footer = within(table).getAllByRole('row').at(-1) as HTMLElement;
    expect(within(footer).getByRole('rowheader')).toHaveTextContent('합계');
    expect(within(footer).getAllByRole('cell').map((c) => c.textContent)).toEqual(['12', '8', '2', '1', '1', '0']);
    expect(screen.getByText('2일 · 요청 12건')).toBeInTheDocument();
    expect(screen.getByTestId('voice-stats-announce')).toHaveTextContent('2026-09-30부터 2026-10-01까지 조회했습니다.');
    expect(screen.getByText('성공: 글자로 바꾼 횟수')).toBeInTheDocument();
    expect(screen.getByText(/숫자만 기록합니다. 목소리와 인식된 글자는 저장하지 않습니다/)).toBeInTheDocument();
    expect(document.querySelector('canvas, svg[role="img"]')).toBeNull();
  });

  it('기간 전체가 0이면 표는 0으로 채워 보이고 위에 한 줄 안내', async () => {
    renderSection();
    await ready();
    expect(await screen.findByText('이 기간에 음성 인식 요청이 없습니다.')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '일별 음성 인식 숫자' })).toBeInTheDocument();
  });

  it('90일 초과·시작>끝은 인라인 오류이고 조회 버튼을 눌렀을 때만 요청한다(입력 중 자동 조회 없음)', async () => {
    renderSection();
    await ready();
    await waitFor(() => expect(mockGetStats).toHaveBeenCalledTimes(1));
    const from = screen.getByLabelText('시작');
    const to = screen.getByLabelText('끝');
    fireEvent.change(from, { target: { value: '2026-01-01' } });
    fireEvent.change(to, { target: { value: '2026-10-01' } });
    expect(mockGetStats).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '조회' }));
    expect(await screen.findByText('기간은 최대 90일이며 시작일이 끝일보다 앞서야 합니다.')).toBeInTheDocument();
    expect(from).toHaveFocus();
    expect(mockGetStats).toHaveBeenCalledTimes(1);
    fireEvent.change(from, { target: { value: '2026-09-25' } });
    await userEvent.click(screen.getByRole('button', { name: '조회' }));
    await waitFor(() => expect(mockGetStats).toHaveBeenCalledTimes(2));
    expect(mockGetStats).toHaveBeenLastCalledWith('bot-1', { from: '2026-09-25', to: '2026-10-01' });
  });

  it('조회 실패는 ErrorState + 재시도(다른 영역은 정상)', async () => {
    mockGetStats.mockRejectedValueOnce(new Error('x'));
    renderSection();
    await ready();
    expect(await screen.findByText('인식 숫자를 불러오지 못했습니다.')).toBeInTheDocument();
    expect(sw('음성 입력 사용')).toBeInTheDocument();
    mockGetStats.mockResolvedValue(STATS);
    const retry = screen.getAllByRole('button', { name: '다시 시도' });
    await userEvent.click(retry[retry.length - 1]);
    expect(await screen.findByRole('table', { name: '일별 음성 인식 숫자' })).toBeInTheDocument();
  });
});
