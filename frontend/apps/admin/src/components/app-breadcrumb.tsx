"use client";

import { usePathname } from "next/navigation";

import { activeHref } from "@/lib/active-nav";
import { nav } from "@/components/app-sidebar";

/**
 * Deriva o rótulo do `nav` exportado pela sidebar em vez de manter uma
 * segunda tabela de títulos — duas listas divergem no primeiro item novo.
 */
export function AppBreadcrumb() {
  const pathname = usePathname();
  const current = activeHref(pathname, nav.map((item) => item.href));
  const match = nav.find((item) => item.href === current);

  return <span className="text-sm font-semibold">{match?.title ?? "Agiliz Admin"}</span>;
}
