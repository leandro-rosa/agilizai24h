/**
 * UUID v4 para chaves de idempotência. `crypto.randomUUID` só existe em contexto seguro (https ou localhost):
 * o painel aberto por http://agilizai.local derrubava a tela com "randomUUID is not a function".
 * `getRandomValues` funciona em qualquer contexto.
 */
export function newUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
