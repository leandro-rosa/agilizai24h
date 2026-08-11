import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";

import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agiliz Admin",
  description: "Painel de gestão do Agiliz.AI — vendas, financeiro, abastecimento, estoque, produtos e lojas.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`dark ${inter.variable} ${geistMono.variable}`}>
      <body className="antialiased">
        <Providers>
          <TooltipProvider>
            <SidebarProvider>
              <AppSidebar />
              <SidebarInset>
                <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
                  <SidebarTrigger className="-ml-1" />
                  <Separator orientation="vertical" className="mr-2 h-4" />
                  <span className="text-sm font-medium text-muted-foreground">
                    Agiliz Admin
                  </span>
                </header>
                <main className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
                  {children}
                </main>
              </SidebarInset>
            </SidebarProvider>
            <Toaster />
          </TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}
