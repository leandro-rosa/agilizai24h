"use client";

import {
  Boxes,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Store as StoreIcon,
  Truck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const nav = [
  { title: "Visão geral", href: "/", icon: LayoutDashboard },
  { title: "Vendas", href: "/sales", icon: ShoppingCart },
  { title: "Financeiro", href: "/finance", icon: Wallet },
  { title: "Abastecimento", href: "/supply", icon: Truck },
  { title: "Estoque", href: "/inventory", icon: Boxes },
  { title: "Produtos", href: "/products", icon: Package },
  { title: "Lojas", href: "/stores", icon: StoreIcon },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="brand-gradient flex size-7 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white">
            A
          </span>
          <span className="brand-gradient-text truncate text-base font-semibold group-data-[collapsible=icon]:hidden">
            Agiliz Admin
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Gestão</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => {
                const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                      className="data-[active=true]:border-l-2 data-[active=true]:border-l-primary data-[active=true]:bg-sidebar-accent"
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 py-1.5 text-xs text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
          Dados de demonstração
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
