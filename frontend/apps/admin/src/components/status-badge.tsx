import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * `ui/badge.tsx` é reescrito pela CLI do shadcn — variante de marca vive
 * aqui, não lá. Mapeia intenção de domínio para token do tema; nenhuma cor
 * Tailwind solta, para o badge acompanhar claro/escuro sozinho.
 */
const TONES = {
  neutral: "border-transparent bg-secondary text-secondary-foreground",
  positive: "border-success/30 bg-success/15 text-success",
  attention: "border-warning/30 bg-warning/15 text-warning",
  critical: "border-destructive/30 bg-destructive/15 text-destructive",
} as const;

export type StatusTone = keyof typeof TONES;

export function StatusBadge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: StatusTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Badge variant="outline" className={cn(TONES[tone], className)}>
      {children}
    </Badge>
  );
}
