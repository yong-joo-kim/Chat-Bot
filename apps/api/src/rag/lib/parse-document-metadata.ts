/**
 * `GET /api/documents/metadata`는 JSON 객체가 아니라 **여러 줄 문자열**이다(API_RAG.md §2-2).
 * 순수 파서 — DB·Nest 무의존(DD-78). `"Graph DB가 로드되지 않았습니다."`는 HTTP 200이지만
 * 실패다(§2-3) — 그 판별은 이 파서가 아니라 호출부(`RagAnswerService`/연결 점검)의 책임이다.
 */

export interface CategoryInfo {
  total: number;
  subcategories: Map<string, number>;
}

export interface CompanyInfo {
  total: number;
  categories: Map<string, CategoryInfo>;
}

export interface ParsedDocumentMetadata {
  totalChunks: number;
  byCompany: Map<string, CompanyInfo>;
}

const TOTAL_RE = /^총 저장된 벡터의 개수:\s*(\d+)/;
const SUBCATEGORY_RE = /^ {4}- (.+): (\d+)개\s*$/;
const CATEGORY_RE = /^ {2}- (.+): (\d+)개\s*$/;
const COMPANY_HEADER_RE = /^- (.+):\s*$/;
const COMPANY_TOTAL_RE = /^- (.+): (\d+)개\s*$/;

export function parseDocumentMetadata(resultText: string): ParsedDocumentMetadata {
  const byCompany = new Map<string, CompanyInfo>();
  let totalChunks = 0;
  let currentCompany: string | null = null;
  let currentCategory: string | null = null;

  for (const line of resultText.split('\n')) {
    const totalMatch = line.match(TOTAL_RE);
    if (totalMatch) {
      totalChunks = Number(totalMatch[1]);
      continue;
    }

    const subMatch = line.match(SUBCATEGORY_RE);
    if (subMatch && currentCompany && currentCategory) {
      byCompany.get(currentCompany)?.categories.get(currentCategory)?.subcategories.set(subMatch[1], Number(subMatch[2]));
      continue;
    }

    const catMatch = line.match(CATEGORY_RE);
    if (catMatch && currentCompany) {
      const company = byCompany.get(currentCompany) ?? { total: 0, categories: new Map() };
      company.categories.set(catMatch[1], { total: Number(catMatch[2]), subcategories: new Map() });
      byCompany.set(currentCompany, company);
      currentCategory = catMatch[1];
      continue;
    }

    const headerMatch = line.match(COMPANY_HEADER_RE);
    if (headerMatch) {
      currentCompany = headerMatch[1];
      currentCategory = null;
      if (!byCompany.has(currentCompany)) byCompany.set(currentCompany, { total: 0, categories: new Map() });
      continue;
    }

    const totalCompanyMatch = line.match(COMPANY_TOTAL_RE);
    if (totalCompanyMatch) {
      const company = byCompany.get(totalCompanyMatch[1]) ?? { total: 0, categories: new Map() };
      company.total = Number(totalCompanyMatch[2]);
      byCompany.set(totalCompanyMatch[1], company);
    }
  }

  return { totalChunks, byCompany };
}

/**
 * 현재 챗봇의 스코프(company/category/subcategory)에 해당하는 청크 수 1개만 계산한다.
 * **파싱 결과 전체(= 다른 회사명 목록)는 이 함수를 거치지 않고는 밖으로 나가지 않는다**
 * (FR-N2-7, AC-N3-5 — 테넌트 격리를 코드 수준에서 보장하는 지점).
 */
export function scopeChunkCount(parsed: ParsedDocumentMetadata, scope: { company: string; category?: string | null; subcategory?: string | null }): number {
  const company = parsed.byCompany.get(scope.company);
  if (!company) return 0;
  if (!scope.category) return company.total;

  const category = company.categories.get(scope.category);
  if (!category) return 0;
  if (!scope.subcategory) return category.total;

  return category.subcategories.get(scope.subcategory) ?? 0;
}
