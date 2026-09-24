import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ResolvedScope } from '../lib/scope-filter';

/**
 * No.29 그룹·전역 스코프 세션 distinct 원시 SQL — 이 그룹의 **유일한 원시 SQL 격리 파일**
 * (FR-I7-2, NFR-IP3, ADR-0017 §4 탈출구 이행, `integrated-stats-설계.md` §5.3). 챗봇 스코프(No.14)의
 * 앱 폴딩(`groupBy(['dayBucket','channelType','sessionId'])`)은 바꾸지 않는다 — 그룹·전역 스코프만
 * 반환 행이 세션 수와 무관하도록 DB가 `COUNT(DISTINCT)`를 계산한다.
 *
 * 버킷 키는 DB 날짜 함수가 아니라 `buildBucketDayRanges()`가 만든 `dayBucket` 범위 목록의
 * `CASE WHEN … THEN …` 바인딩이다(주차 규칙 TS 1벌 유지). 세션 키 = `chatbotId || '|' || sessionId`
 * (서로 다른 챗봇의 세션은 별개). 전 입력은 `Prisma.sql`/`Prisma.join` 바인딩 파라미터이며
 * `$queryRawUnsafe`는 쓰지 않는다(R-7).
 */

export type SessionGroupKey = 'NONE' | 'BUCKET' | 'CHANNEL' | 'CHATBOT' | 'GROUP';

export interface SessionCountRequest {
  scope: ResolvedScope;
  /** 누적 KPI(overview)는 기간이 없다 — 생략 가능. */
  period?: { fromDayBucket: string; toDayBucket: string };
  groupBy: SessionGroupKey;
  /** `groupBy==='BUCKET'`일 때 필수(비어 있으면 오류). */
  bucketRanges?: Array<{ key: string; fromDay: string; toDay: string }>;
}

export interface SessionCountRow {
  key: string | null;
  distinctSessions: number;
  nullSessions: number;
}

function buildKeyExpr(req: SessionCountRequest): Prisma.Sql {
  if (req.groupBy === 'NONE') return Prisma.sql`NULL`;
  if (req.groupBy === 'CHANNEL') return Prisma.sql`"channelType"`;
  if (req.groupBy === 'CHATBOT') return Prisma.sql`"chatbotId"`;
  if (req.groupBy === 'GROUP') return Prisma.sql`"groupId"`;

  // BUCKET — 버킷별 dayBucket 범위를 CASE WHEN으로 바인딩한다(§5.3, DB 날짜함수 금지).
  const ranges = req.bucketRanges ?? [];
  if (ranges.length === 0) {
    throw new Error('buildSessionCountSql: groupBy=BUCKET에는 bucketRanges가 최소 1개 필요합니다.');
  }
  const whens = ranges.map((r) => Prisma.sql`WHEN "dayBucket" >= ${r.fromDay} AND "dayBucket" <= ${r.toDay} THEN ${r.key}`);
  return Prisma.sql`CASE ${Prisma.join(whens, ' ')} END`;
}

function buildWhere(req: SessionCountRequest): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (req.scope.scope === 'GROUP') conditions.push(Prisma.sql`"groupId" = ${req.scope.groupId}`);
  if (req.period) conditions.push(Prisma.sql`"dayBucket" >= ${req.period.fromDayBucket} AND "dayBucket" <= ${req.period.toDayBucket}`);
  if (conditions.length === 0) return Prisma.sql``;
  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

/** 순수 빌더 — 단위 테스트(파라미터 바인딩·식별자 화이트리스트) 대상. */
export function buildSessionCountSql(req: SessionCountRequest): Prisma.Sql {
  const keyExpr = buildKeyExpr(req);
  const where = buildWhere(req);
  const groupByClause = req.groupBy === 'NONE' ? Prisma.sql`` : Prisma.sql`GROUP BY t."k"`;

  return Prisma.sql`
    SELECT t."k" AS "key",
           COUNT(DISTINCT t."sk") AS "distinctSessions",
           SUM(t."ns") AS "nullSessions"
    FROM (
      SELECT ${keyExpr} AS "k",
             CASE WHEN "sessionId" IS NOT NULL THEN "chatbotId" || '|' || "sessionId" END AS "sk",
             CASE WHEN "sessionId" IS NULL THEN 1 ELSE 0 END AS "ns"
      FROM "conversation_logs"
      ${where}
    ) t
    ${groupByClause}
  `;
}

interface RawRow {
  key: string | null;
  distinctSessions: bigint | number | null;
  nullSessions: bigint | number | null;
}

@Injectable()
export class IntegratedSessionQuery {
  constructor(private readonly prisma: PrismaService) {}

  async count(req: SessionCountRequest): Promise<SessionCountRow[]> {
    const sql = buildSessionCountSql(req);
    const rows = await this.prisma.$queryRaw<RawRow[]>(sql);
    return rows.map((r) => ({
      key: r.key,
      distinctSessions: Number(r.distinctSessions ?? 0),
      nullSessions: Number(r.nullSessions ?? 0),
    }));
  }
}
