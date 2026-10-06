import { fold } from "@/lib/catalogue-sync/supplier-review";

/**
 * O nome com que o fornecedor aparece na planilha de precificação. Ao confirmar a revisão da
 * planilha, a grafia dela vira alias do fornecedor; então o alias curto, contido no nome
 * cadastrado ("Marsil" em "Distribuidora Marsil"), é o nome da planilha. Sem ele, vale o próprio nome.
 */
export function supplierLabel(name: string, aliases: string[]): string {
  const full = fold(name);
  const short = aliases
    .filter((alias) => {
      const folded = fold(alias);
      return folded.length >= 3 && folded !== full && full.includes(folded);
    })
    .sort((a, b) => a.length - b.length)[0];

  return short ?? name;
}
