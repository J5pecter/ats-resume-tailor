import * as React from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "info" | "warning" | "error" | "success";

const TONE: Record<Tone, { icon: React.ElementType; className: string }> = {
  info: { icon: Info, className: "border-border bg-muted text-foreground" },
  warning: {
    icon: TriangleAlert,
    className:
      "border-[color-mix(in_oklab,var(--warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] text-foreground",
  },
  error: {
    icon: AlertCircle,
    className:
      "border-[color-mix(in_oklab,var(--destructive)_40%,transparent)] bg-[color-mix(in_oklab,var(--destructive)_9%,transparent)] text-foreground",
  },
  success: {
    icon: CheckCircle2,
    className:
      "border-[color-mix(in_oklab,var(--success)_40%,transparent)] bg-[color-mix(in_oklab,var(--success)_10%,transparent)] text-foreground",
  },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const { icon: Icon, className: toneClass } = TONE[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-lg border p-3.5 text-sm", toneClass, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-medium leading-tight">{title}</p> : null}
        {children ? <div className="text-muted-foreground leading-relaxed">{children}</div> : null}
      </div>
    </div>
  );
}
