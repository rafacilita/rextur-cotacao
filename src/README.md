# src/ — fonte do index.html

`index.html` é **gerado**. Edite aqui e rode `node ferramentas/build.cjs`
(`--check` confere se o `index.html` está em dia com `src/`).

## Layout

- `head.html`, `body.html`, `foot.html` — estrutura e CSS.
- `script/10..60-core-*.js` — **núcleo**: parsing, QuoteModel, regras, e-mail. Nunca toca
  DOM, `window` ou `localStorage`. Provado por `tests/core-sem-dom.test.cjs` (carrega só
  esses arquivos numa `vm` sem navegador).
- `script/70..78-ui-*.js` — **interface**: leitura/escrita do DOM, rascunho, câmbio BCB,
  `build()` e fiação de eventos.

Os arquivos **não são módulos ES**: são recortes de texto concatenados na ordem do
`manifest.json`. `function` é hoisted; `const`/`let` e código de carga executam na ordem
— por isso o núcleo vem antes da UI e a ordem do manifest faz parte do contrato.

## Regras

1. Núcleo não referencia nada da UI (`$`, `setStatus`, estado de tela).
2. Coisa nova de cálculo/parsing vai para o núcleo; leitura/escrita de campo vai para a UI.
3. Antes de commitar: `node ferramentas/build.cjs && npm test`.
4. Mudança de organização (mover código): comparar com a versão anterior via
   `node ferramentas/fingerprint.cjs --comparar <antes.html> index.html`.
