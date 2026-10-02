// summary.md — 개발자용 요약(설계 §17.2). result.json과 같은 내용을 마크다운으로 — 이미지는 상대 링크.
import { skipReasonText } from './build';
import type { ResultJson } from './schema';

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const STATUS: Record<string, string> = { PASSED: '모두 통과', FAILED: '일부 실패', ABORTED: '중단됨', PREPARE_FAILED: '준비 실패 - 시연하지 못함' };
const STEP: Record<string, string> = { PASS: '통과', FAIL: '실패', SKIPPED: '건너뜀', FALLBACK: '대체' };

export function renderSummary(r: ResultJson): string {
  const c = { pass: 0, fail: 0, skip: 0, alt: 0 };
  for (const s of r.steps) c[s.status === 'PASS' ? 'pass' : s.status === 'FAIL' ? 'fail' : s.status === 'SKIPPED' ? 'skip' : 'alt']++;
  const L: string[] = [];
  L.push(`# 시연 결과 요약 - ${r.runId}`, '');
  L.push(`- 결과: **${STATUS[r.status]}** (종료 코드 ${r.exitCode})`);
  L.push(`- 프리셋 / 모드: ${r.preset} / ${r.mode === 'visible' ? '보이는 시연' : '무인 점검'}`);
  L.push(`- 통과 ${c.pass} · 실패 ${c.fail} · 건너뜀 ${c.skip} · 대체 ${c.alt}`);
  L.push(`- 소요: 준비 ${mmss(r.durations.prepareSec)} · ${r.mode === 'visible' ? '시연' : '점검'} ${mmss(r.durations.showSec)}${r.durations.pausedSec > 0 ? ` · 일시정지 ${mmss(r.durations.pausedSec)}` : ''}`);
  L.push(`- 커밋: ${r.commit.sha ? r.commit.sha.slice(0, 7) : '확인 못함'}${r.commit.dirty ? ' (작업 폴더 변경 있음)' : ''}`);
  L.push(`- 장비: ${r.machine.os} · ${r.machine.cpu} · RAM ${r.machine.ramGb}GB · GPU ${r.machine.gpu}(AI 추론에는 쓰지 않음)`);
  L.push(`- 브라우저: ${r.browser.kind} ${r.browser.version ?? ''} · Playwright ${r.browser.playwright} · 영상 ${r.browser.video ? '있음' : '없음'}`);
  if (r.embeddingLatency) {
    const e = r.embeddingLatency;
    L.push(`- 단건 지연: P50 ${Math.round(e.p50Ms)}ms · P95 ${Math.round(e.p95Ms)}ms · 대기 시간 ${e.decidedTimeoutMs}ms(${e.source === 'manual' ? '수동 지정' : '실측'}) · 라운드 ${e.rounds.map((x, i) => `${i + 1}:${Math.round(x.p95Ms)}ms`).join(' ')}`);
  }
  if (r.plan) {
    const pl = r.plan;
    L.push(`- 구성: 풀 투어 · 장면 ${pl.sceneCount}개 · 음성 입력 ${pl.voiceInput === 'real' ? `켬(${pl.sttDevice} ${pl.sttModel})` : pl.voiceInput === 'mock' ? '모의 점검' : '끔'} · 사내 생성 ${pl.localLlm ? '켬' : '끔'} · 실시간 분석 ${pl.liveClustering ? '켬' : '끔'} · GPU 사용: ${pl.gpuUseText} · 예산 ${mmss(pl.totalBudgetSec)}(제안값 · 미실측)`);
    if (pl.deviceNote) L.push(`- 음성 인식 장치 ${pl.deviceNote.kind === 'SELECTED' ? '선택(auto)' : '자동 대체'}: ${pl.deviceNote.reason}`);
    if (pl.inactive.length > 0) L.push(`- 이번 구성에서 생략: ${pl.inactive.map((x) => `${x.id}(${x.reason})`).join(' · ')}`);
    for (const m of r.models ?? []) L.push(`- 모델 ${m.role} · 포트 ${m.port} · ${m.modelId} · ${m.device}${m.computeType ? ' ' + m.computeType : ''}${m.note ? ' · ' + m.note : ''}`);
    if (r.speech) L.push(`- 음성 확인: 기대 "${r.speech.expected}" · 위젯 전사 "${r.speech.transcript ?? ''}" · 일치율 ${r.speech.matchRatio ?? '-'} · 핵심어 ${r.speech.keywordsOk} · 의도 ${r.speech.intentOk} · ${r.speech.source}(정확도 판정 아님)`);
    for (const v of r.vramMax ?? []) L.push(`- GPU 메모리 ${v.label}: ${v.usedMiB ?? '확인 못함'}MiB(관찰값)`);
  }
  L.push(`- 정리: 남은 프로세스 ${r.teardown.processesLeft}개 · 포트 ${r.teardown.portsFreed ? '해제' : '점유'} · dev.db ${r.teardown.devDbUnchanged ? '변경 없음' : '변경됨'}`, '');
  const fails = r.steps.filter((s) => s.status === 'FAIL');
  if (r.prepareFailure) L.push('## 준비 실패', '', `- ${r.prepareFailure.phase}: ${r.prepareFailure.message}`, `- 왜: ${r.prepareFailure.why ?? '-'}`, `- 조치: ${r.prepareFailure.how ?? '-'}`, '');
  if (fails.length > 0) {
    L.push('## 실패', '');
    for (const f of fails) L.push(`- **${f.id} ${f.title}** (${f.failure?.kind}) - ${f.failure?.message}`, `  - 재개: \`${f.failure?.resume ?? ''}\``);
    L.push('');
  }
  L.push('## 단계', '', '| 단계 | 제목 | 상태 | 예산 | 실측 | 캡처 |', '|---|---|---|---|---|---|');
  for (const s of r.steps) {
    const st = `${STEP[s.status]}${s.status === 'SKIPPED' ? `(${skipReasonText(s.skipReason)})` : ''}${s.delay ? ` ${s.delay}` : ''}`;
    L.push(`| ${s.id}${s.core ? ' (핵심)' : ''} | ${s.title} | ${st} | ${s.budgetSec}초 | ${s.actualSec.toFixed(1)}초 | ${s.captures.map((c) => `[${c}](../${c})`).join(' ')} |`);
  }
  L.push('', '## 정직성 표기', '');
  if (r.honesty.length === 0) L.push('- 해당 없음 (모형 서버를 쓰지 않았습니다)');
  for (const h of r.honesty) L.push(`- [${h.kind}] ${h.stepId ? `${h.stepId} · ` : ''}${h.text}`);
  L.push('', '## 외부 송신 점검표', '');
  for (const c2 of r.egressChecklist) L.push(`- ${c2.column ?? ''} / ${c2.item}: ${c2.state}${c2.evidence ? ` (${c2.evidence})` : ''}`);
  L.push('', '## 시연용 설정 공개표', '');
  for (const o of r.overrides) L.push(`- ${o.key} = ${o.value === '' ? '(빈 문자열)' : o.value} (기본 ${o.default}) - ${o.reason}`);
  if (r.warnings && r.warnings.length > 0) {
    L.push('', '## 진행 중 경고', '');
    for (const w of r.warnings) L.push(`- ${w}`);
  }
  L.push('');
  return L.join('\n');
}
