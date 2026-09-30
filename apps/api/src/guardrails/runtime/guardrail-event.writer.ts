import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { GuardrailEventRow } from '../lib/verdict-events';

/**
 * ★ `GuardrailEvent` 적재 유일 파일(AG-4) — 턴당 `createMany` 1회 · 응답 대기 0(`void`) · 예외 삼킴.
 * 실패 로그에는 챗봇 id와 오류 이름만 남긴다(문장·표현·규칙 이름 0 — AG-13).
 */
@Injectable()
export class GuardrailEventWriter {
  private readonly logger = new Logger('GuardrailEventWriter');

  constructor(private readonly prisma: PrismaService) {}

  /** fire-and-forget — 호출부는 `await`하지 않는다. */
  write(rows: readonly GuardrailEventRow[]): void {
    if (rows.length === 0) return;
    const chatbotId = rows[0].chatbotId;
    try {
      void this.prisma.guardrailEvent.createMany({ data: rows.map((r) => ({ ...r })) }).catch((e: unknown) => {
        this.logger.warn(`이벤트 적재에 실패했습니다: chatbotId=${chatbotId} error=${e instanceof Error ? e.name : 'unknown'}`);
      });
    } catch (e) {
      this.logger.warn(`이벤트 적재에 실패했습니다: chatbotId=${chatbotId} error=${e instanceof Error ? e.name : 'unknown'}`);
    }
  }
}
