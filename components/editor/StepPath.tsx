"use client";

import { Fragment } from "react";

import { Check } from "lucide-react";

import { STEP_LABELS, STEP_ORDER, nextStep, type StepId } from "@/lib/client/steps";

/**
 * A guide, never a gate: every step is always clickable, in any order, and a
 * step only shows as done when the document itself says so.
 */
export default function StepPath({
  done,
  current,
  onSelect,
}: {
  done: Record<StepId, boolean>;
  current: StepId;
  onSelect: (step: StepId) => void;
}) {
  const next = nextStep(current);
  return (
    <nav
      aria-label="Steps"
      className="flex flex-wrap items-center gap-1 border-b border-rule bg-paper px-3 py-1"
    >
      {STEP_ORDER.map((step, i) => {
        const isCurrent = step === current;
        const isDone = done[step];
        return (
          <Fragment key={step}>
            {i > 0 ? (
              <span aria-hidden className="px-1 text-[12px] text-ink-faint">
                →
              </span>
            ) : null}
            <button
              type="button"
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => onSelect(step)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                const dir = e.key === "ArrowRight" ? 1 : -1;
                const next =
                  STEP_ORDER[(i + dir + STEP_ORDER.length) % STEP_ORDER.length];
                onSelect(next);
                // Keep focus on the selected step so arrows read like a tab strip.
                const buttons = e.currentTarget.parentElement?.querySelectorAll(
                  "button",
                );
                const target = buttons?.[STEP_ORDER.indexOf(next)];
                (target as HTMLElement | undefined)?.focus();
              }}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
                isCurrent
                  ? "bg-ink text-paper"
                  : isDone
                    ? "text-ledger hover:bg-ledger-wash"
                    : "text-ink-soft hover:bg-desk hover:text-ink"
              }`}
            >
              <span
                aria-hidden
                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[12px] ${
                  isCurrent
                    ? "border-paper/50 text-paper"
                    : isDone
                      ? "border-ledger text-ledger"
                      : "border-rule text-ink-faint"
                }`}
              >
                {isDone ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span>{STEP_LABELS[step]}</span>
              {isDone ? <span className="sr-only"> (done)</span> : null}
            </button>
          </Fragment>
        );
      })}
      {next ? (
        <button
          type="button"
          aria-label="Next step"
          onClick={() => onSelect(next)}
          className="ml-auto flex items-center gap-1 rounded-md border border-rule px-2 py-1 text-[12px] font-medium text-ink-soft transition-colors hover:bg-desk hover:text-ink"
        >
          Next: {STEP_LABELS[next]}
        </button>
      ) : null}
    </nav>
  );
}
