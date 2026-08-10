import type { PaginationMeta } from '../../types/api';
import { Button } from './Button';
import styles from './Pagination.module.css';

/**
 * Previous/next pagination with a record range.
 *
 * Deliberately not numbered page links: the record range ("21–40 of 137") is
 * what an operations user actually reads, and it stays legible on a phone.
 */
export default function Pagination({
  pagination,
  onPageChange,
  isLoading = false,
}: {
  pagination: PaginationMeta;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
}): JSX.Element | null {
  const { page, limit, total, totalPages } = pagination;

  if (total === 0) return null;

  const firstRecord = (page - 1) * limit + 1;
  const lastRecord = Math.min(page * limit, total);

  return (
    <div className={styles.bar}>
      <span className={styles.range}>
        Showing <strong>{firstRecord}</strong>–<strong>{lastRecord}</strong> of{' '}
        <strong>{total}</strong>
      </span>

      <div className={styles.controls}>
        <Button
          type="button"
          variant="secondary"
          small
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1 || isLoading}
        >
          Previous
        </Button>
        <span className={styles.pageLabel}>
          Page {page} of {totalPages}
        </span>
        <Button
          type="button"
          variant="secondary"
          small
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages || isLoading}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
