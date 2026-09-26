/**
 * ★ 거버넌스 런타임(No.45) — 부트스트랩 1곳(`governance/bootstrap/governance-bootstrap.service.ts`)이
 * `onModuleInit`에서 1회 설치하는 **프로세스 전역 불변 상태**다(`docs/02-spec/data-governance-설계.md` §2.3,
 * ADR-0040 §1). 미설치 기본값은 `mode='OFF'`·`enforce=false`·`encryptionEnabled=false` — 현행 동작과
 * 같다. 출구 가드·필드 암호화·감사 VIEW 판정·데이터 지도는 이 상태를 **읽기만** 한다.
 *
 * 통제: ① 설치 함수를 호출하는 파일은 부트스트랩 1개뿐(정적 검사 G-3) ② 설치 후 `Object.freeze`
 * ③ 재설치는 `resetGovernanceRuntimeForTest()`(함수명에 `ForTest` — 운영 코드 호출 0) ④ Jest는 spec
 * 파일마다 모듈 레지스트리가 새로 만들어져 파일 간 누수가 없다.
 */

export type GovernanceModeValue = 'OFF' | 'ON';

export interface GovernanceEgressRuntime {
  /** 정규화된 허용 목록 항목(파싱은 egress-guard.ts가 담당) — 원본 문자열 배열을 그대로 들고 있는다. */
  readonly allowlist: readonly string[];
  /** 모드 ON일 때만 true — false면 검사 자체를 생략한다(FR-DG3-6). */
  readonly enforce: boolean;
}

export interface GovernanceRuntime {
  readonly mode: GovernanceModeValue;
  readonly egress: GovernanceEgressRuntime;
  readonly encryptionEnabled: boolean;
}

const DEFAULT_RUNTIME: GovernanceRuntime = Object.freeze({
  mode: 'OFF',
  egress: Object.freeze({ allowlist: Object.freeze([]) as readonly string[], enforce: false }),
  encryptionEnabled: false,
});

let current: GovernanceRuntime = DEFAULT_RUNTIME;
let installed = false;

/**
 * 부트스트랩 1곳만 호출한다(정적 검사 G-3). 같은 프로세스에서 앱 인스턴스를 여러 개 띄우는
 * 다중 인스턴스 시험은 같은 설정으로 여러 번 호출될 수 있다 — 두 번째 이후 호출은 조용히
 * 무시한다(설계 §2.3 ④, `resetGovernanceRuntimeForTest()`만 재설치를 허용).
 */
export function installGovernanceRuntime(runtime: GovernanceRuntime): void {
  if (installed) return;
  current = Object.freeze({
    mode: runtime.mode,
    egress: Object.freeze({ allowlist: Object.freeze([...runtime.egress.allowlist]), enforce: runtime.egress.enforce }),
    encryptionEnabled: runtime.encryptionEnabled,
  });
  installed = true;
}

export function governanceRuntime(): GovernanceRuntime {
  return current;
}

export function isGovernanceRuntimeInstalled(): boolean {
  return installed;
}

/** 시험 전용 — 다음 `installGovernanceRuntime()` 호출을 허용한다(함수명에 `ForTest`). */
export function resetGovernanceRuntimeForTest(): void {
  current = DEFAULT_RUNTIME;
  installed = false;
}
