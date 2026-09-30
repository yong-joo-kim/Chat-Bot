import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UtteranceAnalysisDataMapSection } from './UtteranceAnalysisDataMapSection';

const map = {
  analyses: 4,
  utterances: 9120,
  retentionDays: 90,
  storesMaskedOnly: true as const,
  originalFileStored: false as const,
  exits: ['EMBEDDING' as const],
  nameSuggestEnabled: false,
  retentionJobEnabled: true,
};

/** UA-4 — 데이터 지도 "업로드 발화 분석" 절(deep-clustering-ui-spec.md §6.1). */
describe('UtteranceAnalysisDataMapSection', () => {
  it('저장 범위·규모·보존·보내는 곳을 글자로 보인다', () => {
    render(<UtteranceAnalysisDataMapSection map={map} />);

    expect(screen.getByRole('heading', { name: '업로드 발화 분석' })).toBeInTheDocument();
    expect(screen.getByText('가려진 문장만 저장합니다. 올린 원본 파일은 저장하지 않습니다.')).toBeInTheDocument();
    expect(screen.getByText('분석 4건 · 발화 9120개')).toBeInTheDocument();
    expect(screen.getByText('새 분석은 90일 뒤 자동으로 삭제됩니다.')).toBeInTheDocument();
    expect(screen.getByText(/보내는 곳: 문장 분석 서비스$/)).toBeInTheDocument();
    expect(screen.queryByText(/이름 제안 사용 중/)).not.toBeInTheDocument();
    expect(screen.queryByText(/자동 삭제 작업이 꺼져 있어/)).not.toBeInTheDocument();
  });

  it('이름 제안용 로컬 생성기 출구와 "이름 제안 사용 중"을 밝힌다', () => {
    render(<UtteranceAnalysisDataMapSection map={{ ...map, exits: ['EMBEDDING', 'AUGMENT_LOCAL'], nameSuggestEnabled: true }} />);

    expect(screen.getByText(/문장 분석 서비스 \+ 이름 제안용 로컬 생성기 · 이름 제안 사용 중/)).toBeInTheDocument();
  });

  it('자동 삭제 작업이 꺼져 있으면 주의 글자를 보인다(색 단독 아님)', () => {
    render(<UtteranceAnalysisDataMapSection map={{ ...map, retentionJobEnabled: false }} />);

    expect(screen.getByText('자동 삭제 작업이 꺼져 있어 보존 기간이 지나도 삭제되지 않습니다.')).toBeInTheDocument();
  });
});
