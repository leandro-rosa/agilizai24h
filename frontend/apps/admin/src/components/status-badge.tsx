import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * `ui/badge.tsx` é reescrito pela CLI do shadcn — variante de marca vive
 * aqui, não lá. Mapeia intenção de domínio para token do tema; nenhuma cor
 * Tailwind solta, para o badge acompanhar claro/escuro sozinho.
 */
/*
 * O wash é 12%, não 15%: ele clareia o fundo em direção ao próprio texto, e
 * a 15% os três tons caem abaixo de 4,5:1 em texto de 12px. 12% é o maior
 * valor que passa sobre `--card` e sobre `--background` nos dois temas —
 * `pnpm contrast` cobre os dois pares.
 */
const TONES = {
  neutral: "border-transparent bg-secondary text-secondary-foreground",
  positive: "border-success/30 bg-success/12 text-success",
  attention: "border-warning/30 bg-warning/12 text-warning",
  critical: "border-destructive/30 bg-destructive/12 text-destructive",
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
