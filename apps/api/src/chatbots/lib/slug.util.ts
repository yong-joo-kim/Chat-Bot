const MAX_SLUG_LENGTH = 50;

/** 예외적으로 999회 시도 내 유일한 slug를 찾지 못했을 때 던지는 순수 오류(서비스 계층이 409로 변환). */
export class SlugDerivationExhaustedError extends Error {
  constructor() {
    super('사본 slug 파생 시도 횟수를 초과했습니다.');
    this.name = 'SlugDerivationExhaustedError';
  }
}

/**
 * `{root}{suffix}`가 50자를 넘으면 root 앞부분을 잘라 접미사가 들어갈 자리를 남긴다(EX-1-7).
 * 자른 결과 끝에 남은 하이픈은 제거해 `--copy` 같은 중복 구분자를 방지한다.
 */
function clampWithSuffix(root: string, suffix: string): string {
  const maxBaseLength = Math.max(0, MAX_SLUG_LENGTH - suffix.length);
  const base = root.length > maxBaseLength ? root.slice(0, maxBaseLength) : root;
  const trimmed = base.replace(/-+$/, '');
  return `${trimmed}${suffix}`;
}

/**
 * 사본 slug 파생 규칙(FR-1-13, EX-1-7, AC-1-7, AC-1-8).
 * `-copy`부터 시작해 `exists()`가 false를 반환할 때까지 `-copy-2`, `-copy-3` ... 순으로 후보를 만든다.
 * 순수 함수 시그니처를 유지하기 위해 존재 확인은 콜백으로 주입받는다(DB 무의존).
 */
export async function deriveCopySlug(
  originalSlug: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  let candidate = clampWithSuffix(originalSlug, '-copy');
  let n = 2;
  while (await exists(candidate)) {
    if (n > 999) {
      throw new SlugDerivationExhaustedError();
    }
    candidate = clampWithSuffix(originalSlug, `-copy-${n}`);
    n += 1;
  }
  return candidate;
}
