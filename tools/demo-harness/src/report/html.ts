// 보고서 HTML(ui-spec §8 · 설계 §17.2) — 외부 CSS·JS·글꼴 0(스타일은 인라인) · 스크립트 0 · lang="ko" · 앵커 목차 · CSS만의 테마(:has) · 인쇄 CSS.
// 모든 동적 문자열은 HTML 이스케이프하고, 문서 안에 `://` 가 남지 않게 한다(H-T11 — 외부 URL 0). 내부판은 전부, 고객 전달판은 실패 상세·로그·내부 경로·계정 이메일·결함 후보를 뺀다.
import { isPathLike } from './public-value';
import { skipReasonText } from './build';
import type { HonestyKind, ResultJson, StepResultJson } from './schema';

/** 알려진 한계(설계 §21.5 고정 문구). */
export const KNOWN_LIMITS: readonly string[] = [
  '브라우저의 백그라운드 통신(업데이트·보안 검사 등)은 페이지 요청이 아니라 감시 범위 밖입니다. 네트워크 차단이 유일한 완전한 증거입니다.',
  '화면 그리기는 GPU를 쓸 수 있습니다. "GPU 없이 CPU로"는 AI 문장 분석에 한한 주장입니다.',
  'API는 모든 네트워크 인터페이스에서 접속을 받습니다(제품 동작). 시연 PC의 네트워크를 차단하세요.',
  '제품 설정 스키마 밖에서 환경변수를 직접 읽는 비밀(업무 자동화·레거시 연동·옴니채널 접두 규약)은 이번 시연에서 쓰지 않는 기능이라 영향이 없습니다.',
  '문장 분석 모델 캐시(HF)를 읽는 동안 캐시 폴더에 잠금 파일이 생길 수 있습니다.',
  '준비 단계 보정이 감사 로그 2행과 임베딩 캐시를 남깁니다.',
  '시간 수치는 이 노트북 기준의 추정·실측이며 영업 수치가 아닙니다.',
  '하네스는 API를 pnpm 해석 경로(NODE_PATH)와 함께 기동합니다. 제품 의존성 선언을 고치기 전에 제품을 직접 기동하면 실패할 수 있습니다.',
  '정직성: 연출·사전 준비는 이 보고서 "정직성 표기"에 모두 공개합니다.',
];

/** [DT-2] 풀 투어 보고서에만 더하는 알려진 한계(설계 §20.2). */
export const KNOWN_LIMITS_FULL: readonly string[] = [
  '합성 음성·가상 마이크 — 실제 사람 음성·실제 마이크가 아닙니다.',
  '영상·GIF에는 소리가 없습니다 — 현장 스피커로만 들립니다.',
  '이 노트북(RTX 3050 4GB)의 결과는 동작 확인 수준입니다 — 음성 인식 정확도·생성 품질·지연의 합격 판정이 아닙니다.',
  'GPU 메모리(VRAM) 수치는 관찰값이며 판정에 쓰지 않습니다.',
  '시연은 비운영 환경(NODE_ENV 미설정)으로 기동합니다 — 운영 환경의 모의 인식 차단은 재현하지 않습니다.',
  '음성 원본 저장 0 확인은 파일 앞부분(64KB)의 시그니처(매직 바이트)와 확장자를 보는 휴리스틱입니다(뒤쪽에 숨은 바이트·압축·암호화된 음성은 보지 못합니다).',
  '엑셀 내보내기의 행 수는 제품 감사 기록 기준이며 파일 내부 시트는 열어 보지 않습니다.',
  '가짜 마이크는 한 번의 녹음에 합성 음성 한 문장만 씁니다(실행당 한 문장).',
];

/** HTML 이스케이프 + `://` 제거(외부 URL 0). */
export function esc(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/:\/\//g, '&#58;//');
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const STATUS_TEXT: Record<StepResultJson['status'], string> = { PASS: '통과', FAIL: '실패', SKIPPED: '건너뜀', FALLBACK: '대체 화면' };
const STATUS_CLASS: Record<StepResultJson['status'], string> = { PASS: 'ok', FAIL: 'bad', SKIPPED: 'skip', FALLBACK: 'alt' };

function chip(cls: string, text: string): string {
  return `<span class="chip ${cls}"><i class="shape" aria-hidden="true"></i>${esc(text)}</span>`;
}

function stepChip(s: StepResultJson, customer: boolean, full = false): string {
  if (customer && s.status === 'FAIL') return chip('skip', '이번 시연에서 생략된 장면');
  // [DT-2] 풀 투어의 옵션 생략은 "이번 구성에서 생략"(시간 부족·진행자 선택과 구분)
  if (full && s.status === 'SKIPPED' && s.skipReason === 'OPTION') return chip('skip', '이번 구성에서 생략');
  const extra = s.status === 'SKIPPED' ? ` · ${skipReasonText(s.skipReason)}` : s.status === 'PASS' && s.delay ? ` · ${s.delay}` : '';
  return chip(STATUS_CLASS[s.status], `${STATUS_TEXT[s.status]}${extra}`);
}

const REPRESENTATIVE = ['S0-01', 'S1-05', 'S2-06', 'S3-02', 'S4-05', 'S5-04', 'S6-02', 'S7-04', 'S9-01'];
const OTHER_CORE = ['S1-03', 'S2-03', 'S3-03', 'S4-01', 'S5-03', 'S5-06', 'S6-03', 'S7-02'];

const CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1f2937;--muted:#4b5563;--border:#d1d5db;--card:#f9fafb;--primary:#4f46e5;--ok:#166534;--ok-bg:#f0fdf4;--bad:#991b1b;--bad-bg:#fef2f2;--skip:#374151;--skip-bg:#f3f4f6;--alt:#92400e;--alt-bg:#fffbeb;--focus:#4f46e5}
@media (prefers-color-scheme:dark){:root{--bg:#111827;--fg:#f3f4f6;--muted:#d1d5db;--border:#4b5563;--card:#1f2937;--primary:#a5b4fc;--ok:#86efac;--ok-bg:#052e16;--bad:#fca5a5;--bad-bg:#450a0a;--skip:#e5e7eb;--skip-bg:#374151;--alt:#fcd34d;--alt-bg:#451a03;--focus:#a5b4fc}}
body:has(#theme-light:checked){--bg:#fff;--fg:#1f2937;--muted:#4b5563;--border:#d1d5db;--card:#f9fafb;--primary:#4f46e5;--ok:#166534;--ok-bg:#f0fdf4;--bad:#991b1b;--bad-bg:#fef2f2;--skip:#374151;--skip-bg:#f3f4f6;--alt:#92400e;--alt-bg:#fffbeb;--focus:#4f46e5}
body:has(#theme-dark:checked){--bg:#111827;--fg:#f3f4f6;--muted:#d1d5db;--border:#4b5563;--card:#1f2937;--primary:#a5b4fc;--ok:#86efac;--ok-bg:#052e16;--bad:#fca5a5;--bad-bg:#450a0a;--skip:#e5e7eb;--skip-bg:#374151;--alt:#fcd34d;--alt-bg:#451a03;--focus:#a5b4fc}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 'Malgun Gothic','Noto Sans KR','Apple SD Gothic Neo',system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:16px 24px 64px}
h1{font-size:28px;margin:16px 0 8px}h2{font-size:22px;margin:32px 0 12px;border-bottom:2px solid var(--border);padding-bottom:4px}h3{font-size:18px;margin:16px 0 8px}
a{color:var(--primary)}a:focus-visible,summary:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.skip{position:absolute;left:-9999px;top:0;background:var(--bg);padding:8px 12px;z-index:10}.skip:focus{left:8px;top:8px}
.theme{display:flex;gap:16px;align-items:center;margin:8px 0}.theme label{min-height:44px;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
nav ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px 16px}nav a{display:inline-block;min-height:44px;line-height:44px}
table{border-collapse:collapse;width:100%;font-size:15px;margin:8px 0}caption{text-align:left;font-weight:700;padding:4px 0}th,td{border:1px solid var(--border);padding:6px 10px;text-align:left;vertical-align:top}th{background:var(--card)}
.scroll{overflow-x:auto}
.chip{display:inline-flex;align-items:center;gap:6px;border-radius:999px;border:2px solid currentColor;padding:0 10px;font-weight:700;font-size:14px;white-space:nowrap}
.chip .shape{display:inline-block;width:10px;height:10px;border:2px solid currentColor;border-radius:50%}
.chip.ok{color:var(--ok);background:var(--ok-bg)}.chip.bad{color:var(--bad);background:var(--bad-bg)}.chip.bad .shape{border-radius:0;transform:rotate(45deg)}
.chip.skip{color:var(--skip);background:var(--skip-bg)}.chip.skip .shape{border-radius:0}.chip.alt{color:var(--alt);background:var(--alt-bg)}.chip.alt .shape{border-radius:0;clip-path:polygon(50% 0,100% 100%,0 100%);background:currentColor;border:0}
.banner{display:flex;align-items:center;gap:12px;min-height:64px;padding:8px 20px;border-radius:8px;font-size:28px;font-weight:700;border:3px solid currentColor}
.banner.ok{color:var(--ok);background:var(--ok-bg)}.banner.bad{color:var(--bad);background:var(--bad-bg)}.banner.alt{color:var(--alt);background:var(--alt-bg)}
.counts{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:12px 0}.counts div{border:1px solid var(--border);border-radius:8px;padding:8px 12px;background:var(--card)}.counts b{display:block;font-size:32px}
dl.kv{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:8px 0}dl.kv dt{color:var(--muted)}dl.kv dd{margin:0;overflow-wrap:anywhere}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
figure{margin:0;border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--card)}figure img{width:100%;height:auto;border:1px solid #6b7280}figcaption{font-size:15px;margin-top:4px}
.ph{display:flex;align-items:center;justify-content:center;aspect-ratio:16/9;border:2px dashed var(--border);color:var(--muted);text-align:center;padding:8px}
.card{border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin:12px 0;background:var(--card)}.card.fail{border:3px solid var(--bad);background:var(--bad-bg)}
pre{background:var(--card);border:1px solid var(--border);padding:8px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;user-select:all}
.log{max-height:320px;overflow:auto;font-size:13px;user-select:text}
tr.failrow{background:var(--bad-bg)}
.bar{display:block;height:10px;background:var(--primary);border-radius:5px}
video{max-width:100%}
.muted{color:var(--muted)}
.print-only{display:none}
@media print{@page{size:A4 portrait;margin:16mm}:root,body{--bg:#fff;--fg:#111;--muted:#374151;--border:#6b7280;--card:#fff}body{font-size:11pt;color:#111;background:#fff}table{font-size:10pt}pre{font-size:9pt}.skip,nav,.theme,video{display:none}.print-only{display:block}h2{break-after:avoid}.card,figure,tr{break-inside:avoid}thead{display:table-header-group}.gallery{grid-template-columns:repeat(2,1fr)}}
`;

export interface RenderOptions {
  customer: boolean;
  /** 실패 카드에 싣는 로그 꼬리(내부판만) — 이름 -> 마지막 줄들. */
  logTails?: Record<string, string[]>;
}

function table(caption: string, head: string[], rows: string[][], rawCols: number[] = []): string {
  const th = head.map((h) => `<th scope="col">${esc(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c, i) => `<td>${rawCols.includes(i) ? c : esc(c)}</td>`).join('')}</tr>`).join('');
  return `<div class="scroll" role="region" tabindex="0" aria-label="${esc(caption)}"><table><caption>${esc(caption)}</caption><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function section(id: string, title: string, body: string): string {
  return `<section id="${id}" aria-labelledby="${id}-h"><h2 id="${id}-h">${esc(title)}</h2>${body}</section>`;
}

const HONESTY_TITLE: Record<HonestyKind, string> = {
  MOCK: '모형',
  PREPARED_RESULT: '미리 준비한 결과',
  DEMO_SETTING: '시연용 설정',
  FALLBACK: '대체 화면',
  SKIPPED: '건너뜀',
  HISTORICAL_DATA: '시연용 과거 데이터',
  // [DT-2] 풀 투어에서만 나타나는 소제목
  SYNTHETIC_INPUT: '합성 음성(가상 마이크)',
  GPU_USED: 'GPU 사용',
  QUALITY_UNVERIFIED: '동작 확인 수준',
  NO_AUDIO: '영상에 소리 없음',
  DEVICE_FALLBACK: '장치 자동 대체',
};

const KIND_REASON: Record<string, string> = {
  TIMEOUT: '조건 대기 상한 안에 기대한 변화가 일어나지 않았습니다(서버 응답·화면 갱신이 늦었을 수 있습니다).',
  VERIFY: '화면 또는 API의 결과가 기대한 값과 달랐습니다(데이터 문구·화면이 바뀌었을 수 있습니다).',
  SELECTOR: '화면의 버튼·입력 이름이 바뀌어 찾지 못했습니다(선택자 갱신 필요).',
  ACTION: '화면 조작 중 예기치 않은 오류가 났습니다.',
  DATA: '데모 데이터를 만드는 중 제품 API가 오류를 돌려줬습니다.',
  BOOT: '서버가 기동하지 못했거나 응답하지 않았습니다.',
  PREFLIGHT: '사전 점검의 차단 항목이 있었습니다.',
  BUILD: '제품 빌드가 실패했습니다.',
  TEARDOWN: '정리 단계에서 문제가 있었습니다.',
};

function failureCard(s: StepResultJson, r: ResultJson, tails: Record<string, string[]> | undefined): string {
  const f = s.failure!;
  const logsHtml = tails
    ? Object.entries(tails)
        .map(([name, lines]) => `<details open><summary>${esc(name)} 로그(마지막 ${lines.length}줄)</summary><pre class="log" tabindex="0" role="region" aria-label="${esc(name)} 로그">${esc(lines.join('\n'))}</pre></details>`)
        .join('')
    : '';
  const shot = s.captures.find((c) => c.endsWith('-FAIL.png'));
  return `<article class="card fail" id="fail-${esc(s.id)}"><h3>${chip('bad', `실패 · ${f.kind}`)} ${esc(s.id)} ${esc(s.title)} (${s.core ? '핵심 장면' : '생략 가능 장면'})</h3>
<dl class="kv"><dt>무엇이 실패했나</dt><dd>${esc(f.message)}</dd><dt>기대값 / 실제값</dt><dd>${esc(f.expected ?? '-')} / ${esc(f.actual ?? '-')}</dd><dt>왜 그럴 수 있나</dt><dd>${esc(KIND_REASON[f.kind] ?? '원인을 특정하지 못했습니다. 로그를 확인하세요')}</dd><dt>어떻게 하나</dt><dd>아래 재개 명령으로 이 단계가 속한 구간 처음부터 다시 실행하세요(재개는 구간 단위입니다).</dd></dl>
<pre aria-label="재개 명령">${esc(f.resume ?? `pnpm demo -- --resume ${r.runId} --from ${s.segment.toUpperCase()}`)}</pre>
${shot ? `<p><a href="../${esc(shot)}"><img src="../${esc(shot)}" alt="${esc(s.title)} 실패 순간 화면" width="640" loading="lazy"></a></p>` : ''}${logsHtml}</article>`;
}

function statCounts(steps: StepResultJson[]): { pass: number; fail: number; skip: number; alt: number } {
  return {
    pass: steps.filter((s) => s.status === 'PASS').length,
    fail: steps.filter((s) => s.status === 'FAIL').length,
    skip: steps.filter((s) => s.status === 'SKIPPED').length,
    alt: steps.filter((s) => s.status === 'FALLBACK').length,
  };
}

const STATUS_BANNER: Record<ResultJson['status'], { cls: string; text: string }> = {
  PASSED: { cls: 'ok', text: '모두 통과' },
  FAILED: { cls: 'bad', text: '일부 실패' },
  ABORTED: { cls: 'alt', text: '중단됨' },
  PREPARE_FAILED: { cls: 'bad', text: '준비 실패 - 시연하지 못함' },
};

/** 개선 후보(내부판) — 이번 실행에서 실제로 관측된 것만. */
function improvementCandidates(r: ResultJson): Array<{ id: string; text: string; evidence: string }> {
  const out: Array<{ id: string; text: string; evidence: string }> = [];
  const fonts = r.browserBlockedRequests.filter((b) => /fonts\.(googleapis|gstatic)\.com/.test(b.host));
  if (fonts.length > 0) out.push({ id: 'DHX-1', text: '관리 콘솔이 외부 글꼴을 요청합니다(폐쇄망·외부 송신 없음 메시지와 충돌)', evidence: `외부 송신 점검표 브라우저 칸: ${fonts.map((f) => `${f.host} x${f.count}`).join(', ')}` });
  for (const s of r.steps) {
    if (s.failure?.kind === 'SELECTOR') out.push({ id: `선택자 ${s.id}`, text: '화면 문구가 바뀌었을 수 있습니다 - src/selectors 갱신 필요', evidence: `단계 ${s.id}` });
    if (s.status === 'FALLBACK') out.push({ id: `대체 ${s.id}`, text: '이 단계가 대체 화면으로 넘어갔습니다 - 원인 확인 필요', evidence: `단계 ${s.id}` });
  }
  return out;
}

function yn(b: boolean | null | undefined): string {
  return b === null || b === undefined ? '확인 못함' : b ? '예' : '아니오';
}

const SOURCE_TEXT: Record<string, string> = { BROWSER: '브라우저 녹음(가상 마이크)', TYPED_FALLBACK: '글자 입력 대체', MOCK: '모의 인식' };
const LISTEN_TEXT: Record<string, string> = { PLAYED: '재생됨', NO_VOICE: '기기 음성 없음', ERROR: '오류' };

/** 모델 구성표 · VRAM 관찰표(고객판은 포트 제외). */
function modelsBody(r: ResultJson, customer: boolean): string {
  const models = r.models ?? [];
  const rows = models.map((m) => [
    { embed: '문장 분석', speech: '음성 인식', augment: '사내 생성' }[m.role],
    customer ? '-' : String(m.port),
    m.modelId,
    m.role === 'augment' ? `Ollama(${m.device === 'external' ? '이 PC GPU' : m.device})` : m.device === 'cuda' ? 'GPU' : m.device === 'cpu' ? 'CPU' : m.device,
    m.computeType ?? '-',
    [m.profile === 'lightweight' ? `경량 구성 · 1회 상한 ${m.targetCap ?? 20}건` : '', m.fallbackFrom ? `장치 자동 대체(${m.fallbackFrom} -> ${m.device})` : '', m.note ?? ''].filter(Boolean).join(' · ') || '-',
  ]);
  return table('모델 구성표(이번 실행에서 실제 적재된 값)', ['역할', '포트', '모델', '장치', '연산 형식', '비고'], rows.length > 0 ? rows : [['문장 분석', '-', '-', '-', '-', '확인 못함']]);
}

function vramBody(r: ResultJson): string {
  const vram = r.vram ?? [];
  if (vram.length === 0) return '<p>GPU를 쓰지 않는 구성이라 GPU 메모리를 관찰하지 않았습니다.</p>';
  const total = Math.max(1, ...vram.map((v) => v.totalMiB ?? 0));
  const rows = vram.map((v) => [v.event, v.at.slice(11, 19), v.usedMiB === null ? '확인 못함' : `${v.usedMiB}`, v.totalMiB === null ? '-' : `${v.totalMiB}`, v.usedMiB === null ? '' : `<span class="bar" style="width:${Math.round((v.usedMiB / total) * 100)}%"></span>`]);
  const max = (r.vramMax ?? []).map((m) => [m.label, '-', m.usedMiB === null ? '확인 못함' : `${m.usedMiB}`, '-', '']);
  return table('GPU 메모리 관찰값 — 합격 판정에 쓰지 않습니다', ['이벤트', '시각', '사용 MiB', '총 MiB', '막대(보조)'], [...rows, ...max], [4]);
}

function speechBody(r: ResultJson, customer: boolean): string {
  const sp = r.speech;
  const plan = r.plan!;
  if (!sp) return `<p>이번 시연에서는 음성 입력을 쓰지 않았습니다${plan.voiceOmittedReason ? ` — 사유: ${esc(plan.voiceOmittedReason)}` : ''}.</p>`;
  const kv: Array<[string, string]> = [
    ['기대 문장', sp.expected],
    ...(customer ? [] : ([['게이트 전사(준비 단계)', `${sp.gateTranscript ?? '-'} (일치율 ${sp.gateRatio ?? '-'})`]] as Array<[string, string]>)),
    ['위젯 전사', sp.transcript ?? '(없음)'],
    ['일치율', sp.matchRatio === null ? '-' : String(sp.matchRatio)],
    ['핵심어 포함', yn(sp.keywordsOk)],
    ['의도 확인', yn(sp.intentOk)],
    ['입력 방식', SOURCE_TEXT[sp.source] ?? sp.source],
    ['듣기 결과', sp.listen ? (LISTEN_TEXT[sp.listen] ?? sp.listen) : '-'],
    ['현장 스피커', sp.speaker === 'PLAYED' ? '재생됨' : sp.speaker === 'FAILED' ? '재생 실패(가상 마이크 입력은 정상)' : '재생하지 않음'],
    ...(customer ? [] : ([['녹음 길이·형식', `${sp.wavSec.toFixed(1)}초 · ${sp.recordedMime ?? '-'} · 합성 음성 ${sp.wavBytes}바이트`]] as Array<[string, string]>)),
  ];
  return `<dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl><p class="muted">정확도 판정이 아닙니다 — 이 노트북에서의 동작 확인입니다.</p>`;
}

function localLlmBody(r: ResultJson): string {
  const l = r.localLlm;
  if (!l) return '<p>사내 생성 모델을 쓰지 않았습니다.</p>';
  const row = (label: string, g: NonNullable<typeof l>['prepared']): string[] => (g ? [label, g.providerId, g.degraded ? `예(폴백 전 ${g.fallbackFrom ?? '-'})` : '아니오', String(g.candidates), `${(g.elapsedMs / 1000).toFixed(1)}초`, g.source === 'PREPARED' ? '미리 준비' : '시연 중 실시간'] : [label, '-', '-', '-', '-', '실행하지 않음']);
  return `${table('사내 생성 요약', ['구분', '공급자', '폴백 여부', '후보 수', '소요', '출처'], [row('사전(준비 단계)', l.prepared), row('실시간(장면 10)', l.live)])}<p>모델 올리기 ${l.loadMs === null ? '-' : `${(l.loadMs / 1000).toFixed(1)}초`} · 해제 ${l.unloaded === null ? '확인 못함' : l.unloaded ? '했음' : '못함'}</p><p class="muted">동작 확인 수준이며 문장 품질을 판정하지 않습니다.</p>`;
}

function downloadsBody(r: ResultJson): string {
  const d = r.downloads ?? [];
  if (d.length === 0) return '<p>내려받은 파일이 없습니다.</p>';
  return table('내려받은 파일', ['단계', '파일', '크기', '방식', '감사 기록 행'], d.map((x) => [x.stepId, x.file, `${x.bytes}바이트`, x.via === 'BROWSER' ? '브라우저' : 'API 대체', x.auditRows === null ? '-' : String(x.auditRows)]));
}

/** 하네스 GPU 사용 문구(ui-spec §16.14.3) — `gpuUsedByHarness=false`이면 DT-1 문구 그대로. */
function gpuUseSentence(r: ResultJson): string {
  if (!r.machine.gpuUsedByHarness) return '하네스 사용: AI 추론에는 GPU를 쓰지 않음';
  const u = r.plan?.gpuUse;
  if (u === 'stt') return `하네스 사용: 음성 인식(${r.plan?.sttModel ?? ''})이 이 PC의 GPU를 사용했습니다. 문장 분석(임베딩)은 CPU입니다`;
  if (u === 'llm') return '하네스 사용: 사내 소형 생성 모델(Ollama)이 이 PC의 GPU를 사용했습니다(장면 10). 문장 분석(임베딩)은 CPU입니다';
  return '하네스 사용: 음성 인식과 사내 소형 생성 모델이 이 PC의 GPU를 순서대로 사용했습니다. 문장 분석(임베딩)은 CPU입니다';
}

function breakdownText(r: ResultJson, customer: boolean): string {
  const by: Record<string, number> = {};
  for (const x of r.steps) if (x.status === 'SKIPPED') by[x.skipReason ?? '-'] = (by[x.skipReason ?? '-'] ?? 0) + 1;
  const name: Record<string, string> = { TIME: '시간 부족', PRESENTER: '진행자 선택', OPTION: customer ? '이번 구성에서 생략' : '옵션', DEPENDENCY: '선행 실패', NO_BROWSER: '브라우저 없음' };
  const parts = Object.entries(by).map(([k, n]) => `${name[k] ?? k} ${n}`);
  return parts.length > 0 ? parts.join(' · ') : '없음';
}

export function renderReport(r: ResultJson, opts: RenderOptions): string {
  const customer = opts.customer;
  const counts = statCounts(r.steps);
  const banner = STATUS_BANNER[r.status];
  const failed = r.steps.filter((s) => s.status === 'FAIL');
  const modeText = r.mode === 'visible' ? '보이는 시연' : '무인 점검';
  const total = r.durations.prepareSec + r.durations.showSec;
  const title = `시연 결과 보고서 · ${r.runId}${customer ? ' · 고객 전달판' : ''}`;
  const sections: string[] = [];
  // 절 번호는 만들어지는 순서대로 매긴다(내부판에만 있는 절·조건부 절이 있어도 번호가 건너뛰지 않는다)
  let secNo = 0;
  const sec = (id: string, title: string, body: string): string => section(id, `${++secNo}. ${title}`, body);

  // 1. 결과 요약
  sections.push(
    sec('s-summary', '결과 요약',
      `<div class="banner ${banner.cls}" role="status">${esc(banner.text)}</div>
<div class="counts"><div><span>${chip('ok', '통과')}</span><b>${counts.pass}</b></div><div><span>${chip('bad', '실패')}</span><b>${customer ? 0 : counts.fail}</b></div><div><span>${chip('skip', '건너뜀')}</span><b>${counts.skip + (customer ? counts.fail : 0)}</b></div><div><span>${chip('alt', '대체')}</span><b>${counts.alt}</b></div></div>
<dl class="kv"><dt>총 소요</dt><dd>${mmss(total)} (준비 ${mmss(r.durations.prepareSec)} · ${r.mode === 'visible' ? `시연 ${mmss(r.durations.showSec)} · 일시정지 ${mmss(r.durations.pausedSec)}` : `점검 ${mmss(r.durations.showSec)}`})</dd>
<dt>일시</dt><dd>${esc(r.startedAt)}</dd><dt>실행 ID</dt><dd>${esc(r.runId)}</dd><dt>프리셋 · 모드</dt><dd>${esc(r.preset)} · ${modeText}</dd>
<dt>커밋</dt><dd>${esc(r.commit.sha ? r.commit.sha.slice(0, 7) : '확인 못함')}${r.commit.dirty ? ' · 작업 폴더 변경 있음' : ''}</dd>${customer ? '' : `<dt>종료 코드</dt><dd>${r.exitCode}</dd>`}
${r.plan ? `<dt>구성</dt><dd>풀 투어 · 장면 ${r.plan.sceneCount}개 · 음성 입력 ${r.plan.voiceInput === 'real' ? `켬(${r.plan.sttDevice === 'cuda' ? 'GPU' : 'CPU'} ${esc(r.plan.sttModel ?? '')})` : r.plan.voiceInput === 'mock' ? '모의 점검' : '끔'} · 사내 생성 ${r.plan.localLlm ? '켬' : '끔'} · 실시간 분석 ${r.plan.liveClustering ? '켬' : '끔'} · 예산 ${mmss(r.plan.totalBudgetSec)}(제안값 · 미실측 · 이 노트북 기준)</dd><dt>건너뜀 분해</dt><dd>${esc(breakdownText(r, customer))}</dd>` : ''}
${r.mode === 'visible' ? `<dt>지연 요약</dt><dd>예산 ${r.plan ? r.plan.totalBudgetSec : 600}초 대비 시연 ${mmss(r.durations.showSec)} · 자동 건너뜀 ${r.steps.filter((s) => s.skipReason === 'TIME').length}개 · 지연 단계 ${r.steps.filter((s) => s.delay).length}개</dd>` : ''}</dl>
${r.mode === 'headless-check' ? '<p class="muted">무인 점검입니다 - 자막·영상·움직이는 그림은 만들지 않고 사람 속도·예산·자동 생략도 적용하지 않습니다.</p>' : ''}
${r.browser.kind === 'none' ? '<p role="alert">UI 장면은 검증하지 못했습니다(브라우저 없음).</p>' : ''}${r.warnings && r.warnings.length > 0 ? `<h3>진행 중 경고</h3><ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`,
    ),
  );

  // 2. 실패 요약
  let failBody: string;
  if (r.status === 'PREPARE_FAILED' && r.prepareFailure) {
    failBody = customer
      ? '<p>이번 시연은 준비 단계에서 중단되었습니다.</p>'
      : `<article class="card fail"><h3>${chip('bad', `준비 실패 · ${esc(r.prepareFailure.phase)}`)}</h3><dl class="kv"><dt>무엇이 실패했나</dt><dd>${esc(r.prepareFailure.message)}</dd><dt>왜 그럴 수 있나</dt><dd>${esc(r.prepareFailure.why ?? '원인을 특정하지 못했습니다. 로그를 확인하세요')}</dd><dt>어떻게 하나</dt><dd>${esc(r.prepareFailure.how ?? '로그를 확인하세요')}</dd></dl><p>준비 실패는 재개할 수 없습니다. 새 실행으로 다시 시작하세요.</p><pre aria-label="새 실행 명령">pnpm demo</pre>${opts.logTails ? Object.entries(opts.logTails).map(([n, l]) => `<details open><summary>${esc(n)} 로그(마지막 ${l.length}줄)</summary><pre class="log" tabindex="0" role="region" aria-label="${esc(n)} 로그">${esc(l.join('\n'))}</pre></details>`).join('') : ''}</article>`;
  } else if (failed.length === 0) failBody = '<p>실패한 단계가 없습니다.</p>';
  else if (customer) failBody = '<p>이번 시연에서 일부 장면은 생략되었습니다.</p>';
  else failBody = failed.map((s) => failureCard(s, r, opts.logTails)).join('');
  sections.push(sec('s-fail', '실패 요약', failBody));

  // 3. 갤러리
  const byId = new Map(r.steps.map((s) => [s.id, s]));
  const fig = (id: string): string => {
    const s = byId.get(id);
    const shot = s?.captures.find((c) => c === `shots/${id}.png`);
    const cap = s ? `${s.id} ${s.title} ` : `${id} `;
    if (!s) return '';
    if (!shot) return `<figure><div class="ph">캡처 없음 - ${esc(s.status === 'SKIPPED' ? `건너뜀(${skipReasonText(s.skipReason)})` : r.mode === 'headless-check' ? '무인 점검 비핵심 단계' : '캡처하지 못함')}</div><figcaption>${esc(cap)}${stepChip(s, customer)}</figcaption></figure>`;
    const w = r.viewport?.width ?? 1920;
    const h = r.viewport?.height ?? 1080;
    return `<figure><a href="../${esc(shot)}" aria-label="원본 크기로 보기: ${esc(id)}"><img src="../${esc(shot)}" alt="${esc(`${s.title}(${s.id})${s.status === 'FALLBACK' ? ' - 대체 화면' : ''}`)}" width="${w}" height="${h}" loading="lazy"></a><figcaption>${esc(cap)}${stepChip(s, customer)}${s.narration ? `<br><span class="muted">${esc(s.narration.lines.join(' '))}</span>` : ''}</figcaption></figure>`;
  };
  const full = r.plan !== undefined;
  const sk = (id: string): boolean => byId.get(id)?.status === 'SKIPPED' && byId.get(id)?.skipReason === 'OPTION';
  const repIds = full ? ['S0-01', 'S1-05', 'S2-06', 'S3-02', 'S4-05', 'S5-04', 'S6-02', 'S7-04', byId.has('SV-03') && !sk('SV-03') ? 'SV-03' : 'SV-05', 'SP-01', 'SE-02', 'S9-01'].filter((id) => byId.has(id) && !sk(id)) : REPRESENTATIVE;
  const otherIds = full ? ['S1-03', 'S2-03', 'S3-03', 'S4-01', 'S5-03', 'S5-06', 'S6-03', 'S6-08', 'S7-02', 'SV-01', 'SV-07', 'SE-01', 'SP-03'].filter((id) => byId.has(id) && !sk(id)) : OTHER_CORE;
  const noSound = full ? '<p class="muted">영상에는 소리가 없습니다 — 현장 스피커로만 들립니다(SV-03 · SV-05 · SV-06).</p>' : '';
  sections.push(sec('s-gallery', '핵심 장면 갤러리', `${noSound}<h3>구간 대표 ${repIds.length}장</h3><div class="gallery">${repIds.map(fig).join('')}</div><h3>나머지 핵심 장면</h3><div class="gallery">${otherIds.map(fig).join('')}</div>`));

  // 4. 영상 · 움직이는 그림
  const media = r.media;
  const gifs = (media?.gifs ?? []).map((g) => `<figure><img src="../${esc(g)}" alt="${esc(`움직이는 그림 ${g.replace(/^gif\//, '').replace(/\.gif$/, '')}`)}" width="480" loading="lazy"><figcaption>${esc(g)}</figcaption></figure>`).join('');
  sections.push(
    sec('s-media', '시연 영상 · 움직이는 그림',
      `${full ? '<p class="muted">영상에는 소리가 없습니다 — 현장 스피커로만 들립니다.</p>' : ''}${media?.video ? `<video controls preload="metadata" src="../${esc(media.video)}"><track kind="captions" srclang="ko" label="한국어" src="../${esc(media.vtt ?? 'video/show.vtt')}"></video><p class="print-only muted">영상 파일 위치: ${esc(media.video)}</p>` : `<p>이번 실행에는 영상이 없습니다 - 사유: ${esc(media?.videoReason ?? '확인 못함')}</p>`}
${gifs ? `<div class="gallery">${gifs}</div>` : `<p>이번 실행에는 움직이는 그림이 없습니다${r.mode === 'headless-check' ? '(무인 점검)' : ''}.</p>`}`,
    ),
  );

  // 5. 시나리오별 결과
  const segCards = r.segments
    .map((seg) => {
      const rows = r.steps.filter((s) => s.segment === seg.key);
      const c = statCounts(rows);
      const head = `${esc(seg.title ?? seg.key)} ${rows.length > 0 && full && rows.every((x) => x.status === 'SKIPPED' && x.skipReason === 'OPTION') ? chip('skip', '이번 구성에서 생략') : ''} ${c.pass > 0 ? chip('ok', `통과 ${c.pass}`) : ''} ${c.fail > 0 && !customer ? chip('bad', `실패 ${c.fail}`) : ''} ${c.skip + (customer ? c.fail : 0) > 0 ? chip('skip', `건너뜀 ${c.skip + (customer ? c.fail : 0)}`) : ''} ${c.alt > 0 ? chip('alt', `대체 ${c.alt}`) : ''}`;
      const optionOnly = full && rows.length > 0 && rows.every((x) => x.status === 'SKIPPED' && x.skipReason === 'OPTION');
      const body =
        optionOnly
          ? `<p>${chip('skip', '이번 구성에서 생략')} ${esc(customer ? (r.plan!.inactive.find((x) => rows.some((y) => y.id === x.id))?.customer ?? '이번 구성에서 켜지 않았습니다') : (r.plan!.inactive.find((x) => rows.some((y) => y.id === x.id))?.reason ?? ''))}</p>`
          : seg.status === 'NOT_RUN'
          ? '<p class="muted">실행하지 않음</p>'
          : table(
              seg.title ?? seg.key,
              ['단계', '제목', '상태', '예산', '실측', '자막'],
              rows.map((s) => [
                esc(s.id) + (s.core ? ' <b>핵심</b>' : ''),
                esc(s.title),
                (s.status === 'FAIL' && !customer ? `<a href="#fail-${esc(s.id)}">${stepChip(s, customer, full)}</a>` : stepChip(s, customer, full)) + (s.badges && s.badges.length > 0 ? ` <span class="muted">${esc(s.badges.join(' · '))}</span>` : ''),
                r.mode === 'visible' ? mmss(s.budgetSec) : '-',
                s.status === 'SKIPPED' ? '-' : `${s.actualSec.toFixed(1)}초`,
                s.narration ? `${esc(s.narration.lines.join(' '))}${s.narration.notice ? `<br><span class="muted">[시연 안내] ${esc(s.narration.notice)}</span>` : ''}` : '',
              ]),
              [0, 2, 5],
            );
      return `<article class="card"><h3>${head}</h3><p class="muted">${seg.budgetSec > 0 ? `예산 ${mmss(seg.budgetSec)} → 실측 ${seg.status === 'NOT_RUN' ? '-' : mmss(seg.actualSec)}` : '예산 - (해당 없음)'}</p>${body}</article>`;
    })
    .join('');
  sections.push(sec('s-segments', '시나리오별 결과', segCards));
  // [DT-2] 풀 투어 신규 절(ui-spec §16.14.1): 음성 확인 · 로컬 생성 요약 · 선제 안내 집계 · 내려받은 파일(내부판만)
  if (full) {
    sections.push(sec('s-speech', '음성 확인', speechBody(r, customer)));
    if (r.plan!.localLlm || r.localLlm) sections.push(sec('s-localllm', '사내 생성 요약', localLlmBody(r)));
    sections.push(sec('s-proactive', '선제 안내 집계', r.proactive ? `<p>표시 ${r.proactive.shown} · 클릭 ${r.proactive.clicked} · 끄기 ${r.proactive.optedOut}</p><p class="muted">개인을 식별하지 않는 규칙별 숫자입니다(브라우저 보고 기반 참고치).</p>` : '<p>선제 안내 집계를 확인하지 못했습니다.</p>'));
    if (!customer) sections.push(sec('s-downloads', '내려받은 파일', downloadsBody(r)));
  }

  // 6. 준비 시간
  const prepare = r.prepare ?? [];
  const maxSec = Math.max(1, ...prepare.map((p) => p.sec));
  sections.push(
    sec('s-prepare', '준비 시간',
      prepare.length === 0
        ? '<p>준비 시간 기록이 없습니다.</p>'
        : table('준비 단계별 소요', ['단계', '상태', '소요', '막대'], prepare.map((p) => [p.name, p.status === 'SKIPPED' ? '생략(변경 없음)' : p.status === 'FAILED' ? '실패' : '완료', mmss(p.sec), `<span class="bar" style="width:${Math.round((p.sec / maxSec) * 100)}%"></span>`]), [3]) + `<p>준비 합계 ${mmss(r.durations.prepareSec)}</p>`,
    ),
  );

  if (full) {
    sections.push(sec('s-models', '모델 구성 · GPU 메모리 관찰', `${modelsBody(r, customer)}${vramBody(r)}${r.plan!.deviceNote ? `<p>장치 ${r.plan!.deviceNote.kind === 'SELECTED' ? '선택(auto)' : '자동 대체'}: ${esc(r.plan!.deviceNote.reason)}</p>` : ''}`));
  }

  // 7. 환경 정보
  sections.push(
    sec('s-env', '환경 정보',
      `<dl class="kv"><dt>OS</dt><dd>${esc(r.machine.os)}</dd><dt>CPU</dt><dd>${esc(r.machine.cpu)} · ${r.machine.cores}스레드</dd><dt>RAM</dt><dd>${r.machine.ramGb}GB (가용 ${r.machine.freeRamGb}GB)</dd><dt>GPU</dt><dd>${esc(r.machine.gpu)} · ${esc(gpuUseSentence(r))}</dd>
<dt>브라우저</dt><dd>${esc(r.browser.kind)} ${esc(r.browser.version ?? '')} · Playwright ${esc(r.browser.playwright)} · 영상 ${r.browser.video ? '있음' : '없음'}</dd><dt>네트워크</dt><dd>${r.network.offline === null ? '확인 못함' : r.network.offline ? '차단됨' : '열림'}${r.network.checkedAt ? ` (${esc(r.network.checkedAt)})` : ''}</dd>
<dt>개발 DB</dt><dd>${r.teardown.devDbUnchanged ? 'dev.db 변경 없음' : 'dev.db 변경 감지됨 - 확인 필요'}</dd><dt>정리</dt><dd>남은 프로세스 ${r.teardown.processesLeft}개 · 포트 ${r.teardown.portsFreed ? '해제' : '점유 중'}</dd></dl><p class="muted">화면 그리기는 GPU를 쓸 수 있습니다.</p>`,
    ),
  );

  // 8. 공개표 · 단건 지연
  const lat = r.embeddingLatency;
  const roundsTable = lat && lat.rounds.length > 1 ? table('단건 지연 측정 라운드', ['라운드', 'P50', 'P95', '비고'], lat.rounds.map((x, i) => [`${i + 1}`, `${Math.round(x.p50Ms)}ms`, `${Math.round(x.p95Ms)}ms`, i === lat.rounds.length - 1 ? '결정에 쓴 라운드' : ''])) : '';
  sections.push(
    sec('s-settings', '시연용 설정 공개표 · 단건 지연 실측',
      `${table('시연용 설정 공개표', ['설정 이름', '시연 값', '기본값', '바꾼 이유'], r.overrides.map((o) => [o.key, o.value === '' ? '(빈 문자열)' : customer && (/DATABASE_URL|ALLOWED_DIRS/.test(o.key) || isPathLike(o.value)) ? '(내부 경로)' : o.value, o.value === o.default ? '기본과 같음' : o.default, o.reason]))}
${lat ? `<p>표본 ${lat.samples} · P50 ${Math.round(lat.p50Ms)}ms · P95 ${Math.round(lat.p95Ms)}ms · 결정 값 ${lat.decidedTimeoutMs}ms(${lat.source === 'manual' ? '수동 지정' : '실측'}) · 장비 ${esc(r.machine.cpu)} · ${esc(r.startedAt.slice(0, 10))} · 커밋 ${esc(r.commit.sha ? r.commit.sha.slice(0, 7) : '-')}</p>${roundsTable}` : '<p>단건 지연을 측정하지 못했습니다.</p>'}
<p class="muted">이 수치는 이 노트북 1대의 실측이며 영업용 성능 주장이 아닙니다.</p>`,
    ),
  );

  // 9. 외부 송신 점검표
  const stateText: Record<string, string> = { UNSET: '미설정', LOOPBACK: '루프백(이 PC 안)', OFF: '꺼짐', ON: '켜짐', BLOCKED: '차단함', OPEN: '열림', UNKNOWN: '확인 못함' };
  sections.push(
    sec('s-egress', '외부 송신 점검표',
      `${table('외부 송신 점검표', ['칸', '항목', '상태', '근거'], r.egressChecklist.map((c) => [c.column ?? '', c.item, stateText[c.state] ?? c.state, c.evidence ?? '']))}
<p><b>API는 같은 네트워크의 다른 PC에서도 접속할 수 있습니다(제품 동작) - 시연 PC의 네트워크를 차단하세요.</b></p>`,
    ),
  );

  // 10. 정직성 표기
  const kinds: HonestyKind[] = full ? ['MOCK', 'SYNTHETIC_INPUT', 'GPU_USED', 'QUALITY_UNVERIFIED', 'NO_AUDIO', 'DEVICE_FALLBACK', 'PREPARED_RESULT', 'DEMO_SETTING', 'FALLBACK', 'SKIPPED', 'HISTORICAL_DATA'] : ['MOCK', 'PREPARED_RESULT', 'DEMO_SETTING', 'FALLBACK', 'SKIPPED', 'HISTORICAL_DATA'];
  sections.push(
    sec('s-honesty', '정직성 표기',
      kinds
        .map((k) => {
          const items = r.honesty.filter((h) => h.kind === k);
          const none = k === 'MOCK' ? (full ? '모의 인식을 쓰지 않았습니다.' : '모형 서버를 쓰지 않았습니다.') : '해당 없음';
          return `<h3>${esc(HONESTY_TITLE[k])}</h3>${items.length === 0 ? `<p class="muted">${none}</p>` : `<ul>${items.map((h) => `<li>${h.stepId ? `${esc(h.stepId)} · ` : ''}${esc(h.text)}</li>`).join('')}</ul>`}`;
        })
        .join(''),
    ),
  );

  if (full && !customer) {
    const notes = r.badgeNotes ?? [];
    sections.push(sec('s-badges', '구축형 배지 표시 내역', notes.length === 0 ? '<p>표시하지 않은 배지가 없습니다.</p>' : table('단계별 표시한 배지와 표시하지 않은 배지', ['단계', '표시한 배지', '표시하지 않은 배지와 이유'], notes.map((n) => [n.stepId, n.shown.join(' · ') || '-', n.hidden.map((h) => `${h.badge} 표시 안 함 — ${h.why}`).join(' / ')]))));
  }

  // 11. 개선 후보 (내부판만)
  if (!customer) {
    const cand = improvementCandidates(r);
    sections.push(sec('s-improve', '시연 중 발견한 개선 후보', cand.length === 0 ? '<p>이번 실행에서 관측된 개선 후보가 없습니다.</p>' : `<ul>${cand.map((c) => `<li><b>${esc(c.id)}</b> · ${esc(c.text)} · 근거: ${esc(c.evidence)} · 별도 결함으로 등록 필요</li>`).join('')}</ul>`));
  }

  // 12. 로드맵
  sections.push(
    sec('s-roadmap', '로드맵',
      `${table('로드맵(오늘 보여 드리지 않는 기능)', ['기능', '번호', '상태', '이유'], (r.roadmap ?? []).map((x) => [x.name, `No.${x.featureNo}`, x.status, x.why]))}<p>출시 일정·성능을 약속하지 않습니다.</p>${full ? `<h3>이 PC 구성에서 생략한 장면</h3>${r.plan!.omittedLines.length > 0 ? `<ul>${r.plan!.omittedLines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p>이번 시연에서 생략한 장면은 없습니다.</p>'}` : ''}`,
    ),
  );

  // 13. 부록 — LLM(있을 때만)
  // (이번 구현은 부록을 만들지 않는다 — appendix.llm === null 이면 절을 숨긴다)

  // 14. 알려진 한계
  sections.push(sec('s-limits', '알려진 한계', `<ul>${[...KNOWN_LIMITS, ...(full ? KNOWN_LIMITS_FULL : [])].map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p class="muted">접힌 상세는 인쇄되지 않습니다 - 화면에서 펼쳐 보세요.</p>`));

  const toc: Array<[string, string]> = [
    ['s-summary', '결과 요약'],
    ['s-fail', '실패 요약'],
    ['s-gallery', '핵심 장면'],
    ['s-media', '영상'],
    ['s-segments', '시나리오별 결과'],
    ...(full ? ([['s-speech', '음성 확인'], ...(r.plan!.localLlm || r.localLlm ? [['s-localllm', '사내 생성']] : []), ['s-proactive', '선제 안내'], ...(customer ? [] : [['s-downloads', '내려받은 파일']])] as Array<[string, string]>) : []),
    ['s-prepare', '준비 시간'],
    ...(full ? ([['s-models', '모델·GPU 메모리']] as Array<[string, string]>) : []),
    ['s-env', '환경 정보'],
    ['s-settings', '공개표·지연'],
    ['s-egress', '외부 송신 점검표'],
    ['s-honesty', '정직성 표기'],
    ...(full && !customer ? ([['s-badges', '배지 표시 내역']] as Array<[string, string]>) : []),
    ...(customer ? [] : ([['s-improve', '개선 후보']] as Array<[string, string]>)),
    ['s-roadmap', '로드맵'],
    ['s-limits', '알려진 한계'],
  ];

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">본문 바로가기</a>
<main id="main">
<h1>${esc(title)} (${esc(modeText)})</h1>
<div class="theme" role="radiogroup" aria-label="테마"><span>테마:</span><label><input type="radio" name="theme" id="theme-auto" checked>자동</label><label><input type="radio" name="theme" id="theme-light">밝게</label><label><input type="radio" name="theme" id="theme-dark">어둡게</label></div>
<nav aria-label="보고서 목차"><ul>${toc.map(([id, name]) => `<li><a href="#${id}">${esc(name)}</a></li>`).join('')}</ul></nav>
${sections.join('\n')}
</main>
</body>
</html>
`;
}
