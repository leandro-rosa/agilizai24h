"use client";

import {
  Boxes,
  LayoutDashboard,
  LogOut,
  Package,
  ShoppingCart,
  Store as StoreIcon,
  Truck,
  Upload,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useGetMeQuery, useLogoutMutation } from "@/lib/api/auth";

const nav = [
  { title: "Visão geral", href: "/", icon: LayoutDashboard },
  { title: "Vendas", href: "/sales", icon: ShoppingCart },
  { title: "Financeiro", href: "/finance", icon: Wallet },
  { title: "Abastecimento", href: "/supply", icon: Truck },
  { title: "Estoque", href: "/inventory", icon: Boxes },
  { title: "Produtos", href: "/products", icon: Package },
  { title: "Lojas", href: "/stores", icon: StoreIcon },
  { title: "Ingestão", href: "/ingestion", icon: Upload },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: caller } = useGetMeQuery();
  const [logout] = useLogoutMutation();

  async function handleLogout() {
    // Clears the cookie through the gateway first — a local-only "logout"
    // would leave the session still valid server-side.
    await logout().catch(() => {
      // Best-effort: if the gateway is unreachable the cookie may still be
      // valid, but there is nothing more the panel can do from here except
      // still send the operator to login.
    });
    router.push("/login");
  }

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
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton tooltip={caller?.name ?? "Conta"}>
                  <LogOut />
                  <span className="truncate">{caller?.name ?? "Conta"}</span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="min-w-56">
                <DropdownMenuItem onSelect={handleLogout}>
                  <LogOut />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
