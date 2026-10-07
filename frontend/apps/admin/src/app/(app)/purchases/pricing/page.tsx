import { redirect } from "next/navigation";

/**
 * A Precificação agora é uma aba de "Produtos e Precificação". O endereço antigo continua valendo: leva à aba, e `?sku=` segue abrindo o produto
 * (links guardados, e-mails e telas antigas não quebram).
 */
export default async function PricingRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sku } = await searchParams;
  redirect(`/products?view=pricing${typeof sku === "string" && sku ? `&sku=${encodeURIComponent(sku)}` : ""}`);
}
