// 명령 인터페이스(설계 §4) — 인자 해석과 옵션 조합 검사(H-T1). 외부 파서 의존 없이 직접 해석한다.
// 오류는 "무엇이 / 왜 / 어떻게" 3요소(UIUX §7)로 돌려준다.
import { ALL_SEGMENT_KEYS, STEP_ID_RE, type SegmentKey } from '../scenario/types';
import { DEFAULT_PRESET_ID, getPreset } from '../presets';
import { isRunId } from '../util/time';

export type HarnessMode = 'visible' | 'headless-check';

export interface CliOptions {
  help: boolean;
  mode: HarnessMode;
  preset: string;
  /** null = 전부 */
  only: SegmentKey[] | null;
  skip: string[];
  prepareOnly: boolean;
  noTeardown: boolean;
  /** `--stop <runId|latest>` */
  stop: string | null;
  /** `--resume <runId|latest>` */
  resume: string | null;
  /** `--from <S3|S3-04>` */
  from: string | null;
  runsDir: string | null;
  keepRuns: number;
  portOffset: number;
  /** msedge | chrome | chromium | none | <실행 파일 경로> */
  browser: string;
  viewport: { width: number; height: number };
  noVideo: boolean;
  noGif: boolean;
  rebuild: boolean;
  noBuild: boolean;
  requireOffline: boolean;
  noHistorySchedule: boolean;
  waitLiveSchedule: boolean;
  failFast: boolean;
  fieldEncryption: boolean;
  embeddingTimeoutMs: number | null;
  appendixLlm: boolean;
  customerCopy: boolean;
  dryRun: boolean;
  verbose: boolean;
  noColor: boolean;
  /** 시험 전용 숨은 인자(AC-DH2-4) — 같은 DB 가드를 지난다. */
  dbUrlForTest: string | null;
  /** 시험 전용 숨은 인자 — 보이는 시연 흐름(자막·영상·GIF·엔터 대기 생략·진행자 키 없음)을 창 없이 무인으로 돌린다. */
  unattendedVisibleForTest: boolean;
  /** [DT-2] 풀 투어 전용 모델 장면 플래그 5종(설계 §4.1). */
  withVoiceInput: boolean;
  sttDevice: 'auto' | 'cuda' | 'cpu';
  /** `--stt-device`를 사용자가 명시했는지(명시한 장치가 불가면 보이는 시연도 차단 — 설계 A-DX-2). */
  sttDeviceExplicit: boolean;
  withLocalLlm: boolean;
  liveClustering: boolean;
  voiceMockCheck: boolean;
  /** 시험 전용 숨은 인자(AC-DH4-2) — `S2-03:20` 처럼 단계 시작 전에 추가 지연(초)을 넣어 시간 관리(자동 생략)를 재현한다. */
  injectDelay: Record<string, number>;
}

export interface ArgError {
  what: string;
  why: string;
  how: string;
}

export type ParseResult = { ok: true; options: CliOptions } | { ok: false; errors: ArgError[] };

export const DEFAULT_OPTIONS: CliOptions = Object.freeze({
  help: false,
  mode: 'visible',
  preset: DEFAULT_PRESET_ID,
  only: null,
  skip: [],
  prepareOnly: false,
  noTeardown: false,
  stop: null,
  resume: null,
  from: null,
  runsDir: null,
  keepRuns: 5,
  portOffset: 0,
  browser: 'msedge',
  viewport: { width: 1920, height: 1080 },
  noVideo: false,
  noGif: false,
  rebuild: false,
  noBuild: false,
  requireOffline: false,
  noHistorySchedule: false,
  waitLiveSchedule: false,
  failFast: false,
  fieldEncryption: false,
  embeddingTimeoutMs: null,
  appendixLlm: false,
  customerCopy: false,
  dryRun: false,
  verbose: false,
  noColor: false,
  withVoiceInput: false,
  sttDevice: 'auto',
  sttDeviceExplicit: false,
  withLocalLlm: false,
  liveClustering: false,
  voiceMockCheck: false,
  dbUrlForTest: null,
  unattendedVisibleForTest: false,
  injectDelay: {},
}) as CliOptions;

type Kind = 'bool' | 'value';
const OPTION_SPEC: Record<string, Kind> = {
  '--help': 'bool',
  '-h': 'bool',
  '--mode': 'value',
  '--preset': 'value',
  '--only': 'value',
  '--skip': 'value',
  '--prepare-only': 'bool',
  '--no-teardown': 'bool',
  '--stop': 'value',
  '--resume': 'value',
  '--from': 'value',
  '--runs-dir': 'value',
  '--keep-runs': 'value',
  '--port-offset': 'value',
  '--browser': 'value',
  '--viewport': 'value',
  '--no-video': 'bool',
  '--no-gif': 'bool',
  '--rebuild': 'bool',
  '--no-build': 'bool',
  '--require-offline': 'bool',
  '--no-history-schedule': 'bool',
  '--wait-live-schedule': 'bool',
  '--fail-fast': 'bool',
  '--field-encryption': 'bool',
  '--embedding-timeout-ms': 'value',
  '--appendix-llm': 'bool',
  '--customer-copy': 'bool',
  '--dry-run': 'bool',
  '--verbose': 'bool',
  '--no-color': 'bool',
  '--with-voice-input': 'bool',
  '--stt-device': 'value',
  '--with-local-llm': 'bool',
  '--live-clustering': 'bool',
  '--voice-mock-check': 'bool',
  '--db-url-for-test': 'value',
  '--unattended-visible-for-test': 'bool',
  '--inject-delay': 'value',
};

const BROWSER_KEYWORDS = ['msedge', 'chrome', 'chromium', 'none'];

function parseIntStrict(s: string): number | null {
  return /^-?\d+$/.test(s.trim()) ? Number(s.trim()) : null;
}

export function parseArgs(argv: readonly string[]): ParseResult {
  const errors: ArgError[] = [];
  const o: CliOptions = { ...DEFAULT_OPTIONS, viewport: { ...DEFAULT_OPTIONS.viewport }, skip: [], injectDelay: {} };
  const err = (what: string, why: string, how: string) => errors.push({ what, why, how });
  let sttDeviceGiven = false;

  // `pnpm demo -- --x` 처럼 pnpm이 넘기는 단독 `--`는 무시한다.
  const tokens = argv.filter((t) => t !== '--');

  for (let i = 0; i < tokens.length; i++) {
    let tok = tokens[i];
    let inline: string | undefined;
    const eq = tok.indexOf('=');
    if (tok.startsWith('--') && eq > 0) {
      inline = tok.slice(eq + 1);
      tok = tok.slice(0, eq);
    }
    const kind = OPTION_SPEC[tok];
    if (!kind) {
      err(
        `알 수 없는 옵션입니다: ${tokens[i]}`,
        '옵션 이름이 틀렸거나 이 버전에 없는 옵션입니다',
        '사용 가능한 옵션은  pnpm demo -- --help  로 확인하세요',
      );
      continue;
    }
    let value: string | undefined;
    if (kind === 'value') {
      if (inline !== undefined) value = inline;
      else if (i + 1 < tokens.length && !(tokens[i + 1].startsWith('--') && tokens[i + 1] in OPTION_SPEC)) value = tokens[++i];
      if (value === undefined || value === '') {
        err(`${tok} 옵션에 값이 없습니다`, '이 옵션은 값을 하나 받습니다', `예:  ${tok} <값>  또는  ${tok}=<값>`);
        continue;
      }
    } else if (inline !== undefined) {
      err(`${tok} 옵션은 값을 받지 않습니다`, `"${tok}=${inline}" 형태로 값이 지정됐습니다`, `값 없이  ${tok}  만 쓰세요`);
      continue;
    }

    switch (tok) {
      case '--help':
      case '-h':
        o.help = true;
        break;
      case '--mode':
        if (value === 'visible' || value === 'headless-check') o.mode = value;
        else err(`--mode 값이 올바르지 않습니다: ${value}`, 'visible 또는 headless-check만 쓸 수 있습니다', '예:  --mode headless-check');
        break;
      case '--preset':
        o.preset = value!;
        break;
      case '--only': {
        const keys = value!
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        const bad = keys.filter((k) => !(ALL_SEGMENT_KEYS as readonly string[]).includes(k));
        if (bad.length > 0 || keys.length === 0) {
          err(
            `--only 값이 올바르지 않습니다: ${value}`,
            `알 수 없는 구간: ${bad.join(', ') || '(비어 있음)'}`,
            `${ALL_SEGMENT_KEYS.join(', ')} 중에서 쉼표로 고르세요. 예:  --only s1,s5`,
          );
        } else {
          o.only = ALL_SEGMENT_KEYS.filter((k) => keys.includes(k)) as SegmentKey[];
        }
        break;
      }
      case '--skip': {
        const ids = value!
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
        const bad = ids.filter((id) => !STEP_ID_RE.test(id));
        if (bad.length > 0 || ids.length === 0) {
          err(`--skip 값이 올바르지 않습니다: ${value}`, `단계 ID 형식이 아닙니다: ${bad.join(', ') || '(비어 있음)'}`, '예:  --skip S1-06,S4-03');
        } else o.skip = ids;
        break;
      }
      case '--prepare-only':
        o.prepareOnly = true;
        break;
      case '--no-teardown':
        o.noTeardown = true;
        break;
      case '--stop':
        o.stop = value!;
        break;
      case '--resume':
        o.resume = value!;
        break;
      case '--from':
        o.from = value!.trim().toUpperCase();
        break;
      case '--runs-dir':
        o.runsDir = value!;
        break;
      case '--keep-runs': {
        const n = parseIntStrict(value!);
        if (n === null || n < 1 || n > 100) err(`--keep-runs 값이 올바르지 않습니다: ${value}`, '1~100의 정수여야 합니다', '예:  --keep-runs 5');
        else o.keepRuns = n;
        break;
      }
      case '--port-offset': {
        const n = parseIntStrict(value!);
        if (n === null || n < 0 || n > 50000) {
          err(`--port-offset 값이 올바르지 않습니다: ${value}`, '0~50000의 정수여야 합니다(포트 8100+오프셋이 65535를 넘지 않아야 함)', '예:  --port-offset 100');
        } else o.portOffset = n;
        break;
      }
      case '--browser': {
        const v = value!;
        if (BROWSER_KEYWORDS.includes(v) || /[\\/]/.test(v) || /\.exe$/i.test(v)) o.browser = v;
        else err(`--browser 값이 올바르지 않습니다: ${v}`, 'msedge · chrome · chromium · none 또는 실행 파일 경로만 쓸 수 있습니다', '예:  --browser chrome');
        break;
      }
      case '--viewport': {
        const m = /^(\d{3,5})x(\d{3,5})$/.exec(value!.trim());
        if (!m) err(`--viewport 값이 올바르지 않습니다: ${value}`, '가로x세로 형식이어야 합니다', '예:  --viewport 1600x900');
        else o.viewport = { width: Number(m[1]), height: Number(m[2]) };
        break;
      }
      case '--no-video':
        o.noVideo = true;
        break;
      case '--no-gif':
        o.noGif = true;
        break;
      case '--rebuild':
        o.rebuild = true;
        break;
      case '--no-build':
        o.noBuild = true;
        break;
      case '--require-offline':
        o.requireOffline = true;
        break;
      case '--no-history-schedule':
        o.noHistorySchedule = true;
        break;
      case '--wait-live-schedule':
        o.waitLiveSchedule = true;
        break;
      case '--fail-fast':
        o.failFast = true;
        break;
      case '--field-encryption':
        o.fieldEncryption = true;
        break;
      case '--embedding-timeout-ms': {
        const n = parseIntStrict(value!);
        if (n === null || n < 50 || n > 30000) {
          err(`--embedding-timeout-ms 값이 올바르지 않습니다: ${value}`, '50~30000(ms)의 정수여야 합니다', '예:  --embedding-timeout-ms 800');
        } else o.embeddingTimeoutMs = n;
        break;
      }
      case '--appendix-llm':
        o.appendixLlm = true;
        break;
      case '--customer-copy':
        o.customerCopy = true;
        break;
      case '--dry-run':
        o.dryRun = true;
        break;
      case '--verbose':
        o.verbose = true;
        break;
      case '--no-color':
        o.noColor = true;
        break;
      case '--with-voice-input':
        o.withVoiceInput = true;
        break;
      case '--stt-device':
        if (value === 'auto' || value === 'cuda' || value === 'cpu') {
          o.sttDevice = value;
          o.sttDeviceExplicit = value !== 'auto';
        } else err(`--stt-device 값이 올바르지 않습니다: ${value}`, 'auto, cuda, cpu만 쓸 수 있습니다', '예:  --stt-device cpu');
        sttDeviceGiven = true;
        break;
      case '--with-local-llm':
        o.withLocalLlm = true;
        break;
      case '--live-clustering':
        o.liveClustering = true;
        break;
      case '--voice-mock-check':
        o.voiceMockCheck = true;
        break;
      case '--db-url-for-test':
        o.dbUrlForTest = value!;
        break;
      case '--unattended-visible-for-test':
        o.unattendedVisibleForTest = true;
        break;
      case '--inject-delay': {
        const map: Record<string, number> = {};
        let bad = false;
        for (const part of value!.split(',')) {
          const m = /^(S[0-79VPE]-\d{2}):(\d{1,3})$/i.exec(part.trim());
          if (!m) bad = true;
          else map[m[1].toUpperCase()] = Number(m[2]);
        }
        if (bad) err(`--inject-delay 값이 올바르지 않습니다: ${value}`, '단계ID:초 쌍을 쉼표로 이어야 합니다', '예:  --inject-delay S2-03:20');
        else o.injectDelay = map;
        break;
      }
    }
  }

  // ── 옵션 조합 검사 ──
  if (o.resume !== null && o.from === null) {
    err(
      '--resume에는 --from이 함께 필요합니다',
      '재개는 구간 단위라 어느 구간부터 다시 할지 알아야 합니다',
      '예:  pnpm demo -- --resume latest --from S3',
    );
  }
  if (o.from !== null && o.resume === null) {
    err('--from은 --resume과 함께만 쓸 수 있습니다', '새 실행은 처음부터 시작합니다', '예:  pnpm demo -- --resume <runId> --from S3');
  }
  if (o.from !== null && !/^S[0-79VPE](-\d{2})?$/.test(o.from)) {
    err(`--from 값이 올바르지 않습니다: ${o.from}`, '구간(S3) 또는 단계(S3-04) 형식이어야 합니다', '예:  --from S3');
  }
  if (o.resume !== null && o.resume !== 'latest' && !isRunId(o.resume)) {
    err(`--resume 값이 실행 ID 형식이 아닙니다: ${o.resume}`, '실행 ID(예: 20261001-143012-a7k2) 또는 latest만 쓸 수 있습니다', '보고서 마지막의 재개 명령을 그대로 복사하세요');
  }
  if (o.stop !== null && o.stop !== 'latest' && !isRunId(o.stop)) {
    err(`--stop 값이 실행 ID 형식이 아닙니다: ${o.stop}`, '실행 ID(예: 20261001-143012-a7k2) 또는 latest만 쓸 수 있습니다', '실행 폴더 이름(.demo-runs 아래)을 확인하세요');
  }
  if (o.stop !== null && o.resume !== null) {
    err('--stop과 --resume은 함께 쓸 수 없습니다', '정리와 재개는 서로 반대 동작입니다', '둘 중 하나만 쓰세요');
  }
  if (o.appendixLlm && o.mode === 'visible') {
    err(
      '--appendix-llm은 무인 점검(headless-check)에서만 쓸 수 있습니다',
      '보이는 시연 중에는 LLM 프로그램을 띄우지 않는 것이 원칙입니다(FR-DH10-3)',
      '예:  pnpm demo:check -- --appendix-llm',
    );
  }
  checkFullTourCombos(o, sttDeviceGiven, err);
  if (o.prepareOnly && o.noTeardown) {
    // 둘 다 서버를 유지한다 — 오류는 아니지만 중복이라 조용히 허용
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, options: o };
}

/** [DT-2] 풀 투어 옵션 조합 검사(설계 §4.2 · ui-spec §16.4.2 — 시작 전 오류 7종). 프리셋 해석은 이 파일이 프리셋 레지스트리를 읽어 한다. */
function checkFullTourCombos(o: CliOptions, sttDeviceGiven: boolean, err: (what: string, why: string, how: string) => void): void {
  const preset = getPreset(o.preset);
  const flagsOk = (preset?.flags?.length ?? 0) > 0;
  const given: Array<[string, boolean]> = [
    ['--with-voice-input', o.withVoiceInput],
    ['--stt-device', sttDeviceGiven],
    ['--with-local-llm', o.withLocalLlm],
    ['--live-clustering', o.liveClustering],
    ['--voice-mock-check', o.voiceMockCheck],
  ];
  if (preset && !flagsOk) {
    for (const [name, on] of given) {
      if (on) err(`${name}은(는) 풀 투어 프리셋에서만 쓸 수 있습니다`, `10분판(${preset.id})은 모델 장면 없이 10분으로 고정되어 있습니다`, `pnpm demo -- --preset customer-onprem-full ${name}`);
    }
  }
  if (preset && flagsOk) {
    if (sttDeviceGiven && !o.withVoiceInput) {
      err('--stt-device는 --with-voice-input과 함께 쓸 수 있습니다', '음성 입력을 켜지 않으면 음성 인식 프로세스를 띄우지 않습니다', 'pnpm demo -- --preset customer-onprem-full --with-voice-input --stt-device cpu');
    }
    if (o.voiceMockCheck && o.mode === 'visible') {
      err('--voice-mock-check는 보이는 시연에서 쓸 수 없습니다', '고객 앞에서 가짜 인식 결과를 보이지 않기 위해서입니다', 'pnpm demo:check -- --preset customer-onprem-full --voice-mock-check');
    }
    if (o.voiceMockCheck && o.withVoiceInput) {
      err('--voice-mock-check와 --with-voice-input은 함께 쓸 수 없습니다', '모의 인식과 실제 음성 인식은 한 번에 점검할 수 없습니다', '둘 중 하나를 빼고 다시 실행하세요');
    }
    if (o.only && o.only.includes('edge') && !o.withLocalLlm) {
      err('장면 10(edge)이 이번 구성에 없습니다', '장면 10은 사내 생성 모델을 켰을 때만 생깁니다', '--with-local-llm을 붙이거나 --only를 바꾸세요');
    }
    if (o.appendixLlm) {
      err('--appendix-llm은 풀 투어에서 쓰지 않습니다', '같은 내용을 장면 10이 보여 줍니다', '--with-local-llm을 쓰세요');
    }
  }
  if (preset && !flagsOk && o.only) {
    for (const k of ['voice', 'proactive', 'edge'] as const) {
      if (o.only.includes(k)) err(`이 프리셋에는 ${k} 장면이 없습니다`, `${preset.id}은(는) 장면 7개입니다`, '--preset customer-onprem-full');
    }
  }
}

export const HELP_TEXT = `원클릭 시연 하네스(DT-1)

사용법
  pnpm demo                      보이는 시연(사전 점검 -> 준비 -> 엔터 -> 10분 공연 -> 보고서 -> 정리)
  pnpm demo -- --preset customer-onprem-full   풀 투어(약 14분 · 모델 장면은 옵션으로 켠다)
  pnpm demo:check                무인 점검(창 숨김, 사람 속도 없음, 검증과 스크린샷)
  pnpm demo -- <옵션>            아래 옵션

옵션
  --mode visible|headless-check  실행 방식 (기본 visible)
  --preset <id>                  프리셋 (기본 ${DEFAULT_PRESET_ID})
  --only s1,s5                   구간 선택 (opening s1..s7 voice proactive edge closing)
  --skip S1-06,S4-03             생략 가능 단계만 지정 가능
  --prepare-only                 준비까지 하고 서버를 유지한 채 대기
  --no-teardown                  끝난 뒤에도 서버를 유지
  --stop <runId|latest>          유지 중인 실행의 프로세스 트리 정리만
  --resume <runId|latest> --from <S3|S3-04>   같은 실행 폴더에서 구간 단위 재개
  --runs-dir <경로>              실행 폴더 루트 (기본 <저장소>/.demo-runs)
  --keep-runs <n>                보존할 실행 폴더 수 (기본 5)
  --port-offset <n>              포트 5개를 일괄 이동 (기본 0)
  --browser msedge|chrome|chromium|none|<실행 파일>   (기본 msedge)
  --viewport 1920x1080           화면 크기
  --no-video  --no-gif           영상·GIF 끄기
  --rebuild  --no-build          빌드 강제 / 생략
  --require-offline              외부망이 열려 있으면 중단
  --no-history-schedule          이력용 예약 생략(준비 시간 단축)
  --wait-live-schedule           무인 점검에서도 라이브 예약 실행까지 대기
  --fail-fast                    무인 점검: 첫 실패에서 중단
  --field-encryption             거버넌스 필드 암호화 켬(실행별 키)
  --embedding-timeout-ms <n>     단건 임베딩 대기 시간 수동 지정
  --appendix-llm                 무인 점검 전용: 예문 늘리기(LLM) 동작 확인 부록(풀 투어에서는 쓰지 않음)
  --with-voice-input             풀 투어: 장면 8에 음성 입력(말하기 -> 글자 -> 전송) 추가 · 음성 인식 프로세스 사용
  --stt-device auto|cuda|cpu     풀 투어 음성 인식 장치(기본 auto — GPU 조건이 되면 GPU, 아니면 CPU)
  --with-local-llm               풀 투어: 장면 10(사내 소형 생성 모델) 추가 · Ollama를 켜 둔 상태에서만
  --live-clustering              풀 투어: 장면 7에서 발화 묶음 분석을 지금 실행하고 완료까지 대기
  --voice-mock-check             무인 점검 전용(풀 투어): 모의 인식으로 위젯 -> API 구간만 점검(음성 인식 미검증)
  --customer-copy                고객 전달판 보고서 추가 생성
  --dry-run                      프로세스·브라우저 없이 계획만 출력
  --verbose  --no-color          상세 로그 / 색 끄기
  -h, --help                     이 도움말

종료 코드  0 통과 / 1 단계 실패 / 2 사전 점검·빌드·기동·데이터 준비 실패 / 130 중단
`;
