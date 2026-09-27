import type { ReactNode } from "react";

type CardProps = {
  title?: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function Card({
  title,
  description,
  action,
  children,
  className = "",
}: CardProps) {
  return (
    <section
      className={`flex flex-col gap-4 rounded-lg border border-border bg-surface p-card ${className}`}
    >
      {title || action ? (
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            {title ? (
              <h3 className="text-lg font-semibold text-fg">{title}</h3>
            ) : null}
            {description ? (
              <p className="text-sm text-fg-muted">{description}</p>
            ) : null}
          </div>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}
