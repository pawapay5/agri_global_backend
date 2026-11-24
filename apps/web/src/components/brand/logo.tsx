import { cn } from "@/lib/utils";

/** AgriPrice leaf mark + wordmark. The suffix is the country brand (e.g. "GH") from the country pack. */
export function Logo({ suffix, className, compact }: { suffix?: string; className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-bold text-brand", className)}>
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <path d="M16 29C10 22 8 15 12 7c5 4 9 11 4 22Z" fill="#3BB54A" />
        <path d="M16 29c2-9 7-15 14-17-1 9-6 15-14 17Z" fill="#0F5132" />
        <path d="M16 29V14" stroke="#0F5132" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {!compact && (
        <span className="text-lg leading-none">
          AgriPrice{suffix ? <span className="ms-1">{suffix}</span> : null}
        </span>
      )}
    </span>
  );
}
