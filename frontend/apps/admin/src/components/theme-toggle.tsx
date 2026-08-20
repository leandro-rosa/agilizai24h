"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";

const OPTIONS = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
] as const;

const FALLBACK = OPTIONS[2];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  // `theme` é undefined no servidor e no primeiro render do cliente — o SO
  // do operador não é conhecido antes de montar. Cair em "Sistema" nesse
  // intervalo faz servidor e cliente concordarem, então não precisa de um
  // flag `mounted` (que só existiria para provocar um segundo render).
  const current = OPTIONS.find((option) => option.value === theme) ?? FALLBACK;
  const Icon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton tooltip="Tema">
          <Icon />
          <span className="truncate">Tema: {current.label}</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-40">
        {OPTIONS.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => setTheme(option.value)}>
            <option.icon />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
