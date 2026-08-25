import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/12 text-primary",
        neutral: "border-border bg-muted text-muted-foreground",
        success: "border-transparent bg-[color-mix(in_oklab,var(--success)_18%,transparent)] text-[var(--success)]",
        warning: "border-transparent bg-[color-mix(in_oklab,var(--warning)_20%,transparent)] text-[var(--warning)]",
        destructive:
          "border-transparent bg-[color-mix(in_oklab,var(--destructive)_16%,transparent)] text-destructive",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
