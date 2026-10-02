// [DT-2] 풀 투어 준비 완료 요약(ui-spec §16.3.3) — DT-1 §9.3 구조(제목 줄 · 구분선 · 요약 행 · 시연 계정 · 시작 전 확인 · 조작 키 · 엔터 대기)를 유지하고
// 요약 행을 **계획 문맥과 이번 실행에서 확인한 값**에서 만든다(고정 문구 금지 — 설계 DXD-13).
import type { Terminal } from '../log/terminal';
import { padEndWidth } from '../util/display-width';
import { formatMmSs } from '../util/time';
import { keyHelpLine } from '../control/presenter';
import { egressNames, gpuUse, GPU_USE_TEXT, type ResolvedPreset } from '../scenario/plan';
import type { FullRuntime } from './full-prepare';
import type { ReadySummaryInput } from './ready-summary';

/** 켠 옵션 한 줄(쉬운 말 — 켠 것만). */
export function optionsText(rt: FullRuntime): string {
  const on: string[] = [];
  if (rt.plan.voiceInput === 'real') on.push('음성 입력');
  if (rt.plan.voiceInput === 'mock') on.push('음성 입력(모의 점검)');
  if (rt.plan.localLlm) on.push('사내 생성 모델');
  if (rt.plan.liveClustering) on.push('실시간 분석');
  return on.length > 0 ? on.join(' · ') : '없음 (기본 투어)';
}

export function omittedText(rt: FullRuntime): string {
  const r = rt.resolved;
  const parts: string[] = [];
  for (const s of r.inactiveSegments) parts.push(s.reason.internal);
  for (const x of r.inactiveRows) if (!x.reason.hidden && !r.inactiveSegments.some((s) => s.key === x.segment)) parts.push(`${x.stepId} ${x.reason.internal}`);
  const uniq = [...new Set(parts)];
  return uniq.length > 0 ? uniq.join(' / ') : '없음';
}

/** 모델 구성 행(실제 올라간 값). */
export function modelRows(rt: FullRuntime): Array<{ role: string; text: string; sub?: string }> {
  const rows: Array<{ role: string; text: string; sub?: string }> = [];
  for (const m of rt.models) {
    if (m.role === 'embed') rows.push({ role: '문장 분석', text: `${m.modelId} · ${m.device === 'cpu' ? 'CPU' : m.device}   포트 ${m.port}` });
    else if (m.role === 'speech') {
      rows.push({
        role: '음성 인식',
        text: `${m.modelId} · ${m.device === 'cuda' ? 'GPU' : 'CPU'}${m.fallbackFrom ? ' (GPU 시작 실패 -> CPU로 다시 시작)' : ''}   포트 ${m.port}`,
        sub: rt.plan.localLlm && m.device === 'cuda' ? '(장면 10 직전에 내립니다)' : undefined,
      });
    } else rows.push({ role: '사내 생성', text: `${m.modelId.replace('ollama:', '')} · Ollama · 이 PC GPU   포트 ${m.port}`, sub: '(장면 10에서 올립니다 · 지금은 내려 둠)' });
  }
  return rows;
}

export function printFullReadySummary(term: Terminal, i: ReadySummaryInput, rt: FullRuntime, resolved: ResolvedPreset): void {
  const net = i.network === 'closed' ? '차단됨' : i.network === 'open' ? '열림' : '확인 못함';
  const p = rt.plan;
  const use = gpuUse(p);
  term.blank();
  term.rule('=');
  term.text(`${padEndWidth(' 시연 준비가 끝났습니다', 50)}준비 소요 ${formatMmSs(i.prepareSec)}`);
  term.rule('=');
  const row = (k: string, v: string) => term.text(` ${padEndWidth(k, 12)}${v}`);
  row('프리셋', `${i.presetId} (풀 투어 - 장면 ${resolved.sceneCount}개)`);
  row('예상 시간', `${formatMmSs(resolved.totalBudgetSec)}  (제안값 - 미실측 - 일시정지 제외)`);
  row('켠 옵션', optionsText(rt));
  row('생략한 장면', omittedText(rt));
  row('모드', `보이는 시연   브라우저 ${i.browser}${i.browserVersion ? ' ' + i.browserVersion : ''}   화면 ${i.viewport.width}x${i.viewport.height}   영상 ${i.videoOn ? '녹화' : '없음'}`);
  term.blank();
  term.text(' 모델 구성 (이번 실행에서 실제로 올라간 값)');
  for (const m of modelRows(rt)) {
    term.text(`   ${padEndWidth(m.role, 10)}${m.text}`);
    if (m.sub) term.text(`   ${padEndWidth('', 10)}${m.sub}`);
  }
  row('GPU 사용', GPU_USE_TEXT[use]);
  if (use !== 'none') {
    const g = rt.observer?.latest();
    if (g) term.text(`${padEndWidth('', 13)}메모리 ${g.usedMiB.toLocaleString('en-US')} / ${g.totalMiB.toLocaleString('en-US')} MiB (관찰값 - 판정 아님)`);
  }
  row('외부 송신', `외부 주소 설정 ${i.externalAddresses}개 - 네트워크 ${net}${i.governance === 'OFF' ? ' - 데이터 통제 모드 꺼짐' : ''}`);
  row('데이터 출구', `허용 ${egressNames(p).length}곳 (모두 이 PC 안)`);
  row('시연용 설정', i.embeddingTimeoutMs !== i.embeddingTimeoutDefault ? `문장 분석 대기 시간 ${i.embeddingTimeoutDefault}ms -> ${i.embeddingTimeoutMs}ms` : '바뀐 것 없음');
  if (p.voiceInput !== 'off' || rt.plan.deviceNote) row('음성 인식', p.deviceNote ? `장치 ${p.deviceNote.kind === 'SELECTED' ? '선택' : '대체'}: ${p.deviceNote.reason}` : `${p.sttModel ?? '모의 인식'} - ${p.sttDevice === 'cuda' ? 'GPU' : p.sttDevice === 'cpu' ? 'CPU' : '모의'}`);
  term.blank();
  if (i.credentials) {
    term.secretLine(' 시연 계정 (이 터미널에만 표시됩니다)');
    for (const k of ['admin1', 'admin2', 'agent'] as const) {
      const c = i.credentials[k];
      term.secretLine(`   ${padEndWidth(c.name, 16)}${padEndWidth(c.email, 20)}${c.password}`);
    }
    term.text(' 화면 공유 전에 이 터미널을 가리세요.');
    term.blank();
  }
  term.text(' 시작 전 확인  (모두 확인하면 엔터)');
  term.text(`   [ ] 화면 배율 100%, 프로젝터 해상도 ${i.viewport.width}x${i.viewport.height}`);
  term.text('   [ ] 스피커가 켜져 있고 음소거가 아닙니다 (장면 8에서 소리가 납니다)');
  if (p.voiceInput === 'real') term.text('       합성 음성은 가상 마이크로만 들어갑니다. 실제 마이크는 쓰지 않으며 되먹임은 없습니다');
  term.text('   [ ] 브라우저 창을 최소화하거나 클릭하지 마세요 (장면 9의 머문 시간 계산이 멈춥니다)');
  term.text(`   [ ] 시연 PC의 네트워크를 차단했습니다 (권장)${i.network === 'open' ? '  [주의] 현재 열림' : ''}`);
  if (use !== 'none') term.text('   [ ] 다른 GPU 프로그램(게임·영상 편집 등)이 꺼져 있습니다');
  term.text(p.localLlm ? '   [ ] Ollama가 실행 중이고 모델이 있습니다 (ollama list로 확인)' : '   [ ] Ollama 등 다른 AI 프로그램이 꺼져 있습니다 (트레이 아이콘에서 종료)');
  term.text('   [ ] 절전·알림(집중 지원)을 껐습니다');
  term.blank();
  term.text(' 조작 키 (이 터미널 창을 선택한 상태에서)');
  term.text(`   Enter 시연 시작   ${keyHelpLine(i.keyMode)}`);
  if (i.keyMode === 'lines') term.line('info', '이 터미널은 키 입력을 바로 받지 못해 줄 명령으로 동작합니다');
  term.blank();
  term.text('>> 준비가 끝났습니다. 엔터를 누르면 시연이 시작됩니다.');
  term.rule('=');
}
