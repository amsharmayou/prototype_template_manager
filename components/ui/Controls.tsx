"use client";

import { useEffect, useState, type ReactNode } from "react";

export function Panel({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="border-b border-neutral-200">
      <header className="flex items-center justify-between px-3 py-2 bg-neutral-50 border-b border-neutral-200">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          {title}
        </h2>
        {actions}
      </header>
      <div className="p-3 space-y-2.5">{children}</div>
    </section>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-neutral-600 mb-1">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="block text-[10px] text-neutral-400 mt-0.5">{hint}</span>
      ) : null}
    </label>
  );
}

const inputClass =
  "w-full rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

/**
 * Numeric field that can actually be retyped.
 *
 * A controlled `type="number"` that rejects empty input makes it impossible to
 * clear a value: backspacing the last digit snaps the old number back and the
 * caret lands at the end, so typing "12" after "3" produces "312". This keeps a
 * text draft while focused, so the field can be emptied and rewritten, and only
 * commits a parsed number.
 */
export function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) ? String(round2(value)) : "");

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (Number.isNaN(parsed)) {
      // Nothing usable: fall back to the current value.
      onChange(value);
      return;
    }
    let next = parsed;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    onChange(next);
  };

  return (
    <input
      type="number"
      inputMode="decimal"
      className={`${inputClass} num-input ${className ?? ""}`}
      value={shown}
      step={step}
      min={min}
      max={max}
      onChange={(e) => {
        // Keep whatever the user typed, including an empty field.
        setDraft(e.target.value);
        const parsed = Number.parseFloat(e.target.value);
        if (!Number.isNaN(parsed)) {
          let next = parsed;
          if (min !== undefined) next = Math.max(min, next);
          if (max !== undefined) next = Math.min(max, next);
          onChange(next);
        }
      }}
      onFocus={(e) => {
        // Select the contents so typing replaces the value outright.
        e.target.select();
      }}
      onBlur={(e) => {
        commit(e.target.value);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit(e.currentTarget.value);
          setDraft(null);
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
        // Arrow keys still work for nudging values.
        e.stopPropagation();
      }}
    />
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function Select({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <select
      className={`${inputClass} ${className ?? ""}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ColorInput({
  value,
  onChange,
  allowTransparent = true,
}: {
  value: string;
  onChange: (v: string) => void;
  allowTransparent?: boolean;
}) {
  const isTransparent = value === "transparent" || value === "";
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        aria-label="Colour"
        className="h-7 w-8 shrink-0 cursor-pointer rounded border border-neutral-300 bg-white p-0.5"
        value={isTransparent ? "#000000" : value.slice(0, 7)}
        onChange={(e) => onChange(e.target.value)}
      />
      {allowTransparent ? (
        <button
          type="button"
          onClick={() => onChange(isTransparent ? "#000000" : "transparent")}
          className={`rounded border px-1.5 py-1 text-[10px] ${
            isTransparent
              ? "border-blue-500 bg-blue-50 text-blue-700"
              : "border-neutral-300 text-neutral-500"
          }`}
          title="Toggle transparent"
        >
          {isTransparent ? "None" : "T"}
        </button>
      ) : null}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  title,
  className,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: "button" | "submit";
}) {
  const styles: Record<string, string> = {
    default:
      "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-40",
    primary:
      "border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40",
    ghost:
      "border border-transparent text-neutral-600 hover:bg-neutral-100 disabled:opacity-40",
    danger:
      "border border-red-300 bg-white text-red-600 hover:bg-red-50 disabled:opacity-40",
  };
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-xs text-neutral-700 select-none ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-blue-600"
      />
      {label}
    </label>
  );
}

/** Small modal dialog. Centred, focus-trapping enough for a form. */
export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = "w-72",
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-neutral-900/30 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`${width} rounded-lg border border-neutral-200 bg-white p-4 shadow-xl`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
            {description ? (
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded px-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            ✕
          </button>
        </div>
        <div className="mt-3 space-y-3">{children}</div>
        {footer ? <div className="mt-4 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
