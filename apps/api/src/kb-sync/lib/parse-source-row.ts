/**
 * [신규 No.43] `KbSource` 행(JSON 문자열 컬럼)을 크롤·적재 엔진이 쓰는 형태로 파싱한다(순수 —
 * DB·Nest 무의존, 행 객체만 받는다).
 */
import { computeAllowedOrigins, computePlainHttpOrigins } from './allowed-origins';

function safeArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface ParsedSourceConfig {
  id: string;
  name: string;
  seedUrls: string[];
  sitemapUrls: string[];
  allowedHosts: string[];
  /** [pass 12 · RG-26] 시작 주소·사이트맵 URL에서 **실행 시점에** 계산한 허용 출처(host:port) — 저장하지 않는다. */
  allowedOrigins: string[];
  /** [pass 13 · RG-28] `http:`를 명시한 시작 주소·사이트맵의 host:port — 평문 요청에 인증 헤더를 실어도 되는 출처(실행 시점 계산 · 저장 안 함). */
  plainHttpOrigins: string[];
  pathPrefixes: string[];
  excludePatterns: string[];
  noisePatterns: string[];
  allowQueryUrls: boolean;
  maxDepth: number;
  maxPages: number;
  fileTypes: string[];
  maxFileBytes: number;
  minIntervalMs: number;
  authKind: string;
  authHeaderName: string | null;
  authSecretRef: string | null;
  piiMask: boolean;
  allowRawFileIngest: boolean;
}

export function parseSourceRow(row: {
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
  authKind: string;
  authHeaderName: string | null;
  authSecretRef: string | null;
  piiMask: boolean;
  allowRawFileIngest: boolean;
}): ParsedSourceConfig {
  const seedUrls = safeArray(row.seedUrls);
  const sitemapUrls = safeArray(row.sitemapUrls);
  return {
    id: row.id,
    name: row.name,
    seedUrls,
    sitemapUrls,
    allowedHosts: safeArray(row.allowedHosts),
    allowedOrigins: computeAllowedOrigins(seedUrls, sitemapUrls),
    plainHttpOrigins: computePlainHttpOrigins(seedUrls, sitemapUrls),
    pathPrefixes: safeArray(row.pathPrefixes),
    excludePatterns: safeArray(row.excludePatterns),
    noisePatterns: safeArray(row.noisePatterns),
    allowQueryUrls: row.allowQueryUrls,
    maxDepth: row.maxDepth,
    maxPages: row.maxPages,
    fileTypes: safeArray(row.fileTypes),
    maxFileBytes: row.maxFileBytes,
    minIntervalMs: row.minIntervalMs,
    authKind: row.authKind,
    authHeaderName: row.authHeaderName,
    authSecretRef: row.authSecretRef,
    piiMask: row.piiMask,
    allowRawFileIngest: row.allowRawFileIngest,
  };
}
