"use client";

import { ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
    <section className="border-b border-rule">
      <header className="flex items-center justify-between gap-2 border-b border-rule bg-paper px-3 py-2">
        <h2 className="font-display text-[13px] font-semibold text-ink">
          {title}
        </h2>
        {actions}
      </header>
      <div className="p-3 space-y-2.5">{children}</div>
    </section>
  );
}

/**
 * Collapsible inspector section.
 *
 * The heading is a real button inside the `h2`, so the accessible name of the
 * heading stays exactly the section title while also being a control:
 * `getByRole("heading", { name })` and `getByRole("button", { name })` both
 * find it.
 *
 * Collapse state outlives the component on purpose: `SinglePanel` is keyed by
 * object id, so every selection change remounts the sections, and a section the
 * author collapsed must stay collapsed. A module-level set is the smallest
 * thing that survives a remount without an effect.
 */
const collapsedSections = new Set<string>();

export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => !collapsedSections.has(id));

  const toggle = () => {
    const next = !open;
    if (next) collapsedSections.delete(id);
    else collapsedSections.add(id);
    setOpen(next);
  };

  return (
    <section
      id={`inspector-${id}`}
      className="scroll-mt-[calc(var(--inspector-nav-h,44px)_+_4px)] border-b border-rule"
    >
      <h2>
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          className="flex w-full items-center justify-between gap-2 border-b border-rule bg-paper px-3 py-2 text-left transition-colors hover:bg-desk"
        >
          <span className="font-display text-[13px] font-semibold text-ink">
            {title}
          </span>
          <ChevronDown
            aria-hidden
            className={`h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform ${
              open ? "" : "-rotate-90"
            }`}
          />
        </button>
      </h2>
      {open ? <div className="space-y-2.5 p-3">{children}</div> : null}
    </section>
  );
}

/**
 * The inspector's sticky table of contents.
 *
 * Pure scroll-to: the sections are already in the DOM, so the index never has
 * to own the layout, and it disappears on its own when a selection has only
 * one section to show (a single-nav index is noise).
 */
export function IndexNav({
  sections,
}: {
  sections: { id: string; label: string }[];
}) {
  const navRef = useRef<HTMLElement>(null);

  // Publish the bar's height as a CSS variable so the sections' scroll margins
  // clear it: the pills wrap to two rows for some selections, and a fixed
  // margin would leave the title a jump just scrolled to hidden behind them.
  useEffect(() => {
    const nav = navRef.current;
    const scroller = nav?.closest<HTMLElement>(".editor-scroll");
    if (!nav || !scroller) return;
    const publish = () =>
      scroller.style.setProperty("--inspector-nav-h", `${nav.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  if (sections.length < 2) return null;
  return (
    <nav
      ref={navRef}
      aria-label="Inspector"
      className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-rule bg-paper px-2 py-1.5"
    >
      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() =>
            document
              .getElementById(`inspector-${s.id}`)
              ?.scrollIntoView({ block: "start", behavior: "smooth" })
          }
          className="h-8 rounded-full border border-rule px-2.5 text-[12px] text-ink-soft transition-colors hover:bg-desk hover:text-ink"
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
}

/** Pressable pill toggle, used for the "what this is" role choices. */
export function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`h-8 rounded-full border px-2.5 text-[12px] transition-colors ${
        selected
          ? "border-ink bg-ink text-paper"
          : "border-rule text-ink-soft hover:bg-desk hover:text-ink"
      }`}
    >
      {label}
    </button>
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
      <span className="block text-[12px] font-medium text-ink-soft mb-1">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="block text-[12px] text-ink-faint mt-0.5">{hint}</span>
      ) : null}
    </label>
  );
}

const inputClass =
  "h-8 w-full rounded-md border border-rule bg-paper px-2 text-[13px] text-ink placeholder:text-ink-faint focus:border-ink disabled:opacity-50";

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
  options: Array<{ value: string; label: string; style?: React.CSSProperties }>;
  className?: string;
}) {
  return (
    <select
      className={`${inputClass} ${className ?? ""}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} style={o.style}>
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
        className="h-8 w-9 shrink-0 cursor-pointer rounded-md border border-rule bg-paper p-0.5"
        value={isTransparent ? "#000000" : value.slice(0, 7)}
        onChange={(e) => onChange(e.target.value)}
      />
      {allowTransparent ? (
        <button
          type="button"
          onClick={() => onChange(isTransparent ? "#000000" : "transparent")}
          className={`h-8 rounded-md border px-2 text-[12px] transition-colors ${
            isTransparent
              ? "border-ink bg-ink text-paper"
              : "border-rule text-ink-soft hover:bg-desk"
          }`}
          title="Toggle transparent"
        >
          {isTransparent ? "None" : "Solid"}
        </button>
      ) : null}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
  title,
  label,
  pressed,
  className,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "md" | "lg";
  disabled?: boolean;
  title?: string;
  label?: string;
  pressed?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const styles: Record<string, string> = {
    default: "border-rule bg-paper text-ink hover:bg-desk disabled:opacity-40",
    primary:
      "border-ink bg-ink text-paper hover:border-ink-soft hover:bg-ink-soft disabled:opacity-40",
    ghost: "border-transparent text-ink-soft hover:bg-desk disabled:opacity-40",
    danger:
      "border-rule bg-paper text-stamp hover:border-stamp hover:bg-stamp-wash disabled:opacity-40",
  };
  const sizes: Record<string, string> = {
    md: "h-8 px-2.5",
    lg: "h-10 px-3.5 text-[14px]",
  };
  return (
    <button
      type={type}
      title={title}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border text-[13px] font-medium transition-colors disabled:cursor-not-allowed ${sizes[size]} ${styles[variant]} ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  onClick,
  disabled,
  children,
  className,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-desk hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 ${className ?? ""}`}
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
      className={`flex items-center gap-2 text-[13px] text-ink select-none ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-ink"
      />
      {label}
    </label>
  );
}

/** Small modal dialog. Centred, Escape closes, backdrop click closes. */
export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = "w-80",
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
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/30 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`${width} rounded-xl border border-rule bg-paper p-4 shadow-xl`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[15px] font-semibold text-ink">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X aria-hidden className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="mt-3 space-y-3">{children}</div>
        {footer ? <div className="mt-4 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
