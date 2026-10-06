import { FlaskConical } from "lucide-react";

import { Block } from "./shared";

/**
 * Sem fonte confiável: não existe flag de produto em teste nem data de
 * lançamento de SKU. Mostrar uma lista aqui seria inventar. Estrutura mínima
 * proposta: SKU, data de início, lojas participantes, quantidade inicial e
 * status do teste (não aprovado/reprovado automático).
 */
export function TestsCard() {
  return (
    <Block title="Produtos em teste" icon={<FlaskConical className="size-4 text-primary" />}>
      <p className="text-sm font-medium text-warning">Indisponível — sem cadastro de produto em teste.</p>
      <p className="text-sm text-muted-foreground">
        O sistema não registra quais SKUs entraram em teste, nem a data de início ou as lojas participantes. Para este bloco existir é
        preciso cadastrar: SKU, data de início, lojas participantes, quantidade inicial e status do teste. O sinal (positivo, atenção ou mais dados)
        seria calculado depois, nunca aprovado ou reprovado automaticamente.
      </p>
    </Block>
  );
}
