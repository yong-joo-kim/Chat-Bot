import { Injectable } from '@nestjs/common';
import type { VoiceNodeToneView, VoiceSettingsInput, VoiceSettingsView } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatbotScopeService } from '../../chatbots/chatbot-scope.service';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { ApiException } from '../../common/api.exception';
import { VoiceSettingsCache } from '../core/voice-settings.cache';
import { DEFAULT_VOICE_SETTINGS, decodeVoiceSettingsRow, encodeVoiceSettingsInput } from '../lib/voice-settings-codec';
import type { VoiceSettings } from '../lib/voice-settings-codec';
import { UNANSWERED_DEFAULT_TONE } from '../lib/speech-tone';

/** 감사에 남기는 요약 모양 — 노드 꼬리표는 **개수**만(노드 id 목록 원문 0 — voice-ai-설계.md §10.2). */
interface VoiceAuditView {
  inputEnabled: boolean;
  ttsEnabled: boolean;
  autoReadToggleVisible: boolean;
  rateMultiplier: number;
  defaultTone: string;
  unansweredTone: string;
  nodeToneCount: number;
}

function toAuditView(settings: VoiceSettings): VoiceAuditView {
  return {
    inputEnabled: settings.inputEnabled,
    ttsEnabled: settings.ttsEnabled,
    autoReadToggleVisible: settings.autoReadToggleVisible,
    rateMultiplier: settings.rateMultiplier,
    defaultTone: settings.defaultTone,
    unansweredTone: settings.toneByKind.UNANSWERED ?? UNANSWERED_DEFAULT_TONE,
    nodeToneCount: settings.nodeTones.length,
  };
}

function sameNodeTones(a: VoiceSettings['nodeTones'], b: VoiceSettings['nodeTones']): boolean {
  if (a.length !== b.length) return false;
  const map = new Map(a.map((n) => [n.nodeId, n.tone] as const));
  return b.every((n) => map.get(n.nodeId) === n.tone);
}

function buildSummary(before: VoiceAuditView, after: VoiceAuditView): string {
  const parts: string[] = [];
  if (before.inputEnabled !== after.inputEnabled) parts.push(`음성 입력 ${before.inputEnabled} → ${after.inputEnabled}`);
  if (before.ttsEnabled !== after.ttsEnabled) parts.push(`답변 듣기 ${before.ttsEnabled} → ${after.ttsEnabled}`);
  if (before.autoReadToggleVisible !== after.autoReadToggleVisible) parts.push(`자동 읽기 토글 노출 ${before.autoReadToggleVisible} → ${after.autoReadToggleVisible}`);
  if (before.rateMultiplier !== after.rateMultiplier) parts.push(`빠르기 ${before.rateMultiplier} → ${after.rateMultiplier}`);
  if (before.defaultTone !== after.defaultTone) parts.push(`기본 말투 ${before.defaultTone} → ${after.defaultTone}`);
  if (before.unansweredTone !== after.unansweredTone) parts.push(`미응답 말투 ${before.unansweredTone} → ${after.unansweredTone}`);
  if (before.nodeToneCount !== after.nodeToneCount) parts.push(`노드 말투 ${before.nodeToneCount}개 → ${after.nodeToneCount}개`);
  return `음성 설정 변경: ${parts.length > 0 ? parts.join(' · ') : '노드 말투 변경'}`;
}

/**
 * [신규 No.32] ★ `ChatbotVoiceSetting` 쓰기 유일 파일(+ `chatbots.service.ts` 영구삭제 동반 삭제만 예외, VO-7).
 * **전체 교체**(부분 병합 금지). 노드 꼬리표의 노드가 이 챗봇의 초안 노드인지 1쿼리로 검증한다(`400 INVALID_REFERENCE`). 값이 같으면 감사를
 * 남기지 않는다. 저장 직후 설정 캐시를 무효화한다(같은 인스턴스는 즉시 · 다른 인스턴스는 TTL). `inputEnabled=true` 저장은 서버가 꺼져
 * 있어도 허용한다(콘솔이 서버 상태로 안내 — FR-VO5-2).
 */
@Injectable()
export class VoiceSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly auditLog: AuditLogService,
    private readonly cache: VoiceSettingsCache,
  ) {}

  /** 행 없음 = 전부 꺼짐 기본값. 조회 시점 초안 노드 이름을 붙인다(없는 노드는 `nodeMissing`). */
  async getView(chatbotId: string): Promise<VoiceSettingsView> {
    await this.scope.assertReadable(chatbotId);
    const row = await this.prisma.chatbotVoiceSetting.findUnique({ where: { chatbotId } });
    return this.toView(chatbotId, row ? decodeVoiceSettingsRow(row) : { ...DEFAULT_VOICE_SETTINGS, toneByKind: {}, nodeTones: [] }, row?.updatedAt ?? null);
  }

  async update(chatbotId: string, dto: VoiceSettingsInput, actorId: string | null): Promise<VoiceSettingsView> {
    const { name } = await this.scope.assertWritable(chatbotId);

    if (dto.nodeTones.length > 0) {
      const ids = dto.nodeTones.map((n) => n.nodeId);
      const found = await this.prisma.dialogNode.findMany({ where: { chatbotId, id: { in: ids } }, select: { id: true } });
      const foundIds = new Set(found.map((n) => n.id));
      const missing = ids.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new ApiException(
          'INVALID_REFERENCE',
          400,
          '이 챗봇에 없는 노드가 포함되어 있습니다. 노드 목록을 새로 고친 뒤 다시 선택해 주세요.',
          missing.map((id) => ({ field: 'nodeTones', message: `노드를 찾을 수 없습니다: ${id}` })),
        );
      }
    }

    const beforeRow = await this.prisma.chatbotVoiceSetting.findUnique({ where: { chatbotId } });
    const before = decodeVoiceSettingsRow(beforeRow);
    const encoded = encodeVoiceSettingsInput(dto);
    const row = await this.prisma.chatbotVoiceSetting.upsert({
      where: { chatbotId },
      create: {
        chatbotId,
        inputEnabled: dto.inputEnabled,
        ttsEnabled: dto.ttsEnabled,
        autoReadToggleVisible: dto.autoReadToggleVisible,
        rateMultiplier: dto.rateMultiplier,
        defaultTone: dto.defaultTone,
        toneByKind: encoded.toneByKind,
        nodeTones: encoded.nodeTones,
        updatedById: actorId,
      },
      update: {
        inputEnabled: dto.inputEnabled,
        ttsEnabled: dto.ttsEnabled,
        autoReadToggleVisible: dto.autoReadToggleVisible,
        rateMultiplier: dto.rateMultiplier,
        defaultTone: dto.defaultTone,
        toneByKind: encoded.toneByKind,
        nodeTones: encoded.nodeTones,
        updatedById: actorId,
      },
    });
    this.cache.invalidate();

    const after = decodeVoiceSettingsRow(row);
    const beforeAudit = toAuditView(before);
    const afterAudit = toAuditView(after);
    const unchanged = JSON.stringify(beforeAudit) === JSON.stringify(afterAudit) && sameNodeTones(before.nodeTones, after.nodeTones);
    if (!unchanged) {
      await this.auditLog.record({
        action: 'UPDATE',
        targetType: 'Chatbot',
        targetId: chatbotId,
        targetName: name,
        chatbotId,
        before: { voice: beforeAudit },
        after: { voice: afterAudit },
        summary: buildSummary(beforeAudit, afterAudit),
      });
    }

    return this.toView(chatbotId, after, row.updatedAt);
  }

  private async toView(chatbotId: string, settings: VoiceSettings, updatedAt: Date | null): Promise<VoiceSettingsView> {
    const ids = settings.nodeTones.map((n) => n.nodeId);
    const nodes = ids.length > 0 ? await this.prisma.dialogNode.findMany({ where: { chatbotId, id: { in: ids } }, select: { id: true, name: true } }) : [];
    const nameById = new Map(nodes.map((n) => [n.id, n.name] as const));
    const nodeTones: VoiceNodeToneView[] = settings.nodeTones.map((n) => {
      const nodeName = nameById.get(n.nodeId);
      return nodeName === undefined ? { nodeId: n.nodeId, tone: n.tone, nodeName: null, nodeMissing: true } : { nodeId: n.nodeId, tone: n.tone, nodeName };
    });
    return {
      inputEnabled: settings.inputEnabled,
      ttsEnabled: settings.ttsEnabled,
      autoReadToggleVisible: settings.autoReadToggleVisible,
      rateMultiplier: settings.rateMultiplier,
      defaultTone: settings.defaultTone,
      toneByKind: settings.toneByKind,
      nodeTones,
      updatedAt,
    };
  }
}
