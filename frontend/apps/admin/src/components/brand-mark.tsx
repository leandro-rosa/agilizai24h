import Image from "next/image";

/**
 * Único lugar que conhece os arquivos do logotipo.
 *
 * `symbol` (gradiente) é o default do chrome porque é o único elemento do
 * kit que funciona sobre creme E sobre carvão — o wordmark entregue existe
 * só em branco, e o kit não tem versão dele para fundo claro (ver a tabela
 * de arquivos em frontend/docs/BRAND.md). A prancha 09 do manual prescreve
 * exatamente o símbolo isolado para espaço pequeno, então isso não é
 * contorno: é o uso previsto.
 *
 * `lockup` só sobre superfície escura. `ink` é o símbolo monocromático,
 * para onde o gradiente não couber.
 *
 * A prancha 05 proíbe recolorir, distorcer e aplicar efeito — por isso
 * `className` aqui serve para posição, nunca para cor ou transform.
 */
const ASSETS = {
  symbol: { src: "/brand/symbol.png", ratio: 1.12 },
  lockup: { src: "/brand/lockup-dark.png", ratio: 3.29 },
  ink: { src: "/brand/symbol-ink.png", ratio: 1.13 },
} as const;

export function BrandMark({
  variant = "symbol",
  height = 28,
  className,
}: {
  variant?: keyof typeof ASSETS;
  height?: number;
  className?: string;
}) {
  const { src, ratio } = ASSETS[variant];

  return (
    <Image
      src={src}
      alt="Agiliz.ai"
      width={Math.round(height * ratio)}
      height={height}
      priority
      className={className}
    />
  );
}
