import { useEffect, useRef, useState } from 'react';
import { SPEECH_LIMITS } from '@chat-bot/shared-types';
import type { VoiceStatsResponse } from '@chat-bot/shared-types';
import { voiceApi } from '../../../api/voice';
import { ErrorState } from '../../../components/ErrorState';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { SkeletonRow } from '../../../components/Skeleton';
import { MESSAGES } from '../../../constants/messages';
import { kstTodayDateInputValue } from '../../../lib/date';

const DAY_MS = 24 * 60 * 60 * 1000;

function shiftDay(day: string, deltaDays: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + deltaDays * DAY_MS).toISOString().slice(0, 10);
}

/** 기간 검증 — 시작 ≤ 끝 · 양 끝 포함 최대 90일(서버 `resolveVoiceStatsRange`와 같은 규칙). */
export function isValidStatsRange(from: string, to: string): boolean {
  if (!from || !to || from > to) return false;
  const span = (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS + 1;
  return span <= SPEECH_LIMITS.statsRangeDaysMax;
}

const COLUMNS = ['requested', 'ok', 'empty', 'invalid', 'failed', 'busy'] as const;

/**
 * VO-C7 일별 인식 숫자 — **표가 원천이다(그래프 없음)**. 목소리·글자·세션은 저장하지 않고 일별 건수만 센다(P-15). 읽기(듣기) 횟수는 집계하지
 * 않는다. 조회 버튼을 눌렀을 때만 요청한다(입력 중 자동 조회 없음 — 최초 1회 기본 기간 조회만). 모바일은 날짜별 카드 리스트로 바뀐다.
 */
export function VoiceStatsPanel({ chatbotId }: { chatbotId: string }): JSX.Element {
  const msg = MESSAGES.voice;
  const today = kstTodayDateInputValue();
  const [from, setFrom] = useState(shiftDay(today, -(SPEECH_LIMITS.statsRangeDaysDefault - 1)));
  const [to, setTo] = useState(today);
  const [data, setData] = useState<VoiceStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rangeError, setRangeError] = useState<string | undefined>(undefined);
  const [announce, setAnnounce] = useState('');
  const fromRef = useRef<HTMLInputElement>(null);

  async function load(rangeFrom: string, rangeTo: string): Promise<void> {
    setLoading(true);
    setError(false);
    try {
      const res = await voiceApi.getStats(chatbotId, { from: rangeFrom, to: rangeTo });
      setData(res);
      setAnnounce(msg.statsAnnounce(res.from, res.to));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(from, to);
    // 최초 1회 기본 기간 조회만 — 이후는 조회 버튼으로만.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbotId]);

  function handleQuery(): void {
    if (!isValidStatsRange(from, to)) {
      setRangeError(msg.statsRangeError);
      fromRef.current?.focus();
      return;
    }
    setRangeError(undefined);
    void load(from, to);
  }

  const labels: Record<(typeof COLUMNS)[number], string> = {
    requested: msg.statsColRequested,
    ok: msg.statsColOk,
    empty: msg.statsColEmpty,
    invalid: msg.statsColInvalid,
    failed: msg.statsColFailed,
    busy: msg.statsColBusy,
  };
  const daily = data ? [...data.daily].sort((a, b) => (a.day < b.day ? 1 : -1)) : [];

  return (
    <section className="voice-block" aria-labelledby="voice-stats-title">
      <h4 id="voice-stats-title">{msg.statsTitle}</h4>
      <div className="form-field form-field--inline voice-stats-range">
        <label htmlFor="voice-stats-from">{msg.statsFromLabel}</label>
        <input
          id="voice-stats-from"
          ref={fromRef}
          type="date"
          value={from}
          aria-invalid={Boolean(rangeError)}
          aria-describedby={rangeError ? 'voice-stats-range-error' : undefined}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span aria-hidden="true">~</span>
        <label htmlFor="voice-stats-to">{msg.statsToLabel}</label>
        <input id="voice-stats-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <button type="button" className="btn btn-secondary" onClick={handleQuery}>
          {msg.statsQueryButton}
        </button>
      </div>
      <InlineFieldError id="voice-stats-range-error" message={rangeError} />
      <p className="field-hint">
        <span aria-hidden="true">ⓘ</span> {msg.statsNotice}
      </p>
      <p className="sr-only" role="status" aria-live="polite" data-testid="voice-stats-announce">
        {announce}
      </p>

      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && error && <ErrorState title={msg.statsLoadFailed} onRetry={() => void load(from, to)} />}
      {!loading && !error && data && (
        <>
          <p>
            <span className="channel-status-badge channel-status-badge--neutral">{msg.statsSummary(data.daily.length, data.totals.requested)}</span>
          </p>
          {data.totals.requested === 0 && <p className="field-hint">{msg.statsEmpty}</p>}
          <div className="dialogue-table-wrap">
            <table className="dialogue-table desktop-only voice-stats-table">
              <caption className="sr-only">{msg.statsCaption}</caption>
              <thead>
                <tr>
                  <th scope="col">{msg.statsColDay}</th>
                  {COLUMNS.map((c) => (
                    <th key={c} scope="col" className="voice-num">
                      {labels[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.day}>
                    <th scope="row">{d.day}</th>
                    {COLUMNS.map((c) => (
                      <td key={c} className="voice-num">
                        {d[c]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{msg.statsTotal}</th>
                  {COLUMNS.map((c) => (
                    <td key={c} className="voice-num">
                      {data.totals[c]}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
            <ul className="settings-card-list mobile-only">
              {daily.map((d) => (
                <li key={d.day} className="settings-card">
                  <div className="settings-card-header">
                    <span className="settings-card-title">{d.day}</span>
                  </div>
                  <dl className="settings-card-fields">
                    {COLUMNS.map((c) => (
                      <div key={c}>
                        <dt>{labels[c]}</dt>
                        <dd>{d[c]}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
              <li className="settings-card">
                <div className="settings-card-header">
                  <span className="settings-card-title">{msg.statsTotal}</span>
                </div>
                <dl className="settings-card-fields">
                  {COLUMNS.map((c) => (
                    <div key={c}>
                      <dt>{labels[c]}</dt>
                      <dd>{data.totals[c]}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            </ul>
          </div>
          <p className="field-hint">{msg.statsSum}</p>
          <ul className="voice-info-list">
            {msg.statsDefinitions.map((line) => (
              <li key={line} className="field-hint">
                {line}
              </li>
            ))}
          </ul>
          <p className="field-hint">
            <span aria-hidden="true">ⓘ</span> {msg.statsWatch}
          </p>
        </>
      )}
    </section>
  );
}
