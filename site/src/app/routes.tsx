import { createBrowserRouter } from "react-router";
import { Home } from "./pages/Home";
import { Empresas } from "./pages/Empresas";
import { Condominios } from "./pages/Condominios";
import { Produtos } from "./pages/Produtos";
import { Sobre } from "./pages/Sobre";
import { Contato } from "./pages/Contato";
import { Layout } from "./components/Layout";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Home },
      { path: "empresas", Component: Empresas },
      { path: "condominios", Component: Condominios },
      { path: "produtos", Component: Produtos },
      { path: "sobre", Component: Sobre },
      { path: "contato", Component: Contato },
    ],
  },
]);
