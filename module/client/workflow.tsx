import type { ReactNode } from "react";
export function WorkflowFeedback({
  error,
  children,
  onRetry,
}: {
  error?: boolean;
  children: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div
      className="workflow-feedback"
      data-error={error || undefined}
      role={error ? "alert" : "status"}
    >
      <div>{children}</div>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  );
}

export function WorkflowPagination({
  page,
  total,
  pageSize = 10,
  onChange,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="workflow-pagination" aria-label="结果分页">
      <span>共 {total} 项</span>
      <button
        type="button"
        disabled={page <= 0}
        onClick={() => onChange(page - 1)}
      >
        上一页
      </button>
      <span>
        {Math.min(page + 1, pages)} / {pages}
      </span>
      <button
        type="button"
        disabled={page + 1 >= pages}
        onClick={() => onChange(page + 1)}
      >
        下一页
      </button>
    </nav>
  );
}
