import { AUGMENT_GEMINI_DEFAULT_BASE_URL } from '../../../common/egress/egress-registry';

/**
 * ★ 출구 기동 검사(No.45 §6.4) — 순수(`checkFn`을 주입받는다). 설정된 기본 URL의 호스트가
 * 허용 목록 밖이면 실패 사유를 반환한다(기동 실패로 이어진다).
 */
export interface EgressBootCheckInput {
  embeddingBaseUrl?: string;
  ragBaseUrl?: string;
  augmentationProvider: string;
  augmentationGeminiApiKey?: string;
  augmentationGeminiBaseUrl?: string;
  augmentationLocalBaseUrl?: string;
  /** [신규 No.21] `UTTERANCE_ANALYSIS_NAME_SUGGEST_ENABLED` — 켜져 있으면 로컬 생성기 호스트도 허용 목록에 있어야 한다. */
  utteranceNameSuggestEnabled?: boolean;
  /** [신규 No.32] `SPEECH_ENABLED` · `SPEECH_PROVIDER` · `ML_WORKER_SPEECH_URL` — 켜짐 ∧ `local`이면 음성 인식 프로세스 호스트도 허용 목록에 있어야 한다(AC-VO4-4). */
  speechEnabled?: boolean;
  speechProvider?: string;
  speechLocalBaseUrl?: string;
}

export function checkEgressBootUrls(input: EgressBootCheckInput, isAllowed: (url: string) => boolean): { ok: boolean; reason?: string } {
  const checks: Array<{ label: string; url?: string }> = [
    { label: '임베딩(질의 원문 송신)', url: input.embeddingBaseUrl },
    { label: '외부 RAG', url: input.ragBaseUrl },
  ];
  if (input.augmentationProvider === 'gemini' && input.augmentationGeminiApiKey) {
    checks.push({ label: '증강 생성기(Gemini)', url: input.augmentationGeminiBaseUrl ?? AUGMENT_GEMINI_DEFAULT_BASE_URL });
  }
  if (input.augmentationProvider === 'local' && input.augmentationLocalBaseUrl) {
    checks.push({ label: '증강 생성기(로컬)', url: input.augmentationLocalBaseUrl });
  }
  // [신규 No.21] 발화 묶음 분석 이름 제안(deep-clustering-설계.md §13.3) — 기존 `local` Provider 검사와 같은 규칙.
  if (input.utteranceNameSuggestEnabled && input.augmentationLocalBaseUrl && input.augmentationProvider !== 'local') {
    checks.push({ label: '발화 묶음 분석 이름 제안(로컬 생성기)', url: input.augmentationLocalBaseUrl });
  }
  // [신규 No.32] 음성 인식(voice-ai-설계.md §11.2) — 켜짐 ∧ local ∧ 주소 설정일 때만(꺼짐이면 검사 0 — 기본 설치 동작 불변).
  if (input.speechEnabled && input.speechProvider === 'local' && input.speechLocalBaseUrl) {
    checks.push({ label: '음성 인식(ml-worker)', url: input.speechLocalBaseUrl });
  }
  for (const c of checks) {
    if (!c.url) continue;
    if (!isAllowed(c.url)) {
      return { ok: false, reason: `외부 전송 허용 목록(DATA_EGRESS_ALLOWED_HOSTS)에 없는 호스트입니다 — ${c.label}` };
    }
  }
  return { ok: true };
}
