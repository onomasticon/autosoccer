import type { ReactNode } from "react";

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card-surface flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="empty-state">
      <svg aria-hidden viewBox="0 0 64 40" width="64" height="40">
        <rect
          x="1"
          y="1"
          width="62"
          height="38"
          rx="4"
          fill="none"
          stroke="currentColor"
          className="text-line"
          strokeWidth="2"
        />
        <line x1="32" y1="1" x2="32" y2="39" stroke="currentColor" className="text-line" strokeWidth="2" />
        <circle cx="32" cy="20" r="7" fill="none" stroke="currentColor" className="text-line" strokeWidth="2" />
      </svg>
      <p className="font-display text-xl font-bold uppercase italic">{title}</p>
      {children && <div className="text-sm text-muted-text">{children}</div>}
    </div>
  );
}

export function ErrorState({ title = "Couldn't load this", children }: { title?: string; children?: ReactNode }) {
  return (
    <div role="alert" className="card-surface border-l-4 border-l-coral px-5 py-4" data-testid="error-state">
      <p className="font-semibold">
        <span aria-hidden className="mr-2">
          ⚠
        </span>
        {title}
      </p>
      {children && <div className="mt-1 text-sm text-muted-text">{children}</div>}
    </div>
  );
}

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div aria-hidden className={`skeleton-block ${className}`} />;
}

/** Wraps skeleton content so screen readers announce a single loading status. */
export function Loading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="min-w-0" data-testid="loading-state">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
