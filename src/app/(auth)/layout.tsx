import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 items-start justify-center bg-bg px-gutter py-16 sm:items-center">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-lg border border-border bg-surface p-card">
        {children}
      </div>
    </main>
  );
}
