import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary:
    "bg-surface text-fg border border-border-strong hover:bg-surface-hover",
  ghost: "bg-transparent text-fg-muted hover:bg-surface-hover hover:text-fg",
  danger: "bg-loss-soft text-loss border border-loss hover:bg-surface-hover",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
};

function buttonClasses(variant: Variant, size: Size, fullWidth: boolean, className: string) {
  return `inline-flex items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-40 ${variants[variant]} ${sizes[size]} ${fullWidth ? "w-full" : ""} ${className}`;
}

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  type = "button",
  className = "",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, fullWidth, className)}
      {...rest}
    />
  );
}

// A link that looks exactly like a Button. For going somewhere, not doing
// something.
export function ButtonLink({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className = "",
  ...rest
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size; fullWidth?: boolean }) {
  return <Link className={buttonClasses(variant, size, fullWidth, className)} {...rest} />;
}
