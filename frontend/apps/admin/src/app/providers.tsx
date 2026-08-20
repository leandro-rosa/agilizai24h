"use client";

import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { Provider } from "react-redux";

import { makeStore } from "@/lib/store";

export function Providers({ children }: { children: React.ReactNode }) {
  const [store] = useState(() => makeStore());

  return (
    <Provider store={store}>
      {/*
        defaultTheme="system": o padrão é o que o SO do operador pedir, e a
        escolha explícita (quando houver) sobrevive em localStorage.
        disableTransitionOnChange evita cada elemento animar a própria cor no
        instante do toggle, o que pisca a tela inteira.
      */}
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        {children}
      </ThemeProvider>
    </Provider>
  );
}
