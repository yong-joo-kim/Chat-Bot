import { Injectable } from '@nestjs/common';
import type { DialogOutput, RichUrlPolicyResponse, UpdateRichUrlPolicyDto } from '@chat-bot/shared-types';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { governanceRuntime } from '../common/governance/governance-runtime';
import { countNodesOutsideRichUrlPolicy } from './lib/rich-url-issues';
import { parseRichUrlHosts, serializeRichUrlHosts } from './lib/rich-url-policy-codec';

/**
 * ★ [신규 No.46] `chatbotRichUrlPolicy` 쓰기 유일(영구삭제 동반 삭제 제외 — RM-6). 저장 즉시
 * 반영(환경 밖) · 공개 대화 경로는 이 테이블을 읽지 않는다(§9.3 · NFR-RMP1).
 */
@Injectable()
export class RichUrlPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly auditLog: AuditLogService,
  ) {}

  private async outsideNodeCount(chatbotId: string, rules: ReturnType<typeof parseRichUrlHosts>): Promise<number> {
    if (rules.length === 0) return 0;
    const rows = await this.prisma.dialogNode.findMany({ where: { chatbotId }, select: { id: true, name: true, outputs: true } });
    const nodes = rows.map((r) => ({ id: r.id, name: r.name, outputs: safeParseOutputs(r.outputs) }));
    return countNodesOutsideRichUrlPolicy(nodes, rules);
  }

  async get(chatbotId: string): Promise<RichUrlPolicyResponse> {
    await this.scope.assertReadable(chatbotId);
    const row = await this.prisma.chatbotRichUrlPolicy.findUnique({ where: { chatbotId } });
    const hosts = row ? parseRichUrlHosts(row.hosts) : [];
    return {
      chatbotId,
      hosts,
      updatedAt: row?.updatedAt ?? null,
      outsideNodeCount: await this.outsideNodeCount(chatbotId, hosts),
      governanceModeOn: governanceRuntime().mode === 'ON',
    };
  }

  async update(chatbotId: string, dto: UpdateRichUrlPolicyDto): Promise<RichUrlPolicyResponse> {
    // [신규 No.46 — L-1] 존재·상태 확인은 `assertWritable` 1회로 충분하다. 이름도 여기서 함께
    // 받아 별도의 `chatbot.findUnique` 조회를 없앤다(§17 성능 예산).
    const { name } = await this.scope.assertWritable(chatbotId);

    const before = await this.prisma.chatbotRichUrlPolicy.findUnique({ where: { chatbotId } });
    const beforeHosts = before ? parseRichUrlHosts(before.hosts) : [];
    const beforeHostList = beforeHosts.map((h) => h.host).sort();
    const afterHostList = [...dto.hosts.map((h) => h.host)].sort();
    const unchanged = beforeHostList.length === afterHostList.length && beforeHostList.every((h, i) => h === afterHostList[i]) && sameSubdomainFlags(beforeHosts, dto.hosts);

    let hosts = beforeHosts;
    let updatedAt = before?.updatedAt ?? null;

    if (!unchanged) {
      const saved = await this.prisma.chatbotRichUrlPolicy.upsert({
        where: { chatbotId },
        create: { chatbotId, hosts: serializeRichUrlHosts(dto.hosts) },
        update: { hosts: serializeRichUrlHosts(dto.hosts) },
      });
      hosts = dto.hosts;
      updatedAt = saved.updatedAt;
      await this.auditLog.record({
        action: 'UPDATE',
        targetType: 'Chatbot',
        targetId: chatbotId,
        targetName: name,
        chatbotId,
        // [신규 No.46 — M-2] 호스트 문자열만이 아니라 `includeSubdomains`도 함께 남긴다 — 호스트
        // 개수가 같아도(예: 하위 도메인 포함 여부만 바뀜) 무엇이 바뀌었는지 드러나야 한다.
        before: { richUrlHosts: beforeHosts.map((h) => ({ host: h.host, includeSubdomains: h.includeSubdomains })) },
        after: { richUrlHosts: dto.hosts.map((h) => ({ host: h.host, includeSubdomains: h.includeSubdomains })) },
        summary: buildAuditSummary(beforeHosts, dto.hosts),
      });
    }

    // [신규 No.46 — L-1] `this.get()`을 다시 부르지 않고(챗봇 재조회·정책 재조회 중복 제거) 이미
    // 가진 값으로 응답을 조립한다. `outsideNodeCount`는 설계서 기준대로 노드 스캔 1쿼리를 그대로 쓴다.
    return {
      chatbotId,
      hosts,
      updatedAt,
      outsideNodeCount: await this.outsideNodeCount(chatbotId, hosts),
      governanceModeOn: governanceRuntime().mode === 'ON',
    };
  }
}

function sameSubdomainFlags(before: readonly { host: string; includeSubdomains: boolean }[], after: readonly { host: string; includeSubdomains: boolean }[]): boolean {
  if (before.length !== after.length) return false;
  const beforeMap = new Map(before.map((h) => [h.host, h.includeSubdomains]));
  return after.every((h) => beforeMap.get(h.host) === h.includeSubdomains);
}

/**
 * [신규 No.46 — M-2] 감사 summary 보강 — 호스트 수가 같아도(하위 도메인 포함 여부만 바뀐 경우 등)
 * 무엇이 바뀌었는지 드러난다.
 */
function buildAuditSummary(before: readonly { host: string; includeSubdomains: boolean }[], after: readonly { host: string; includeSubdomains: boolean }[]): string {
  const beforeMap = new Map(before.map((h) => [h.host, h.includeSubdomains]));
  const afterMap = new Map(after.map((h) => [h.host, h.includeSubdomains]));
  const added = after.filter((h) => !beforeMap.has(h.host)).map((h) => h.host);
  const removed = before.filter((h) => !afterMap.has(h.host)).map((h) => h.host);
  const subdomainChanged = after.filter((h) => beforeMap.has(h.host) && beforeMap.get(h.host) !== h.includeSubdomains).map((h) => h.host);

  const parts = [`리치 메시지 허용 도메인 변경 (${before.length} → ${after.length}개)`];
  if (added.length > 0) parts.push(`추가 ${added.length}(${added.join(', ')})`);
  if (removed.length > 0) parts.push(`삭제 ${removed.length}(${removed.join(', ')})`);
  if (subdomainChanged.length > 0) parts.push(`하위 도메인 포함 변경 ${subdomainChanged.length}(${subdomainChanged.join(', ')})`);
  return parts.join(' · ');
}

function safeParseOutputs(json: string): DialogOutput[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as DialogOutput[]) : [];
  } catch {
    return [];
  }
}
