/* eslint-disable no-console -- CLI: relatorio no stdout e o proposito. */
// WCAG tem dois limiares e eles nao sao intercambiaveis:
//   1.4.3  texto normal        -> 4.5:1
//   1.4.11 componente/nao-texto -> 3.0:1  (preenchimento de botao, borda, icone)
const lum = (h) => {
  const c = [1,3,5].map(i => parseInt(h.slice(i,i+2),16)/255)
    .map(v => v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4);
  return 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
};
const ratio = (a,b) => { const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);
  return (x+0.05)/(y+0.05); };
const TEXT = 4.5, UI = 3.0;
const pairs = [
  ['texto', TEXT, 'claro: foreground/background',   '#1f1f1f', '#fff4e6'],
  ['texto', TEXT, 'claro: rótulo sobre primary',    '#fff4e6', '#8e1d4d'],
  ['texto', TEXT, 'claro: muted-fg/background',     '#6b5b52', '#fff4e6'],
  // Tom semantico aparece sobre card E sobre background; a superficie mais
  // dificil no claro e o creme, no escuro e o card. Testar so uma das duas
  // foi como esses tres passaram reprovando na pratica.
  ['texto', TEXT, 'claro: destructive/card',        '#c70500', '#ffffff'],
  ['texto', TEXT, 'claro: destructive/background',  '#c70500', '#fff4e6'],
  ['texto', TEXT, 'claro: warning/card',            '#9b5209', '#ffffff'],
  ['texto', TEXT, 'claro: warning/background',      '#9b5209', '#fff4e6'],
  ['texto', TEXT, 'claro: success/card',            '#1d7349', '#ffffff'],
  ['texto', TEXT, 'claro: success/background',      '#1d7349', '#fff4e6'],
  ['ui',    UI,   'claro: primary/background',      '#8e1d4d', '#fff4e6'],
  // Borda decorativa (divisoria, borda de card) NAO cai na 1.4.11 — ela nao
  // e o que identifica um controle. O que cai: anel de foco e borda de campo.
  ['ui',    UI,   'claro: ring/background',         '#8e1d4d', '#fff4e6'],
  ['ui',    UI,   'claro: input/card',              '#b08f6b', '#ffffff'],
  ['texto', TEXT, 'escuro: foreground/background',  '#fff4e6', '#1f1f1f'],
  ['texto', TEXT, 'escuro: rótulo sobre primary',   '#0d0d0d', '#e91e8c'],
  ['texto', TEXT, 'escuro: muted-fg/background',    '#a89e97', '#1f1f1f'],
  ['texto', TEXT, 'escuro: destructive/card',       '#ff736a', '#2a2a2a'],
  ['texto', TEXT, 'escuro: destructive/background', '#ff736a', '#1f1f1f'],
  ['texto', TEXT, 'escuro: warning/card',           '#e89b3c', '#2a2a2a'],
  ['texto', TEXT, 'escuro: warning/background',     '#e89b3c', '#1f1f1f'],
  ['texto', TEXT, 'escuro: success/card',           '#3fbf83', '#2a2a2a'],
  ['texto', TEXT, 'escuro: success/background',     '#3fbf83', '#1f1f1f'],
  ['texto', TEXT, 'escuro: accent-fg/background',   '#f7c9e0', '#1f1f1f'],
  ['ui',    UI,   'escuro: primary/background',     '#e91e8c', '#1f1f1f'],
  ['ui',    UI,   'escuro: primary/card',           '#e91e8c', '#2a2a2a'],
  ['ui',    UI,   'escuro: ring/background',        '#e91e8c', '#1f1f1f'],
  ['ui',    UI,   'escuro: input/card',             '#737373', '#2a2a2a'],
];
let bad = 0;
for (const [kind, min, name, fg, bg] of pairs) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${r.toFixed(2).padStart(5)}:1  (min ${min}, ${kind})  ${name}`);
}
console.log(bad ? `\n${bad} REPROVACAO(OES)` : '\nTodos passam.');
process.exit(bad ? 1 : 0);
