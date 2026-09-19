export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** 현재 페이지는 배경색 + 밑줄(대비 3:1 이상)로 이중 표시한다(UIUX §9, NFR-A8). */
export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps): JSX.Element | null {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <nav className="pagination" aria-label="페이지 내비게이션">
      <button
        type="button"
        className="pagination-arrow"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="이전 페이지"
      >
        ◀
      </button>
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          className={`pagination-page${p === page ? ' pagination-page--current' : ''}`}
          aria-current={p === page ? 'page' : undefined}
          onClick={() => onPageChange(p)}
        >
          {p}
        </button>
      ))}
      <button
        type="button"
        className="pagination-arrow"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="다음 페이지"
      >
        ▶
      </button>
    </nav>
  );
}
