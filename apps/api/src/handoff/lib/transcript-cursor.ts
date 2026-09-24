/** 불투명 커서(§11) — 봇 구간·상담 구간 두 목록을 각각 어디까지 훑었는지 담는다. */
export interface TranscriptCursor {
  /** 봇 구간(ConversationLog) 커서 — [createdAt ISO, id]. */
  l?: [string, string];
  /** 상담 구간(HandoffMessage) 커서 — [createdAt ISO, id]. */
  m?: [string, string];
}

export function encodeTranscriptCursor(cursor: TranscriptCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** 형식이 손상된 커서는 `null`(처음부터 다시 조회) — 400을 내지 않는다(멱등·관대한 입력). */
export function decodeTranscriptCursor(raw: string | undefined): TranscriptCursor | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as TranscriptCursor;
  } catch {
    return null;
  }
}
