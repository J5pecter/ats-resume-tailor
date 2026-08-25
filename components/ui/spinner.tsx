import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} aria-hidden />;
}

export function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}
