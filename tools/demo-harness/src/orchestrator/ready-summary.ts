// 준비 완료 요약 · 엔터 대기 화면(ui-spec §9.3 · 설계 §5 "준비 완료"). 계정 비밀번호는 이 요약에만 1회 출력한다 — 터미널에만 쓰고 로그 파일·보고서에는 남기지 않는다(NFR-DHS3).
import type { Credentials } from '../data/generator';
import type { Terminal } from '../log/terminal';
import { padEndWidth } from '../util/display-width';
import { formatMmSs } from '../util/time';
import { keyHelpLine } from '../control/presenter';

export interface ReadySummaryInput {
  presetId: string;
  browser: string;
  browserVersion: string | null;
  viewport: { width: number; height: number };
  device: string;
  latencyP95: number | null;
  embeddingTimeoutMs: number;
  embeddingTimeoutDefault: number;
  externalAddresses: number;
  /** 'closed' = 차단됨 · 'open' = 열림 · 'unknown'. */
  network: 'closed' | 'open' | 'unknown';
  governance: 'ON' | 'OFF';
  prepareSec: number;
  credentials: Credentials | null;
  keyMode: 'keys' | 'lines';
  videoOn: boolean;
}

export function printReadySummary(term: Terminal, i: ReadySummaryInput): void {
  const net = i.network === 'closed' ? '차단됨' : i.network === 'open' ? '열림' : '확인 못함';
  term.blank();
  term.rule('=');
  term.text(`${padEndWidth(' 시연 준비가 끝났습니다', 50)}준비 소요 ${formatMmSs(i.prepareSec)}`);
  term.rule('=');
  const row = (k: string, v: string) => term.text(` ${padEndWidth(k, 12)}${v}`);
  row('프리셋', `${i.presetId} (구축형 고객 - 10분 - 장면 7개)`);
  row('모드', `보이는 시연   브라우저 ${i.browser}${i.browserVersion ? ' ' + i.browserVersion : ''}   화면 ${i.viewport.width}x${i.viewport.height}   영상 ${i.videoOn ? '녹화' : '없음'}`);
  row('문장 분석', `장치 ${i.device} - GPU 미노출 - 지연 P95 ${i.latencyP95 === null ? '측정하지 못함' : `${Math.round(i.latencyP95)}ms`}`);
  row('외부 송신', `외부 주소 설정 ${i.externalAddresses}개 - 네트워크 ${net}${i.governance === 'OFF' ? ' - 데이터 통제 모드 꺼짐' : ''}`);
  row('시연용 설정', i.embeddingTimeoutMs !== i.embeddingTimeoutDefault ? `문장 분석 대기 시간 ${i.embeddingTimeoutDefault}ms -> ${i.embeddingTimeoutMs}ms` : '바뀐 것 없음');
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
  term.text('   [ ] 브라우저 창을 최소화하거나 클릭하지 마세요 (상담 목록 갱신이 느려집니다)');
  term.text(`   [ ] 시연 PC의 네트워크를 차단했습니다 (권장)${i.network === 'open' ? '  [주의] 현재 열림' : ''}`);
  term.text('   [ ] Ollama 등 다른 AI 프로그램이 꺼져 있습니다 (트레이 아이콘에서 종료)');
  term.text('   [ ] 절전·알림(집중 지원)을 껐습니다');
  term.blank();
  term.text(' 조작 키 (이 터미널 창을 선택한 상태에서)');
  term.text(`   Enter 시연 시작   ${keyHelpLine(i.keyMode)}`);
  if (i.keyMode === 'lines') term.line('info', '이 터미널은 키 입력을 바로 받지 못해 줄 명령으로 동작합니다');
  term.blank();
  term.text('>> 준비가 끝났습니다. 엔터를 누르면 시연이 시작됩니다.');
  term.rule('=');
}
