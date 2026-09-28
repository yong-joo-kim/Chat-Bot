import type { KbDocumentView, KbRunView, KbSourceResponse } from '@chat-bot/shared-types';

function safeArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeSchedule(row: { scheduleKind: string; scheduleTime: string | null; scheduleWeekday: number | null }): KbSourceResponse['schedule'] {
  if (row.scheduleKind === 'DAILY' && row.scheduleTime) return { kind: 'DAILY', time: row.scheduleTime };
  if (row.scheduleKind === 'WEEKLY' && row.scheduleTime && row.scheduleWeekday !== null) return { kind: 'WEEKLY', time: row.scheduleTime, weekday: row.scheduleWeekday };
  return { kind: 'MANUAL' };
}

/** ★ `KbSource` 응답 DTO 조립 — 값 비밀 필드(헤더 값)는 절대 포함하지 않는다(참조 이름만). */
export function toKbSourceResponse(
  row: {
    id: string;
    name: string;
    seedUrls: string;
    sitemapUrls: string;
    allowedHosts: string;
    pathPrefixes: string;
    excludePatterns: string;
    noisePatterns: string;
    allowQueryUrls: boolean;
    maxDepth: number;
    maxPages: number;
    fileTypes: string;
    maxFileBytes: number;
    minIntervalMs: number;
    scopeCompany: string;
    scopeCategory: string;
    scopeSubcategory: string;
    scheduleKind: string;
    scheduleTime: string | null;
    scheduleWeekday: number | null;
    authKind: string;
    authHeaderName: string | null;
    authSecretRef: string | null;
    piiMask: boolean;
    allowRawFileIngest: boolean;
    enabled: boolean;
    configVersion: number;
    approvedConfigVersion: number | null;
    reviewRequiredReason: string | null;
    nextRunAt: Date | null;
    lastRunId: string | null;
    lastRunStatus: string | null;
    lastRunFinishedAt: Date | null;
    rightsConfirmedAt: Date;
    createdAt: Date;
    updatedAt: Date;
  },
  extras: { activeRun: KbRunView | null; needsCleanupCount: number; repeatedFailureCount: number; activeDocumentCount: number; previewStale: boolean },
): KbSourceResponse {
  return {
    id: row.id,
    name: row.name,
    seedUrls: safeArray(row.seedUrls),
    sitemapUrls: safeArray(row.sitemapUrls),
    allowedHosts: safeArray(row.allowedHosts),
    pathPrefixes: safeArray(row.pathPrefixes),
    excludePatterns: safeArray(row.excludePatterns),
    noisePatterns: safeArray(row.noisePatterns),
    allowQueryUrls: row.allowQueryUrls,
    maxDepth: row.maxDepth,
    maxPages: row.maxPages,
    fileTypes: safeArray(row.fileTypes) as KbSourceResponse['fileTypes'],
    maxFileBytes: row.maxFileBytes,
    minIntervalMs: row.minIntervalMs,
    scope: { company: row.scopeCompany, category: row.scopeCategory, subcategory: row.scopeSubcategory },
    schedule: safeSchedule(row),
    authKind: row.authKind as 'NONE' | 'STATIC_HEADER',
    authHeaderName: row.authHeaderName,
    authSecretRef: row.authSecretRef,
    piiMask: row.piiMask,
    allowRawFileIngest: row.allowRawFileIngest,
    enabled: row.enabled,
    configVersion: row.configVersion,
    ingestApproved: row.approvedConfigVersion === row.configVersion && !row.reviewRequiredReason,
    needsPreview: row.approvedConfigVersion !== row.configVersion || !!row.reviewRequiredReason,
    reviewRequiredReason: (row.reviewRequiredReason as KbSourceResponse['reviewRequiredReason']) ?? null,
    activeRun: extras.activeRun,
    lastRun: row.lastRunId ? { id: row.lastRunId, status: (row.lastRunStatus ?? 'SUCCEEDED') as never, finishedAt: row.lastRunFinishedAt } : null,
    nextRunAt: row.nextRunAt,
    needsCleanupCount: extras.needsCleanupCount,
    repeatedFailureCount: extras.repeatedFailureCount,
    activeDocumentCount: extras.activeDocumentCount,
    previewStale: extras.previewStale,
    rightsConfirmedAt: row.rightsConfirmedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as KbSourceResponse;
}

export function toKbDocumentView(row: {
  id: string;
  url: string;
  kind: string;
  state: string;
  excludeReason: string | null;
  cleanupReason: string | null;
  observedChange: string | null;
  title: string | null;
  lastIngestedAt: Date | null;
  lastSeenAt: Date;
  consecutiveIngestFailures: number;
  externalFileName: string;
}): KbDocumentView {
  let display = row.url;
  try {
    const u = new URL(row.url);
    display = `${u.hostname}${u.pathname}${u.search ? '?…' : ''}`;
  } catch {
    // 원문 유지
  }
  return {
    id: row.id,
    displayUrl: display,
    kind: row.kind,
    state: row.state as KbDocumentView['state'],
    excludeReason: row.excludeReason as KbDocumentView['excludeReason'],
    cleanupReason: row.cleanupReason as KbDocumentView['cleanupReason'],
    observedChange: row.observedChange as KbDocumentView['observedChange'],
    title: row.title,
    lastIngestedAt: row.lastIngestedAt,
    lastSeenAt: row.lastSeenAt,
    consecutiveIngestFailures: row.consecutiveIngestFailures,
    externalFileName: row.externalFileName,
  };
}
