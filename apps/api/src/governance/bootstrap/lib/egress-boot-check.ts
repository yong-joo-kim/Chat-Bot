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
  for (const c of checks) {
    if (!c.url) continue;
    if (!isAllowed(c.url)) {
      return { ok: false, reason: `외부 전송 허용 목록(DATA_EGRESS_ALLOWED_HOSTS)에 없는 호스트입니다 — ${c.label}` };
    }
  }
  return { ok: true };
}
