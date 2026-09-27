import type { InputHTMLAttributes, ReactNode } from "react";

type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
};

// Label, the control, then either an error or a hint underneath.
export function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-xs font-medium text-fg-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-message`} className="text-xs text-loss">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-message`} className="text-xs text-fg-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  invalid?: boolean;
  numeric?: boolean;
};

export function Input({
  id,
  prefix,
  suffix,
  invalid = false,
  numeric = false,
  className = "",
  ...rest
}: InputProps) {
  return (
    <div
      className={`flex h-10 min-w-0 items-center gap-2 rounded-md border bg-inset px-3 focus-within:border-accent-text has-disabled:opacity-40 ${invalid ? "border-loss" : "border-border-strong"} ${className}`}
    >
      {prefix ? <span className="text-sm text-fg-subtle">{prefix}</span> : null}
      <input
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-message`}
        className={`min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed ${numeric ? "font-mono tabular-nums" : ""}`}
        {...rest}
      />
      {suffix ? <span className="text-sm text-fg-subtle">{suffix}</span> : null}
    </div>
  );
}

type SwitchProps = {
  id: string;
  label: string;
  description?: string;
  defaultChecked?: boolean;
  // Form field name. Sent as "on" when switched on, left out when off.
  name?: string;
};

// An on/off switch. Used for the three Incognito settings.
export function Switch({ id, label, description, defaultChecked, name }: SwitchProps) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start justify-between gap-4"
    >
      <span className="flex flex-col gap-1">
        <span className="text-sm font-medium text-fg">{label}</span>
        {description ? (
          <span className="text-xs text-fg-subtle">{description}</span>
        ) : null}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          id={id}
          name={name}
          type="checkbox"
          role="switch"
          defaultChecked={defaultChecked}
          className="peer sr-only"
        />
        <span className="h-6 w-11 rounded-full border border-border-strong bg-inset transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-text" />
        <span className="absolute top-1 left-1 size-4 rounded-full bg-fg-muted transition-transform peer-checked:translate-x-5 peer-checked:bg-accent-fg" />
      </span>
    </label>
  );
}

type SegmentedOption = { value: string; label: string };

type SegmentedControlProps = {
  name: string;
  label: string;
  options: SegmentedOption[];
  defaultValue: string;
};

// Pick exactly one of a few options. Used for the Manual / Auto tabs.
export function SegmentedControl({
  name,
  label,
  options,
  defaultValue,
}: SegmentedControlProps) {
  return (
    <fieldset className="flex rounded-md border border-border bg-inset p-1">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className="flex-1 cursor-pointer rounded-sm px-3 py-1.5 text-center text-sm font-medium text-fg-muted transition-colors hover:text-fg has-checked:bg-surface has-checked:text-fg has-checked:ring-1 has-checked:ring-border-strong has-focus-visible:outline-2 has-focus-visible:outline-accent-text"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            data-mode={option.value}
            defaultChecked={option.value === defaultValue}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
