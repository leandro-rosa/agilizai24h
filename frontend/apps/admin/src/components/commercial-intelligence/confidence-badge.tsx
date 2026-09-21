"use client";

import { Shield, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";

import { StatusBadge, type StatusTone } from "@/components/status-badge";
import type { Level } from "@/lib/commercial-intelligence/types";

/**
 * Text and an icon, never colour alone: the level has to read the same for
 * someone who cannot tell the tones apart.
 */
const LEVELS: Record<Level, { label: string; tone: StatusTone; Icon: typeof Shield }> = {
  high: { label: "Alta", tone: "positive", Icon: ShieldCheck },
  medium: { label: "Média", tone: "attention", Icon: Shield },
  low: { label: "Baixa", tone: "critical", Icon: ShieldAlert },
  insufficient: { label: "Dados insuficientes", tone: "neutral", Icon: ShieldQuestion },
};

export function ConfidenceBadge({ level, className }: { level: Level; className?: string }) {
  const { label, tone, Icon } = LEVELS[level];

  return (
    <StatusBadge tone={tone} className={className}>
      <Icon className="size-3" aria-hidden />
      {level === "insufficient" ? label : `Confiança ${label.toLowerCase()}`}
    </StatusBadge>
  );
}
