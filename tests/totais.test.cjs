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

// linha por passageiro x quantidade tem de somar exatamente o total do grupo
const RAW_050 = RAW.replace("BRL14890.50CNN", "BRL14891.00CNN"); // taxas lidas nao fecham com o total por R$ 0,50
test("A3: taxas que nao fecham por centavos => linha usa o total do GDS e linha x qtd = total", () => {
  assert.notEqual(RAW_050, RAW);
  const app = cotacao({ chd: 2, maskCHD: RAW_050 });
  const p = preview(app);
  assert.match(p, /Criança × 2[\s\S]*?R\$ 14\.891,00\s*Total estimado|Criança × 2[\s\S]*?R\$ 14\.891,00/);
  assert.doesNotMatch(p, /R\$ 14\.890,50/);
  assert.match(p, /Total estimado da cotação: R\$ 29\.782,00/);
  app.close();
});

test("A3: com RC a linha tambem e o total do GDS + RC e linha x qtd = total", () => {
  const app = cotacao({ chd: 2, maskCHD: RAW_050, rc: "10" });
  const t = app._lastQuote.totals;
  const linha = t.byType.CHD.totalPerPax;
  assert.equal(+(linha * 2).toFixed(2), t.group.grandTotal);
  const p = preview(app);
  const fmt = (n) => "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.ok(p.includes(fmt(linha)), "linha " + fmt(linha));
  assert.ok(p.includes("Total estimado da cotação: " + fmt(t.group.grandTotal)));
  app.close();
});

test("A3: com RAV a linha tambem e o total do GDS + RAV e linha x qtd = total", () => {
  const app = cotacao({ chd: 2, maskCHD: RAW_050, rav: "5" });
  const t = app._lastQuote.totals;
  const linha = t.byType.CHD.totalPerPax;
  assert.equal(+(linha * 2).toFixed(2), t.group.grandTotal);
  const fmt = (n) => "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.ok(preview(app).includes(fmt(linha)));
  app.close();
});
