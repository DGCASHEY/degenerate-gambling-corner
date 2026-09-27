import type { ReactNode } from "react";

// Scrolls sideways inside its own box on narrow screens, so the page never does.
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

type CellProps = {
  children?: ReactNode;
  // Numbers line up on the right in the mono font.
  numeric?: boolean;
  className?: string;
};

export function Th({ children, numeric = false, className = "" }: CellProps) {
  return (
    <th
      scope="col"
      className={`border-b border-border px-4 py-3 text-xs font-medium tracking-wide text-fg-subtle uppercase ${numeric ? "text-right" : "text-left"} ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, numeric = false, className = "" }: CellProps) {
  return (
    <td
      className={`border-b border-border px-4 py-3 text-fg [tr:last-child_&]:border-b-0 ${numeric ? "text-right font-mono tabular-nums" : ""} ${className}`}
    >
      {children}
    </td>
  );
}
