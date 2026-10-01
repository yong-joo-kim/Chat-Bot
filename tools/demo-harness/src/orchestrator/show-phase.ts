// 공연(시나리오 실행) 단계 — 브라우저 세션을 열고 선택한 구간의 단계 정의를 순서대로 실행한다. (2단계: 장면 1~4. Enter 대기·영상·보고서는 3단계)
import { join } from 'node:path';
import type { CliOptions } from '../cli/args';
import type { Ports } from '../config';
import { BrowserSession, StageController } from '../browser/session';
import type { DatasetIds } from '../data/types';
import type { ApiSessions, PresetDef, RunState, SegmentDef } from '../scenario/types';
import { runScenario, type ScenarioResult, type StepResult } from '../scenario/runner';
import type { Terminal } from '../log/terminal';
import type { RunPaths } from '../run/run-dir';
import { formatMmSs } from '../util/time';

export interface ShowInput {
  opts: CliOptions;
  preset: PresetDef;
  run: RunPaths;
  ports: Ports;
  ids: DatasetIds;
  api: ApiSessions;
  term: Terminal;
  signal: AbortSignal;
  state: RunState;
  /** 영상 인코더가 있을 때만(3단계에서 사용). */
  recordVideo?: boolean;
}

export interface ShowOutcome {
  scenario: ScenarioResult | null;
  session: BrowserSession | null;
  executedSegments: SegmentDef[];
}

/** 선택한(--only) 구간 중 단계 정의가 있는 구간만 실행 대상이다(2단계: 빈 슬롯은 건너뛴다). */
export function selectSegments(preset: PresetDef, only: CliOptions['only']): SegmentDef[] {
  return preset.segments.filter((s) => s.steps.length > 0 && (only === null || only.includes(s.key)));
}

const SKIP_TEXT: Record<string, string> = { TIME: '시간 부족', PRESENTER: '진행자 선택', OPTION: '옵션', DEPENDENCY: '선행 실패', NO_BROWSER: '브라우저 없음' };

export async function runShow(i: ShowInput): Promise<ShowOutcome> {
  const segments = selectSegments(i.preset, i.opts.only);
  if (segments.length === 0) {
    i.term.line('info', '실행할 장면이 없습니다(선택한 구간에 단계 정의가 없음)');
    return { scenario: null, session: null, executedSegments: [] };
  }
  const visible = i.opts.mode === 'visible';
  const total = segments.reduce((n, s) => n + s.budgetSec, 0);
  i.term.line('info', `공연 시작: 장면 ${segments.map((s) => s.key).join(' · ')} / 예산 ${formatMmSs(total)} / ${visible ? '보이는 시연(사람 속도·자막)' : '무인 점검(즉시 입력·자막 없음)'}`);

  const session = await BrowserSession.launch({
    browser: i.opts.browser,
    profileDir: i.run.browserProfile,
    viewport: i.opts.viewport,
    headless: !visible,
    stageUrl: `http://localhost:${i.ports.stage}/stage`,
    consoleLogFile: join(i.run.logs, 'browser-console.log'),
  });
  await session.openStage();
  const stage = new StageController(session.page);
  await stage.setReady(false);
  await stage.setTimer({ elapsedMs: 0, paused: false, totalSec: total });

  // 장면 3 대조용 통계 기준값(공연 시작 직전) — 로그 적재가 비동기라 증가분으로 확인한다
  const base = (await i.api.admin1.get('/stats/summary', { query: { chatbotId: i.ids.A.id } })).body as { totals: { turnCount: number; unansweredCount: number } };
  (i.state as { statsBaseline?: unknown }).statsBaseline = { turnCount: base.totals.turnCount, unansweredCount: base.totals.unansweredCount };

  const scenario = await runScenario({
    segments,
    mode: i.opts.mode,
    skipIds: i.opts.skip,
    failFast: i.opts.failFast,
    session,
    ids: i.ids,
    api: i.api,
    runId: i.run.runId,
    ports: { api: i.ports.api, console: i.ports.console, widget: i.ports.widget, stage: i.ports.stage },
    shotsDir: i.run.shots,
    signal: i.signal,
    state: i.state,
    totalBudgetSec: total,
    log: (m) => i.term.detail(m),
    onStep: (r, segTitle) => {
      const time = visible ? `${r.actualSec.toFixed(1)}초 / 예산 ${r.budgetSec}초${r.delay ? ` / ${r.delay}` : ''}` : `${r.actualSec.toFixed(1)}초`;
      const head = `${r.id} ${r.title}`;
      if (r.status === 'PASS') i.term.line('pass', `${head} (${time})`);
      else if (r.status === 'SKIPPED') i.term.line('skip', `${head} - ${SKIP_TEXT[r.skipReason ?? 'OPTION']}`);
      else if (r.status === 'FALLBACK') i.term.line('fallback', `${head} - 준비된 결과로 대신 보였습니다`, { why: r.failure?.message, how: '로그와 화면 캡처(FAIL)를 확인하세요' });
      else i.term.line('fail', `${head} (${segTitle} · ${r.core ? '핵심' : '생략 가능'}) - ${r.failure?.kind ?? ''}`, { why: r.failure?.message, how: r.failure?.kind === 'SELECTOR' ? '화면 문구가 바뀌었는지 확인하고 선택자(src/selectors)를 갱신하세요' : `shots/${r.id}-FAIL.png 와 logs/browser-console.log 를 확인하세요` });
    },
  });
  return { scenario, session, executedSegments: segments };
}
