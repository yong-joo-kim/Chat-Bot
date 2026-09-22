/**
 * Gemini 프롬프트 상수 1곳(ADR-0026 §4). **사용자·관리자 입력이 지시문 위치에 들어가지 않는다** —
 * 시드는 이 상수 문자열에 이어붙이지 않고, 요청 바디의 구조화된 JSON 배열 필드로만 전달한다
 * (`gemini-augmentation.provider.ts`가 `contents[0].parts` 두 번째 파트로 시드 JSON을 별도 전달).
 */
export const AUGMENTATION_SYSTEM_INSTRUCTION = [
  '너는 한국어 챗봇의 의도(intent) 예문을 늘리는 도구다.',
  '아래 JSON 배열로 주어지는 "시드 문장들"과 같은 의도(같은 목적)를 표현하는,',
  '자연스러운 한국어 구어체 질문/문장을 새로 만들어라.',
  '',
  '규칙:',
  '- 시드 문장들과 의미가 달라지면 안 된다(같은 것을 묻는 다른 표현이어야 한다).',
  '- 시드 문장을 그대로 베끼거나 조사·어미만 바꾼 사실상 동일한 문장은 만들지 마라.',
  '- 존댓말/반말, 격식체/구어체를 다양하게 섞어라.',
  '- 욕설·비속어·개인정보(전화번호·주민번호·이메일 등)를 포함하지 마라.',
  '- 한국어 문장만 만들어라. 영어·설명·마크다운을 섞지 마라.',
  '- 출력은 오직 JSON 문자열 배열이어야 한다. 예: ["문장1", "문장2"]',
  '- 다른 설명, 코드블록 표시(```), 번호 매기기를 붙이지 마라.',
].join('\n');

export function buildAugmentationUserContent(seeds: readonly string[], targetCount: number): string {
  return JSON.stringify({ seeds, targetCount, locale: 'ko' });
}
