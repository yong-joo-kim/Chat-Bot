import { Injectable } from '@nestjs/common';
import { ChatbotSnapshotEnvelopeSchema } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { computeContentHash } from '../lib/snapshot-canonical';
import { upcastSnapshot } from '../lib/snapshot-upcasters';
import type { SnapshotEnvelope } from '../lib/snapshot-envelope';

export interface LoadedSnapshot {
  envelope: SnapshotEnvelope;
  upcastedFrom?: number;
}

export type ContentLoadResult = { schemaSupported: true; envelope: SnapshotEnvelope } | { schemaSupported: false; raw: unknown };

/**
 * payload 로드 → JSON 파싱 → 해시 검증 → 업캐스트(§5.4 ③) — 조회·차이·복원 공용.
 * `chatbotVersionPayload`를 참조하는 4곳 중 하나다(§16 V-7 — 나머지는 캡처·보존정리·챗봇 영구삭제).
 */
@Injectable()
export class VersionPayloadReader {
  constructor(private readonly prisma: PrismaService) {}

  private async loadRawPayload(versionId: string): Promise<{ payload: string; schemaVersion: number; contentHash: string }> {
    const version = await this.prisma.chatbotVersion.findUnique({
      where: { id: versionId },
      select: { schemaVersion: true, contentHash: true, payload: { select: { payload: true } } },
    });
    if (!version || !version.payload) {
      throw new ApiException('VERSION_INTEGRITY_FAILED', 422, '버전 본문을 찾을 수 없습니다(손상되었거나 정리되었을 수 있습니다).');
    }
    return { payload: version.payload.payload, schemaVersion: version.schemaVersion, contentHash: version.contentHash };
  }

  /** 엄격 로드(복원·차이 공용) — 업캐스트 불가/해시 불일치를 거부한다. */
  async loadStrict(versionId: string): Promise<LoadedSnapshot> {
    const { payload, schemaVersion, contentHash } = await this.loadRawPayload(versionId);

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new ApiException('VERSION_INTEGRITY_FAILED', 422, '버전 본문이 손상되었습니다(JSON 파싱 실패).');
    }
    const envelopeResult = ChatbotSnapshotEnvelopeSchema.safeParse(parsed);
    if (!envelopeResult.success) {
      throw new ApiException('VERSION_INTEGRITY_FAILED', 422, '버전 본문이 손상되었습니다(형식 오류).');
    }

    const outcome = upcastSnapshot(envelopeResult.data, schemaVersion);
    if (!outcome.ok) {
      throw new ApiException('VERSION_SCHEMA_UNSUPPORTED', 422, '이 버전은 현재 시스템에서 복원할 수 없습니다(지원되지 않는 형식입니다).', [
        { field: 'schemaVersion', message: String(outcome.schemaVersion) },
      ]);
    }

    // 현재 형식이면 저장된 contentHash와 재계산 해시를 비교한다(§5.4 ③). 업캐스트된 경우는 변환
    // 결과로 재계산한 해시를 쓴다(§5.4 ④) — 여기서는 재계산만 하고 비교는 호출자(복원 §8.3)에 맡긴다.
    if (!outcome.upcastedFrom) {
      const recomputed = computeContentHash(outcome.envelope);
      if (recomputed !== contentHash) {
        throw new ApiException('VERSION_INTEGRITY_FAILED', 422, '버전 본문의 무결성 검증에 실패했습니다(해시 불일치).');
      }
    }

    return { envelope: outcome.envelope, upcastedFrom: outcome.upcastedFrom };
  }

  /** 내용 조회 전용(§10.1 `content`) — 스키마 미지원이어도 거부하지 않고 원형 JSON을 반환한다(S-10). */
  async loadForContent(versionId: string): Promise<ContentLoadResult> {
    try {
      const loaded = await this.loadStrict(versionId);
      return { schemaSupported: true, envelope: loaded.envelope };
    } catch (e) {
      if (e instanceof ApiException) {
        const body = e.getResponse() as { code?: string };
        if (body.code === 'VERSION_SCHEMA_UNSUPPORTED') {
          const { payload } = await this.loadRawPayload(versionId);
          return { schemaSupported: false, raw: JSON.parse(payload) };
        }
      }
      throw e;
    }
  }
}
