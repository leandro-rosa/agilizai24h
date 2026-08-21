"use client";

import {
  Banknote,
  Boxes,
  Building2,
  FileText,
  Handshake,
  Landmark,
  LayoutDashboard,
  LogOut,
  Package,
  PiggyBank,
  Receipt,
  Scale,
  ShoppingCart,
  Store as StoreIcon,
  Truck,
  Upload,
  Users,
  Wallet,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
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
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { useGetMeQuery, useLogoutMutation } from "@/lib/api/auth";


/**
 * Navegação agrupada. Vinte itens numa lista plana é inutilizável, e o
 * agrupamento é o que separa "o que a loja fez" de "o que a empresa deve".
 *
 * `permission` é cortesia de UX — o gateway continua sendo a fronteira e
 * pode devolver 403 mesmo para um item que ficou visível.
 */
export interface NavItem {
  title: string;
  href: string;
  icon: typeof LayoutDashboard;
  permission?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    label: "Operação",
    items: [
      { title: "Visão geral", href: "/", icon: LayoutDashboard },
      { title: "Vendas", href: "/sales", icon: ShoppingCart, permission: "sales:read" },
      { title: "Abastecimento", href: "/supply", icon: Truck, permission: "supply:read" },
      { title: "Estoque", href: "/inventory", icon: Boxes, permission: "inventory:read" },
      { title: "Estoque central", href: "/inventory/central", icon: Warehouse, permission: "inventory:read" },
    ],
  },
  {
    label: "Financeiro",
    items: [
      { title: "Reconciliação", href: "/finance", icon: Wallet, permission: "finance:read" },
      { title: "DRE", href: "/finance/pnl", icon: Scale, permission: "accounting:read" },
      { title: "Fluxo de caixa", href: "/finance/cash-flow", icon: Banknote, permission: "accounting:read" },
    ],
  },
  {
    label: "Tesouraria",
    items: [
      { title: "Lançamentos", href: "/treasury", icon: Landmark, permission: "treasury:read" },
      { title: "De-para", href: "/treasury/mappings", icon: Handshake, permission: "treasury:read" },
    ],
  },
  {
    label: "Comercial",
    items: [
      { title: "Clientes", href: "/billing/clients", icon: Building2, permission: "billing:read" },
      { title: "Contratos", href: "/billing/contracts", icon: FileText, permission: "billing:read" },
      { title: "Notas fiscais", href: "/billing/invoices", icon: Receipt, permission: "billing:read" },
    ],
  },
  {
    label: "Investimento",
    items: [
      { title: "CAPEX por loja", href: "/capex", icon: PiggyBank, permission: "capex:read" },
      { title: "Investidores", href: "/capex/investors", icon: Users, permission: "capex:read" },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { title: "Produtos", href: "/products", icon: Package, permission: "products:read" },
      { title: "Lojas", href: "/stores", icon: StoreIcon, permission: "stores:read" },
      { title: "Fornecedores", href: "/suppliers", icon: Handshake, permission: "suppliers:read" },
    ],
  },
  {
    label: "Sistema",
    items: [{ title: "Ingestão", href: "/ingestion", icon: Upload, permission: "ingestion:read" }],
  },
];

/** Lista plana, para o breadcrumb resolver o rótulo do caminho atual. */
export const nav: NavItem[] = navGroups.flatMap((group) => group.items);

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: caller } = useGetMeQuery();

  /*
   * Permissão resolvida em lote, não por um hook dentro do `.map()`: assim
   * o grupo inteiro some quando nenhum item dele é visível. Um cabeçalho
   * "Tesouraria" sem nada embaixo é ruído — e é o que aparecia para quem
   * não tinha as permissões de back-office.
   */
  const granted = caller?.permissions;
  const visibleGroups = useMemo(() => {
    const allows = (permission?: string) => permission === undefined || (granted?.includes(permission) ?? false);

    return navGroups
      .map((group) => ({ ...group, items: group.items.filter((item) => allows(item.permission)) }))
      .filter((group) => group.items.length > 0);
  }, [granted]);
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
          <BrandMark variant="symbol" height={26} className="shrink-0" />
          {/*
            "Agiliz Admin" é o nome da ferramenta, não o logotipo — por isso
            vai em --foreground chapado, sem gradiente. O logotipo é o
            símbolo à esquerda, e a prancha 05 proíbe substituí-lo por
            lettering solto (era o que a letra "A" em caixa fazia aqui).
          */}
          <span className="truncate text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Agiliz Admin
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
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
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeToggle />
          </SidebarMenuItem>
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
