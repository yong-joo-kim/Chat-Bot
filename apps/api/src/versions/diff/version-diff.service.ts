import { Injectable } from '@nestjs/common';
import type {
  VersionAssetKind,
  VersionChangeKind,
  VersionDiffItemDetail,
  VersionDiffQuery,
  VersionDiffResponse,
  VersionRef,
} from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { VersionCaptureService } from '../capture/version-capture.service';
import { VersionPayloadReader } from '../read/version-payload.reader';
import { diffSnapshots, diffItemFields, buildRefNameResolver } from '../lib/version-diff';
import type { DiffEntity } from '../lib/version-diff';
import type { SnapshotEnvelope } from '../lib/snapshot-envelope';

interface ResolvedRef {
  ref: VersionRef;
  envelope: SnapshotEnvelope;
  integrityWarningCount: number;
}

const NOT_FOUND_MESSAGE = '요청하신 버전을 찾을 수 없습니다.';

/** 비교 쌍 로드 + `lib/version-diff` 호출(저장 0, §7). */
@Injectable()
export class VersionDiffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly versionCapture: VersionCaptureService,
    private readonly payloadReader: VersionPayloadReader,
  ) {}

  private async resolveRef(chatbotId: string, against: string): Promise<ResolvedRef> {
    if (against === 'current') {
      const data = await this.versionCapture.captureSnapshotData(chatbotId);
      return {
        ref: { kind: 'CURRENT', contentHash: data.contentHash },
        envelope: data.envelope,
        integrityWarningCount: data.integrityWarningCount,
      };
    }

    const row = await this.prisma.chatbotVersion.findUnique({ where: { id: against }, select: { id: true, chatbotId: true, versionNo: true, contentHash: true, integrityWarningCount: true } });
    if (!row || row.chatbotId !== chatbotId) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    const loaded = await this.payloadReader.loadStrict(against);
    return {
      ref: { kind: 'VERSION', versionId: row.id, versionNo: row.versionNo, contentHash: row.contentHash },
      envelope: loaded.envelope,
      integrityWarningCount: row.integrityWarningCount,
    };
  }

  async diff(chatbotId: string, versionId: string, query: VersionDiffQuery): Promise<VersionDiffResponse> {
    const baseRow = await this.prisma.chatbotVersion.findUnique({ where: { id: versionId }, select: { id: true, chatbotId: true } });
    if (!baseRow || baseRow.chatbotId !== chatbotId) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    const [base, target] = await Promise.all([this.resolveRef(chatbotId, versionId), this.resolveRef(chatbotId, query.against)]);

    const { summary, items } = diffSnapshots(base.envelope, target.envelope, base.integrityWarningCount, target.integrityWarningCount);

    let filtered = items;
    if (query.kind) filtered = filtered.filter((i) => i.kind === query.kind);
    if (query.change && query.change.length > 0) {
      const changeSet = new Set<VersionChangeKind>(query.change);
      filtered = filtered.filter((i) => changeSet.has(i.change));
    }

    const includeItems = Boolean(query.kind);
    const page = query.page;
    const pageSize = query.pageSize;
    const paged = includeItems ? filtered.slice((page - 1) * pageSize, page * pageSize) : [];

    return {
      base: base.ref,
      target: target.ref,
      summary,
      items: includeItems ? { items: paged, total: filtered.length, page, pageSize } : undefined,
    };
  }

  async diffItemDetail(chatbotId: string, versionId: string, kind: VersionAssetKind, itemId: string, against: string): Promise<VersionDiffItemDetail> {
    const baseRow = await this.prisma.chatbotVersion.findUnique({ where: { id: versionId }, select: { id: true, chatbotId: true } });
    if (!baseRow || baseRow.chatbotId !== chatbotId) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    const [base, target] = await Promise.all([this.resolveRef(chatbotId, versionId), this.resolveRef(chatbotId, against)]);

    const listOf = (envelope: SnapshotEnvelope, k: VersionAssetKind): DiffEntity[] => {
      switch (k) {
        case 'INTENT':
          return envelope.assets.intents as unknown as DiffEntity[];
        case 'KEYWORD':
          return envelope.assets.keywords as unknown as DiffEntity[];
        case 'HOMONYM':
          return envelope.assets.homonyms as unknown as DiffEntity[];
        case 'CONTEXT':
          return envelope.assets.contexts as unknown as DiffEntity[];
        case 'NODE':
          return envelope.assets.dialogNodes as unknown as DiffEntity[];
        case 'FAQ':
          return envelope.assets.faqs as unknown as DiffEntity[];
        case 'ANSWER_SETTING':
          return envelope.answerSetting ? [{ id: envelope.chatbotId, ...envelope.answerSetting } as unknown as DiffEntity] : [];
        case 'PROFILE':
          return [{ id: envelope.chatbotId, ...envelope.profile } as unknown as DiffEntity];
      }
    };

    const beforeEntity = listOf(base.envelope, kind).find((e) => e.id === itemId);
    const afterEntity = listOf(target.envelope, kind).find((e) => e.id === itemId);
    if (!beforeEntity && !afterEntity) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    const change: VersionChangeKind = !beforeEntity ? 'ADDED' : !afterEntity ? 'REMOVED' : 'MODIFIED';
    const nameOf = (e: DiffEntity | undefined): string => {
      if (!e) return '';
      if (kind === 'HOMONYM') return String(e.word ?? '');
      if (kind === 'FAQ') return String(e.question ?? '');
      if (kind === 'ANSWER_SETTING') return '답변 설정';
      if (kind === 'PROFILE') return '챗봇 프로필';
      return String(e.name ?? '');
    };

    const refNameResolver = buildRefNameResolver(base.envelope, target.envelope);

    return {
      id: itemId,
      kind,
      change,
      name: nameOf(afterEntity ?? beforeEntity),
      fields: diffItemFields(kind, beforeEntity, afterEntity, refNameResolver),
    };
  }
}
