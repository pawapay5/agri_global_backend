import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-brand text-brand-fg hover:opacity-90",
        outline: "border border-brand text-brand bg-transparent hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        subtle: "bg-muted text-foreground hover:bg-border",
        danger: "border border-down text-down hover:bg-down/10",
      },
      size: { sm: "h-8 px-3", md: "h-10 px-4", lg: "h-12 px-6 text-base", icon: "h-10 w-10" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({ className, variant, size, asChild, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-xl border border-border bg-card p-4 shadow-sm", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 className={cn("text-base font-semibold", className)} {...props} />;
}

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(function Input({ className, ...props }, ref) {
  return (
    <input ref={ref} className={cn("h-11 w-full rounded-xl border border-border bg-background px-3 text-sm placeholder:text-muted-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-down", className)} {...props} />
  );
});

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium", className)} {...props} />;
}

export function Badge({ className, tone = "neutral", ...props }: React.ComponentProps<"span"> & { tone?: "neutral" | "brand" | "up" | "down" | "forecast" }) {
  const tones = { neutral: "bg-muted text-muted-fg", brand: "bg-leaf/15 text-brand", up: "bg-up/10 text-up-ink", down: "bg-down/10 text-down-ink", forecast: "bg-forecast/15 text-forecast-ink" };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone], className)} {...props} />;
}

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-muted", className)} {...props} />;
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  return children ? <p role="alert" className="text-xs text-down">{children}</p> : null;
}
