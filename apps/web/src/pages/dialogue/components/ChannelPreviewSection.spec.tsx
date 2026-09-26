import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DialogOutput } from '@chat-bot/shared-types';
import { ChannelPreviewSection } from './ChannelPreviewSection';

function carouselOutput(cards: Array<{ title: string; buttons?: unknown }>): DialogOutput {
  return { type: 'CAROUSEL', payload: { version: 1, cards } } as DialogOutput;
}

describe('ChannelPreviewSection — RM-3(§3.3)', () => {
  it('표시 아웃풋이 없으면 "표시할 응답이 없습니다"만 보인다', () => {
    render(<ChannelPreviewSection outputs={[]} />);
    expect(screen.getByText('표시할 응답이 없습니다.')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('4개 탭(웹·구버전 웹 위젯·카카오톡(예상)·텍스트만 채널(예상))이 보인다', () => {
    render(<ChannelPreviewSection outputs={[{ type: 'TEXT', payload: { text: '안녕하세요' } }]} />);
    expect(screen.getByRole('tab', { name: '웹' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '구버전 웹 위젯' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '카카오톡(예상)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '텍스트만 채널(예상 — 라인·페이스북 등)' })).toBeInTheDocument();
  });

  it('웹 탭은 강등이 없어 "예상 모습" 배지가 없다', () => {
    render(<ChannelPreviewSection outputs={[carouselOutput([{ title: 'A' }, { title: 'B' }])]} />);
    expect(screen.queryByText(/예상 모습/)).not.toBeInTheDocument();
    expect(screen.queryByText('바뀐 점')).not.toBeInTheDocument();
  });

  it('구버전 웹 위젯 탭은 캐러셀을 카드 여러 장으로 강등하고 "바뀐 점"을 보여준다("예상 모습" 배지는 없음)', () => {
    render(<ChannelPreviewSection outputs={[carouselOutput([{ title: 'A' }, { title: 'B' }])]} />);
    fireEvent.click(screen.getByRole('tab', { name: '구버전 웹 위젯' }));
    expect(screen.getByText('바뀐 점')).toBeInTheDocument();
    expect(screen.getByText('캐러셀이 카드 2장으로 나뉘어 보입니다.')).toBeInTheDocument();
    expect(screen.queryByText(/예상 모습/)).not.toBeInTheDocument();
  });

  it('카카오톡(예상) 탭은 "예상 모습" 배지를 보여준다', () => {
    render(<ChannelPreviewSection outputs={[{ type: 'TEXT', payload: { text: '안녕' } }]} />);
    fireEvent.click(screen.getByRole('tab', { name: '카카오톡(예상)' }));
    expect(screen.getByText('예상 모습(실제 규격 확인 전 추정)')).toBeInTheDocument();
  });

  it('텍스트만 채널(예상) 탭은 캐러셀을 텍스트로 강등하고 이미지 제거를 안내한다', () => {
    render(<ChannelPreviewSection outputs={[carouselOutput([{ title: 'A' }, { title: 'B' }])]} />);
    fireEvent.click(screen.getByRole('tab', { name: '텍스트만 채널(예상 — 라인·페이스북 등)' }));
    expect(screen.getByText('예상 모습(실제 규격 확인 전 추정)')).toBeInTheDocument();
    expect(screen.getByText('카드 대신 목록 텍스트로 보입니다.')).toBeInTheDocument();
  });

  it('DIALOG_MOVE로 끝나는 노드는 미리보기 제외 안내를 보여준다', () => {
    render(
      <ChannelPreviewSection
        outputs={[
          { type: 'TEXT', payload: { text: '안녕' } },
          { type: 'DIALOG_MOVE', payload: { targetNodeId: '11111111-1111-1111-1111-111111111111' } } as DialogOutput,
        ]}
      />,
    );
    expect(screen.getByText(/이 노드의 응답 뒤에는 다른 노드로 이동하는 아웃풋이 있어 미리보기에 포함되지 않습니다/)).toBeInTheDocument();
  });
});
