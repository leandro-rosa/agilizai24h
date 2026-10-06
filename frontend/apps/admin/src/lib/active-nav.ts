/**
 * O item de menu que corresponde à rota: o MAIS específico. `/purchases/settlements` pertence a "Acerto semanal", não também a
 * "Compras e Fornecedores" (`/purchases`), e `/inventory/central` não acende "Estoque". Compara por segmento, não por prefixo de texto.
 */
export function activeHref(pathname: string, hrefs: string[]): string | null {
  const matches = hrefs.filter((href) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)));
  if (matches.length === 0) return null;

  return matches.reduce((best, href) => (href.length > best.length ? href : best));
}
