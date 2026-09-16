import Image from "next/image";

/**
 * Único lugar que conhece os arquivos do logotipo.
 *
 * `symbol` (gradiente) é o único elemento do kit que funciona sobre creme E
 * sobre carvão neutros — a prancha 09 do manual prescreve exatamente o
 * símbolo isolado para espaço pequeno. Mas o gradiente magenta/roxo some
 * contra uma superfície que já É magenta/roxo (`.brand-sidebar`,
 * `.brand-surface`): ali quem entra é `symbol-white`, um recorte próprio
 * (`public/brand/symbol-white.png`, gerado de `symbol-ink.png` recolorindo
 * o silhueta preta para branco, alpha preservado — sem arquivo assim no kit
 * entregue) reproduzindo o símbolo sólido branco que a própria contracapa
 * do manual usa sobre o gradiente.
 *
 * `lockup` (símbolo em gradiente + wordmark branco, um PNG só) segue só
 * para onde ele já foi pensado: superfície escura sólida, não gradiente —
 * o wordmark dele não existe separado, então não dá pra reaproveitar só a
 * parte branca sobre outro fundo. `ink` é o símbolo monocromático carvão,
 * para onde nem o gradiente nem o branco cabem (fundo claro sólido).
 *
 * A prancha 05 proíbe distorcer e aplicar efeito — por isso `className`
 * aqui serve para posição, nunca para transform. `symbol-white` já é, em
 * si, uma recoloração deliberada (não a marca "sendo alterada" pela app —
 * é o próprio uso que a prancha 07/capas do manual prescrevem sobre fundo
 * de cor), então não se aplica a mesma regra de cor às outras variantes.
 */
const ASSETS = {
  symbol: { src: "/brand/symbol.png", ratio: 1.12 },
  "symbol-white": { src: "/brand/symbol-white.png", ratio: 1.13 },
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
