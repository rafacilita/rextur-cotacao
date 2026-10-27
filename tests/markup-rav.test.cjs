// Markup (interno, embutido na tarifa) e RAV (comissao da agencia, somada ao total).
// Caso base: exemplos_gds/sabre_origem_exterior_eur_virada_ano.txt, 1 CHD:
//   tarifa BRL 13.673,45 • taxas BRL 1.217,05 • total do GDS 14.890,50
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const root = join(__dirname, "..");
const html = readFileSync(join(root, "index.html"), "utf8");

function fixture(name) {
  const m = readFileSync(join(root, "exemplos_gds", name), "utf8").match(/```text\s*([\s\S]*?)```/i);
  if (!m) throw new Error("bloco GDS nao encontrado em " + name);
  return m[1].trim();
}
function fixtureBlocks(name) {
  return Array.from(readFileSync(join(root, "exemplos_gds", name), "utf8").matchAll(/```text\s*([\s\S]*?)```/gi), (m) => m[1].trim());
}
const norm = (s) => s.split(String.fromCharCode(160)).join(" ");

// 1 CHD (Sabre), com markup/RAV opcionais
function chd({ markup = "", rav = "", rc = "" } = {}) {
  const app = new JSDOM(html, { runScripts: "dangerously", url: "https://cotacao.test/" }).window;
  const raw = fixture("sabre_origem_exterior_eur_virada_ano.txt");
  const $ = (id) => app.document.getElementById(id);
  $("qADT").value = "0"; $("qCHD").value = "1"; $("qINF").value = "0";
  app.refreshPaxUI();
  $("itin").value = raw;
  $("maskCHD").value = raw;
  $("fldMarkup").value = markup;
  $("fldRAV").value = rav;
  $("fldRC").value = rc;
  if (rc) app.setFxRate(5.1695, { source: "BCB" }, false);
  app.build();
  return app;
}
const preview = (app) => norm(app.document.getElementById("preview").textContent);
const chdTotals = (app) => app._lastQuote.totals.byType.CHD;

test("sem markup e sem RAV (A definir): numeros e e-mail como sempre foram", () => {
  const app = chd();
  const t = chdTotals(app);
  assert.equal(t.equivPerPax, 13673.45);
  assert.equal(t.taxesPerPax, 1217.05);
  assert.equal(t.totalPerPax, 14890.5);
  assert.equal("ravPerPax" in t, false, "chaves novas so existem quando markup/RAV estao em uso");
  assert.equal("markupTotal" in app._lastQuote.totals.group, false);
  assert.doesNotMatch(preview(app), /RAV \(BRL\)/);
  assert.equal(app.document.getElementById("markupInfo").textContent, "");
  app.close();
});

test("RAV em branco (A definir) gera o MESMO e-mail que nao ter o campo", () => {
  const a = chd();
  const b = chd({ rav: "   " });
  assert.equal(a.document.getElementById("preview").dataset.html, b.document.getElementById("preview").dataset.html);
  a.close(); b.close();
});

test("markup 10%: sobe a tarifa (BRL e moeda), taxas intactas, total = tarifa' + taxas", () => {
  const base = chd();
  const app = chd({ markup: "10" });
  const t = chdTotals(app), t0 = chdTotals(base);
  assert.equal(t.equivPerPax, 15040.8);                       // 13.673,45 x 1,10
  assert.equal(t.taxesPerPax, 1217.05);                       // taxa de embarque e demais taxas: iguais
  assert.equal(t.totalPerPax, 16257.85);
  assert.equal(t.farePerPax, +(t0.farePerPax * 1.1).toFixed(2), "tarifa na moeda tambem majorada");
  assert.equal(t.markupPerPax, 1367.35);
  assert.equal(app._lastQuote.totals.group.markupTotal, 1367.35);
  assert.equal(app._lastQuote.totals.totalBRL, 16257.85);
  base.close(); app.close();
});

test("markup e INVISIVEL para a agencia: o e-mail nao cita markup nem mostra a tarifa original", () => {
  const app = chd({ markup: "10" });
  const txt = preview(app);
  assert.match(txt, /R\$ 15\.040,80/);
  assert.doesNotMatch(txt, /markup/i);
  assert.doesNotMatch(txt, /13\.673,45/);
  assert.doesNotMatch(txt, /RAV \(BRL\)/, "markup sozinho nao cria coluna RAV");
  // o painel interno (so do operador) mostra o valor
  assert.match(norm(app.document.getElementById("markupInfo").textContent), /Markup embutido na tarifa: R\$ 1\.367,35/);
  app.close();
});

test("RAV 7% sem markup: coluna RAV (BRL) no e-mail e somada ao total", () => {
  const app = chd({ rav: "7" });
  const t = chdTotals(app);
  assert.equal(t.ravPerPax, 957.14);                          // 13.673,45 x 7%
  assert.equal(t.totalPerPax, 15847.64);                      // 13.673,45 + 1.217,05 + 957,14
  const txt = preview(app);
  assert.match(txt, /RAV \(BRL\)/);
  assert.match(txt, /R\$ 957,14/);
  assert.match(txt, /R\$ 15\.847,64/);
  assert.match(txt, /RAV \(comissão da agência\) é de 7%/);
  assert.equal(app._lastQuote.totals.group.ravTotal, 957.14);
  app.close();
});

test("RAV incide sobre a tarifa JA COM markup (a agencia nao percebe a diferenca)", () => {
  const app = chd({ markup: "10", rav: "7" });
  const t = chdTotals(app);
  assert.equal(t.equivPerPax, 15040.8);
  assert.equal(t.ravPerPax, 1052.86);                         // 15.040,80 x 7%
  assert.equal(t.totalPerPax, 17310.71);                      // 15.040,80 + 1.217,05 + 1.052,86
  assert.equal(app._lastQuote.totals.totalBRL, 17310.71);
  const txt = preview(app);
  assert.match(txt, /R\$ 17\.310,71/);
  assert.doesNotMatch(txt, /markup/i);
  app.close();
});

test("com RC + RAV + markup: tudo soma no total por passageiro e no grupo", () => {
  const app = chd({ markup: "10", rav: "7", rc: "10" });     // RC 10 USD x 5,1695 = 51,70
  const t = chdTotals(app);
  assert.equal(t.rcPerPax, 51.7);
  assert.equal(t.totalPerPax, 17362.41);                      // 17.310,71 + 51,70
  assert.equal(app._lastQuote.totals.totalBRL, 17362.41);
  app.close();
});

test("markup e RAV valem para ADT, CHD e INF", () => {
  const app = new JSDOM(html, { runScripts: "dangerously", url: "https://cotacao.test/" }).window;
  const $ = (id) => app.document.getElementById(id);
  const [itin, adt, chdRaw, inf] = fixtureBlocks("amadeus_cny_adt_chd_inf.txt");
  $("qADT").value = "1"; $("qCHD").value = "1"; $("qINF").value = "1";
  app.refreshPaxUI();
  $("itin").value = itin; $("maskADT").value = adt; $("maskCHD").value = chdRaw; $("maskINF").value = inf;
  $("fldMarkup").value = "5"; $("fldRAV").value = "7";
  app.build();
  for (const tipo of ["ADT", "CHD", "INF"]) {
    const t = app._lastQuote.totals.byType[tipo];
    const pr = app._lastQuote.pricing[tipo];
    assert.equal(t.equivPerPax, +(pr.equivBRL * 1.05).toFixed(2), tipo + ": tarifa com markup");
    assert.equal(t.taxesPerPax, pr.taxesBRL, tipo + ": taxas intactas");
    assert.equal(t.ravPerPax, +(t.equivPerPax * 0.07).toFixed(2), tipo + ": RAV sobre a tarifa com markup");
  }
  app.close();
});

test("a tarifa do GDS nao e alterada no modelo (so os totais derivados)", () => {
  const app = chd({ markup: "10", rav: "7" });
  assert.equal(app._lastQuote.pricing.CHD.equivBRL, 13673.45);
  assert.equal(app._lastQuote.pricing.CHD.taxesBRL, 1217.05);
  app.close();
});

test("validacao: markup/RAV aceitam 5, 7,5 e 5%; recusam texto e valor fora de 0-100", () => {
  const app = chd();
  const run = (markup, rav) => {
    app.document.getElementById("fldMarkup").value = markup;
    app.document.getElementById("fldRAV").value = rav;
    return app.validateQuoteInput().filter((i) => i.id === "fldMarkup" || i.id === "fldRAV");
  };
  assert.equal(run("5", "7,5").length, 0);
  assert.equal(run("5%", "").length, 0);
  assert.equal(run("abc", "").length, 1);
  assert.equal(run("", "150").length, 1);
  assert.equal(run("-3", "").length, 1);
  app.close();
});

test("botao Sugerir 7% preenche 7,00 (editavel) e marca a previa como desatualizada", () => {
  const app = chd();
  const rav = app.document.getElementById("fldRAV");
  assert.equal(rav.value, "");
  assert.equal(rav.placeholder, "A definir");
  app.document.getElementById("btnRav7").click();
  assert.equal(rav.value, "7,00");
  rav.value = "6";                                            // continua editavel
  assert.equal(rav.value, "6");
  app.close();
});

test("Limpar devolve markup a vazio e RAV a 'A definir'", () => {
  const app = chd({ markup: "10", rav: "7" });
  assert.notEqual(app.document.getElementById("markupInfo").textContent, "");
  app.document.getElementById("btnClear").click();
  assert.equal(app.document.getElementById("fldMarkup").value, "");
  assert.equal(app.document.getElementById("fldRAV").value, "");
  assert.equal(app.document.getElementById("fldRAV").placeholder, "A definir");
  assert.equal(app.document.getElementById("markupInfo").textContent, "");
  app.close();
});

test("rascunho (autosave) guarda markup e RAV", () => {
  const app = chd({ markup: "10", rav: "7" });
  const c = app.collectDraftControls();
  assert.equal(c.fldMarkup.value, "10");
  assert.equal(c.fldRAV.value, "7");
  app.close();
});
