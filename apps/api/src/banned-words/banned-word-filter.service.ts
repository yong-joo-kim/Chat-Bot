import { Inject, Injectable } from '@nestjs/common';
import type { DialogOutput } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import type { BannedWordCache } from './banned-word.cache';
import { detect, decide, maskText } from './lib/banned-word-filter';
import type { BannedWordDecision, BannedWordEntry } from './lib/banned-word-filter';
import { maskOutputs } from './lib/output-text-fields';

/**
 * 금지어 필터 진입점(DD-44) — `conversation` 모듈이 주입받아 입구/출구 2지점에 적용한다
 * (FR-12-41). `packages/dialogue-engine`은 이 서비스를 알지 못한다(ADR-0008 규약 유지).
 */
@Injectable()
export class BannedWordFilterService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('BannedWordCache') private readonly cache: BannedWordCache,
  ) {}

  private async getDict(): Promise<BannedWordEntry[]> {
    const cached = this.cache.get();
    if (cached) return cached;

    const rows = await this.prisma.bannedWord.findMany({ where: { enabled: true } });
    const entries: BannedWordEntry[] = rows.map((r) => ({
      word: r.word,
      wordNormalized: r.wordNormalized,
      matchType: r.matchType as BannedWordEntry['matchType'],
      policy: r.policy as BannedWordEntry['policy'],
    }));
    this.cache.set(entries);
    return entries;
  }

  /** 쓰기(등록/수정/삭제) 직후 호출한다(AC-12D-8 — TTL을 기다리지 않고 즉시 반영). */
  invalidate(): void {
    this.cache.invalidate();
  }

  /** 입구 필터(FR-12-38) — 사전이 비어 있으면 정규화조차 하지 않고 조기 반환한다(FR-12-46). */
  async evaluateInbound(text: string): Promise<{ decision: BannedWordDecision; matches: BannedWordEntry[] }> {
    const dict = await this.getDict();
    if (dict.length === 0) return { decision: 'PASS', matches: [] };
    const matches = detect(text, dict);
    return { decision: decide(matches), matches };
  }

  /** 출구 필터(FR-12-40) — 정책과 무관하게 항상 마스킹만 한다(차단하지 않는다). */
  async maskOutbound(outputs: DialogOutput[]): Promise<DialogOutput[]> {
    const dict = await this.getDict();
    if (dict.length === 0) return outputs;
    return maskOutputs(outputs, (text) => maskText(text, detect(text, dict)));
  }

  /** 로그 적재용 평문 마스킹(FR-12-45 1단계 — 금지어 마스킹 → PII 마스킹 순서). */
  async maskPlainText(text: string): Promise<string> {
    const dict = await this.getDict();
    if (dict.length === 0) return text;
    return maskText(text, detect(text, dict));
  }

  /** `POST /banned-words/test`(FR-12-44) — 저장된 사전을 그대로 시험한다. */
  async test(text: string): Promise<{ matches: BannedWordEntry[]; maskedText: string; decision: BannedWordDecision }> {
    const dict = await this.getDict();
    const matches = detect(text, dict);
    return { matches, maskedText: maskText(text, matches), decision: decide(matches) };
  }
}
