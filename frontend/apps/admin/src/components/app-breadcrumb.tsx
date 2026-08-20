"use client";

import { usePathname } from "next/navigation";

import { nav } from "@/components/app-sidebar";

/**
 * Deriva o rótulo do `nav` exportado pela sidebar em vez de manter uma
 * segunda tabela de títulos — duas listas divergem no primeiro item novo.
 */
export function AppBreadcrumb() {
  const pathname = usePathname();
  const match = nav.find((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );

  return <span className="text-sm font-semibold">{match?.title ?? "Agiliz Admin"}</span>;
}
