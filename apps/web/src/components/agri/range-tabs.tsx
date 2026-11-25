"use client";
import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * Segmented single choice (ranges 1M/3M/6M/1Y, chart/table, tabs). WAI-ARIA radiogroup with a roving tabindex:
 * Tab enters on the selected option, arrows move and select, Home/End jump. Arrow direction follows RTL.
 */
export function RangeTabs<T extends string>({ value, options, onChange, label, size = "md", className }: {
  value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; label: string; size?: "sm" | "md"; className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const move = (i: number) => {
    const n = (i + options.length) % options.length;
    onChange(options[n]!.value);
    refs.current[n]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const fwd = rtl ? "ArrowLeft" : "ArrowRight", back = rtl ? "ArrowRight" : "ArrowLeft";
    if (e.key === fwd || e.key === "ArrowDown") { e.preventDefault(); move(idx + 1); }
    else if (e.key === back || e.key === "ArrowUp") { e.preventDefault(); move(idx - 1); }
    else if (e.key === "Home") { e.preventDefault(); move(0); }
    else if (e.key === "End") { e.preventDefault(); move(options.length - 1); }
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKey} className={cn("inline-flex rounded-xl bg-muted p-1", className)}>
      {options.map((o, i) => (
        <button
          key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio"
          aria-checked={i === idx} tabIndex={i === idx ? 0 : -1} onClick={() => onChange(o.value)}
          className={cn("rounded-lg font-medium transition-colors", size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
            i === idx ? "bg-card text-foreground shadow-sm" : "text-muted-fg hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
