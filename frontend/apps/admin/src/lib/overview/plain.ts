/**
 * Linguagem simples do resumo executivo: dicionário, valores amigáveis e semáforo. O relatório vai para sócios e equipe que não
 * são de números, então o texto de apresentação troca o vocabulário de finanças pelo do dia a dia SEM mudar nenhum número.
 */
export const PLAIN = {
  /** "Parecido com o normal" = variação de até 3% (valores). PREMISSA inicial, a validar com o dono. */
  SAME_BAND: 0.03,
  /** Idem para taxas (lucro de cada R$ 100 vendidos), em pontos percentuais. */
  SAME_BAND_PP: 1,
} as const;

/** Rótulo simples de cada indicador do topo (o termo técnico fica no glossário e em tooltip). */
export const KPI_PLAIN = {
  revenue: { question: "Quanto vendemos?", title: "Quanto vendemos", technical: "Faturamento", note: "Tudo o que entrou de vendas no mês" },
  contribution: { question: "Quanto sobrou depois de pagar os produtos?", title: "Lucro bruto", technical: "Margem de contribuição", note: "Vendas menos o custo dos produtos vendidos" },
  operating: { question: "Quanto sobrou depois de todas as despesas?", title: "Lucro da operação", technical: "Resultado operacional", note: "Depois de pagar os produtos e todas as despesas" },
  operatingMargin: { question: "De cada R$ 100 vendidos, quanto sobra de lucro?", title: "Lucro de cada R$ 100 vendidos", technical: "Margem operacional", note: "Lucro da operação ÷ faturamento" },
  loss: { question: "Quanto perdemos em produtos?", title: "Produtos perdidos", technical: "Perdas", note: "Valor dos produtos perdidos no mês" },
  cash: { question: "Quanto dinheiro temos no banco?", title: "Dinheiro no banco", technical: "Saldo em caixa", note: "Saldo das contas no último dia do mês" },
} as const;

export interface GlossaryEntry {
  term: string;
  meaning: string;
}

/** Glossário de "Como ler este relatório" (termo → significado em uma frase). */
export const GLOSSARY: GlossaryEntry[] = [
  { term: "Lucro bruto (margem de contribuição)", meaning: "O que sobra das vendas depois de pagar o custo dos produtos vendidos. Ainda não desconta aluguel, pessoal e outras despesas." },
  { term: "Lucro da operação (resultado operacional)", meaning: "O que sobra depois de pagar os produtos e todas as despesas do dia a dia." },
  { term: "Lucro de cada R$ 100 vendidos (margem)", meaning: "Quanto de cada R$ 100 vendidos fica como lucro. Quanto maior, melhor." },
  { term: "Produtos perdidos (perdas)", meaning: "Produtos que não puderam ser vendidos: vencidos, danificados ou perdidos por outro motivo registrado." },
  { term: "Dinheiro no banco (saldo em caixa)", meaning: "O saldo das contas correntes no último dia do mês." },
  { term: "Notas vencidas", meaning: "Notas emitidas aos clientes cujo prazo de pagamento já passou e que ainda não foram marcadas como pagas." },
  { term: "Investimento (CAPEX)", meaning: "Dinheiro gasto em equipamentos e novas lojas, que não é despesa do dia a dia." },
  { term: "Gasto médio por compra (ticket médio)", meaning: "Quanto, em média, cada cliente gasta em uma compra." },
  { term: "Faturamento", meaning: "Tudo o que entrou de vendas no mês." },
  { term: "Melhor, parecido ou pior que o normal", meaning: "Compara o mês com o mês anterior e com a média dos 3 meses antes. Parecido = diferença de até 3%." },
  { term: "Estimativa e observação", meaning: "Estimativa é uma conta aproximada. Observação é o que os números mostram, sem afirmar o motivo." },
];

/** Pontos de cada área; o termo técnico fica só no glossário. */
const REPLACEMENTS: [RegExp, string][] = [
  [/\s*\(DRE\)/g, ""],
  [/(re)?concilia[cç][aã]o incompleta/gi, "contagem de estoque com falhas"],
  [/\ba receita líquida/g, "o faturamento"],
  [/\bda receita líquida/g, "do faturamento"],
  [/\bna receita líquida/g, "no faturamento"],
  [/\bà receita líquida/g, "ao faturamento"],
  [/Margem de contribuição/g, "Lucro bruto"],
  [/margem de contribuição/g, "lucro bruto"],
  [/Resultado operacional/g, "Lucro da operação"],
  [/resultado operacional/g, "lucro da operação"],
  [/Margem operacional/g, "Lucro de cada R$ 100 vendidos"],
  [/margem operacional/g, "lucro de cada R$ 100 vendidos"],
  [/Receita líquida/g, "Faturamento"],
  [/receita líquida/g, "faturamento"],
  [/\bp\.p\./g, "pontos"],
  [/\bCAPEX\b/g, "investimento em equipamentos e lojas"],
  [/\bSKUs\b/g, "produtos"],
  [/\bSKU\b/g, "produto"],
  [/\bconcilia[cç][aã]o\b/gi, "contagem de estoque"],
  [/\bDRE\b/g, "resultado do mês"],
  [/preço realizado/gi, "preço médio cobrado"],
  [/[Tt]icket médio/g, "gasto médio por compra"],
  [/\bvs\.\s/g, "contra "],
];

/** Troca o vocabulário técnico pelo do dia a dia em um texto de apresentação. Idempotente. */
export function plainify(text: string): string {
  return REPLACEMENTS.reduce((acc, [re, to]) => acc.replace(re, to), text);
}

/** "R$ 120 mil", "R$ 4,2 mil", "R$ 950", "R$ 1,2 milhão" — sem centavos e sem 6 dígitos para ler. */
export function friendlyMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "sem dados";
  const v = Math.abs(cents) / 100;
  const sign = cents < 0 ? "−" : "";
  const fmt = (n: number, d: number) => n.toFixed(d).replace(".", ",").replace(/,0$/, "");
  if (v >= 1_000_000) return `${sign}R$ ${fmt(v / 1_000_000, 1)} milhão`.replace("1 milhão", "1 milhão");
  if (v >= 100_000) return `${sign}R$ ${Math.round(v / 1000)} mil`;
  if (v >= 1000) return `${sign}R$ ${fmt(v / 1000, 1)} mil`;
  return `${sign}R$ ${Math.round(v)}`;
}

/** "R$ 3,6 mil a mais" / "R$ 3,6 mil a menos" / "igual". */
export function moreOrLess(deltaCents: number, money: (c: number) => string = friendlyMoney): string {
  if (deltaCents === 0) return "igual";
  return `${money(Math.abs(deltaCents))} ${deltaCents > 0 ? "a mais" : "a menos"}`;
}

export type Light = "better" | "same" | "worse" | "nodata";

export interface TrafficLight {
  tone: Light;
  label: string;
}

const LABELS: Record<Light, string> = { better: "Melhor que o normal", same: "Parecido com o normal", worse: "Pior que o normal", nodata: "Sem dados" };

/**
 * Semáforo: compara com o mês anterior e com a média dos 3 meses antes. Cada comparação cai em melhor / parecido / pior
 * (faixa `band`); `goodWhenUp=false` inverte (perdas subindo é pior). Se as duas discordam (uma melhor, outra pior) o resultado
 * é "parecido" — o mês oscilou, e dizer "melhor" ou "pior" seria escolher uma só. `null` nas duas = sem dados, nunca "parecido".
 */
export function trafficLight(vsPrevious: number | null, vsAvg3: number | null, goodWhenUp: boolean, band: number = PLAIN.SAME_BAND): TrafficLight {
  const read = (v: number | null): Light | null => {
    if (v === null) return null;
    if (Math.abs(v) <= band) return "same";
    return v > 0 === goodWhenUp ? "better" : "worse";
  };
  const a = read(vsPrevious);
  const b = read(vsAvg3);
  let tone: Light;
  if (a === null && b === null) tone = "nodata";
  else if (a === null) tone = b!;
  else if (b === null) tone = a;
  else if (a === b) tone = a;
  else if ((a === "better" && b === "worse") || (a === "worse" && b === "better")) tone = "same";
  else tone = a === "same" ? b : a; // um "parecido" e um com direção: vale a direção
  return { tone, label: LABELS[tone] };
}
