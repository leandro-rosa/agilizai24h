import type { Metadata } from "next";
import { Geist_Mono, Montserrat } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import { Providers } from "./providers";
import "./globals.css";

// Fonte oficial da marca (manual, prancha 03): Bold títulos, SemiBold
// subtítulos, Regular corpo. O manual declara Inter como alternativa para
// sistemas sem Montserrat — é exatamente o fallback do next/font.
const montserrat = Montserrat({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
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
    <html lang="pt-BR" className={`${montserrat.variable} ${geistMono.variable}`} suppressHydrationWarning>
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
