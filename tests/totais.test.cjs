// Totais da cotacao confiaveis: leitura da linha Sabre, soma sem parcial, linha x qtd = total, arredondamento.
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const root = join(__dirname, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const createApp = () => new JSDOM(html, { runScripts: "dangerously", url: "https://cotacao.test/" }).window;
const norm = (s) => s.split(String.fromCharCode(160)).join(" ");

test("A1: linha Sabre com codigo de passageiro fora da lista le o total inteiro", () => {
  const app = createApp();
  for (const code of ["C06", "C05", "INS", "JCB", "YTH", "SRC", "CNN", "ADT", ""]) {
    const raw = "EUR2315.00      BRL13673.45     1217.05XT        BRL14890.50" + code;
    const p = app.parsePricingSabre(raw);
    assert.equal(p.totalBRL, 14890.5, "codigo " + code);
    assert.equal(p.taxesBRL, 1217.05, "codigo " + code);
  }
  app.close();
});

// ---- helpers de cotacao (fixture Sabre: tarifa 13.673,45 + taxas 1.217,05 = 14.890,50) ----
function fixture(name) {
  const m = readFileSync(join(root, "exemplos_gds", name), "utf8").match(/```text\s*([\s\S]*?)```/i);
  if (!m) throw new Error("bloco GDS nao encontrado em " + name);
  return m[1].trim();
}
const RAW = fixture("sabre_origem_exterior_eur_virada_ano.txt");
function cotacao({ adt = 0, chd = 0, maskADT = null, maskCHD = null, markup = "", rav = "", rc = "" }) {
  const app = createApp();
  const $ = (id) => app.document.getElementById(id);
  $("qADT").value = String(adt); $("qCHD").value = String(chd); $("qINF").value = "0";
  app.refreshPaxUI();
  $("itin").value = RAW;
  if (maskADT) $("maskADT").value = maskADT;
  if (maskCHD) $("maskCHD").value = maskCHD;
  $("fldMarkup").value = markup; $("fldRAV").value = rav; $("fldRC").value = rc;
  if (rc) app.setFxRate(5.1695, { source: "BCB" }, false);
  app.build();
  return app;
}
const preview = (app) => norm(app.document.getElementById("preview").textContent);

test("A2: tipo com quantidade mas sem valores => e-mail nao traz soma parcial e o aviso explica", () => {
  const app = cotacao({ adt: 1, chd: 1, maskADT: RAW });
  assert.doesNotMatch(preview(app), /Total estimado da cotação/);
  const w = app._lastQuote.meta.warnings.join(" | ");
  assert.match(w, /CHD: máscara não informada/);
  assert.match(w, /Total estimado/);
  app.close();
});

test("A2: com todos os tipos preenchidos o total continua aparecendo", () => {
  const app = cotacao({ adt: 1, chd: 1, maskADT: RAW, maskCHD: RAW });
  assert.match(preview(app), /Total estimado da cotação: R\$ 29\.781,00 \(1 adulto, 1 criança\)/);
  app.close();
});
