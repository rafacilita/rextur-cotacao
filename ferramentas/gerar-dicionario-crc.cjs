#!/usr/bin/env node
/* Gera src/script/61-core-crc-dicionario.js: o dicionario de vocabulario do GDS usado pelo CRC1.
 *
 * ATENCAO -- O DICIONARIO E CONGELADO. Ele e parte do formato do codigo: um CRC1 gerado com um
 * dicionario so abre com o MESMO dicionario, byte a byte. Por isso:
 *   - este script roda UMA vez (feito em 04/11/2026) e o arquivo gerado e commitado;
 *   - NAO rode de novo "para atualizar" (os exemplos em exemplos_gds/ mudam com o tempo);
 *   - tests/crc.test.cjs trava o SHA-256 do dicionario e falha se ele mudar;
 *   - para um dicionario novo, crie um formato novo (prefixo CRC2-) e mantenha o CRC1 legivel.
 *
 * Como e feito: linhas unicas dos exemplos de GDS (as que aparecem em mais exemplos ficam no FIM,
 * mais perto dos dados = codigo mais curto), no formato em que o texto aparece dentro do JSON do
 * CRC, + um esqueleto tipico do proprio JSON no final. Teto de 16 KB (acima disso nao melhora:
 * medido em validacao cruzada, -24%, e no FXR real da Aeromexico, -32%).
 *
 * Uso (so se for mesmo recriar o dicionario):  node ferramentas/gerar-dicionario-crc.cjs --recriar
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

if (!process.argv.includes("--recriar")) {
  console.error("O dicionario do CRC1 e congelado. Leia o cabecalho deste arquivo; para recriar mesmo, use --recriar.");
  process.exit(1);
}

const RAIZ = path.join(__dirname, "..");
const CAP = 16000;
const esc = (s) => JSON.stringify(s).slice(1, -1);     // como o texto aparece dentro do JSON do CRC

// 1) linhas dos exemplos
const dir = path.join(RAIZ, "exemplos_gds");
const df = new Map();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".txt")).sort()) {
  const blocos = Array.from(fs.readFileSync(path.join(dir, f), "utf8").matchAll(/```text\r?\n([\s\S]*?)```/g), (m) => m[1].trim());
  const vistas = new Set(blocos.join("\n\n").split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim().length >= 6));
  for (const l of vistas) df.set(l, (df.get(l) || 0) + 1);
}
const linhas = Array.from(df.entries())
  .sort((a, b) => a[1] - b[1] || b[0].length - a[0].length || (a[0] < b[0] ? -1 : 1))   // desempate deterministico
  .map((e) => esc(e[0]));

// 2) esqueleto tipico do JSON do CRC, tirado do proprio app (ordem real dos campos)
const app = new JSDOM(fs.readFileSync(path.join(RAIZ, "index.html"), "utf8"), { runScripts: "dangerously", url: "https://cotacao.test/" }).window;
const $ = (id) => app.document.getElementById(id);
$("qADT").value = "2"; $("qCHD").value = "1"; $("qINF").value = "1";
$("itin").value = "x"; $("maskADT").value = "y"; $("maskCHD").value = "z"; $("maskINF").value = "w";
$("fldRC").value = "25"; $("fldFX").value = "5,4321"; $("fldLOC").value = "ABC123"; $("fldMarkup").value = "8"; $("fldRAV").value = "7,00";
$("payFaturado").checked = true; $("payCartao").checked = true; $("payParcel").value = "6x"; $("payLink").value = "https://";
$("fldCabine").value = "Executiva"; $("fldCondicao").value = "Incluir a RAV"; $("fldOpenTicket").value = "Sim";
$("fldMultaReembolso").value = "USD 300"; $("fldMultaRemarcacao").value = "USD 150";
const skeleton = JSON.stringify(app.buildCRCPayload({
  controls: app.collectDraftControls(), defaults: app.CRC_DEFAULTS,
  fxMeta: { source: "BCB", baseDate: "2026-11-03", usageDate: "2026-11-04" }, cabineSource: "RBD", cabins: ["Econômica", "Executiva"]
}));
app.close();

// 3) monta: linhas (rarissimas primeiro) + esqueleto no fim; corta as mais raras ate caber no teto
const sep = "\\n";
let corpo = linhas.slice();
// o esqueleto e o proprio JSON do CRC (cru); so as linhas do GDS aparecem escapadas, como dentro de uma string JSON
const tam = () => corpo.join(sep).length + sep.length + skeleton.length;
while (corpo.length && tam() > CAP) corpo.shift();
const dic = corpo.join(sep) + sep + skeleton;

const saida =
`// [61-core-crc-dicionario] Nucleo: dicionario de vocabulario do GDS do CRC1. NAO EDITE.
//
// CONGELADO: faz parte do formato do codigo CRC1. Um CRC1 so abre com este texto exato; mudar um
// caractere quebra a leitura de todo CRC1 ja enviado. tests/crc.test.cjs trava o SHA-256 e falha se
// mudar. Para um dicionario novo, crie o formato CRC2- e continue lendo o CRC1.
// Origem e criterio: ferramentas/gerar-dicionario-crc.cjs (rodado uma unica vez, 04/11/2026).
// So contem vocabulario generico de GDS (cabecalhos, rotulos, formatos); nenhum dado de passageiro real.
const CRC_DICT_V1 = ${JSON.stringify(dic)};
`;
fs.writeFileSync(path.join(RAIZ, "src", "script", "61-core-crc-dicionario.js"), saida.replace(/\r?\n/g, "\r\n"));
console.log("dicionario:", dic.length, "caracteres,", corpo.length, "de", linhas.length, "linhas");
