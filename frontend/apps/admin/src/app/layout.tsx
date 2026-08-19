import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";

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

/**
 * Global chrome only — no sidebar here. `/login` and the `(app)` route
 * group need different shells (a centered card vs. the sidebar layout), and
 * both still need Redux, tooltips and toasts.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`dark ${inter.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <Providers>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}
