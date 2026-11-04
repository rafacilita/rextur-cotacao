// CRC (Codigo de Registro da Cotacao): o estado da tela vai no rodape do e-mail e, colado
// de volta numa calculadora qualquer, reabre a MESMA cotacao -- inclusive o markup.
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const root = join(__dirname, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const fixtures = readdirSync(join(root, "exemplos_gds")).filter((f) => f.endsWith(".txt"));
function blocos(nome) {
  const c = readFileSync(join(root, "exemplos_gds", nome), "utf8");
  return Array.from(c.matchAll(/```text\s*([\s\S]*?)```/gi), (m) => m[1].trim());
}

function novoApp() {
  return new JSDOM(html, { runScripts: "dangerously", url: "https://cotacao.test/" }).window;
}
const $ = (app, id) => app.document.getElementById(id);
const previewHtml = (app) => $(app, "preview").dataset.html || "";
const previewText = (app) => $(app, "preview").textContent || "";

// Monta uma cotacao como o atendente faz: itinerario + mascaras coladas juntas, valores,
// markup, RAV e pagamento, com as cabines confirmadas (o popup nao roda no jsdom).
function cotar(raw, extra = {}) {
  const app = novoApp();
  $(app, "itin").value = raw;
  $(app, "maskAll").value = raw;
  app.applyCombinedPricingInput({ overwrite: true, announce: false });
  // bloco sem contagem de passageiros: 1 de cada tipo que tem mascara (o atendente acertaria a quantidade)
  for (const t of ["ADT", "CHD", "INF"]) {
    const q = $(app, "q" + t);
    if ($(app, "mask" + t).value.trim() && !(+q.value)) q.value = "1";
    else if (!$(app, "mask" + t).value.trim() && t === "ADT" && ($(app, "maskCHD").value.trim() || $(app, "maskINF").value.trim())) q.value = "0";
  }
  app.refreshPaxUI();
  $(app, "fldMarkup").value = extra.markup ?? "8";
  $(app, "fldRAV").value = extra.rav ?? "7,00";
  $(app, "fldRC").value = extra.rc ?? "25";
  if (!$(app, "fldFX").value.trim()) app.setFxRate(5.4321, { source: "BCB", baseDate: "2026-11-03", usageDate: "2026-11-04" }, false);
  $(app, "fldLOC").value = extra.loc ?? "XYZ789";
  $(app, "payCartao").checked = true;
  $(app, "payParcel").value = "6x";
  if (extra.nomes) {
    $(app, "chkNomes").checked = true;
    app.refreshOptionalUI(); app.refreshPaxUI();
    extra.nomes.forEach(([id, v]) => { $(app, id).value = v; });
  }
  app.eval(`(function(){
    const t = $("itin").value;
    const segs = parseItinerary(t, detectGDSFromItin(t), inferYearFromText(t)).filter(s => s && !s.surface);
    cabinConfirmState = { itinText: t, cabins: segs.map((s, i) => i % 2 ? "Executiva" : (cabinePorRBD(s.rbd) || "Econômica")) };
  })()`);
  app.build();
  return app;
}
const crcDe = (app) => (previewText(app).match(/CRC1-[A-Za-z0-9+\-$]+/) || [null])[0];
const telaDe = (app) => JSON.parse(JSON.stringify(app.collectDraftControls()));
const fxDe = (app) => JSON.parse(JSON.stringify(app.readFxMeta()));

function carregar(texto, app = novoApp()) {
  $(app, "crcInput").value = texto;
  $(app, "btnLoadCRC").click();
  return app;
}

const comparados = [];
for (const nome of fixtures) {
  const bs = blocos(nome);
  if (!bs.length) continue;
  test(`ida e volta pelo e-mail: ${nome}`, () => {
    const a = cotar(bs.join("\n\n"));
    const code = crcDe(a);
    assert.ok(code, "o e-mail tem o CRC no rodape");
    // colar o TEXTO do e-mail inteiro, como vem de uma resposta da agencia
    const b = carregar("Prezados, de acordo.\n\n" + previewText(a));
    assert.equal($(b, "crcMsg").classList.contains("warn"), false, $(b, "crcMsg").textContent);
    const ta = telaDe(a); delete ta.maskAll;
    const tb = telaDe(b); delete tb.maskAll;
    assert.deepEqual(tb, ta, "a tela reaberta e a mesma");
    assert.deepEqual(fxDe(b), fxDe(a), "cambio com a mesma origem e datas");
    assert.equal($(b, "fldMarkup").value, "8");
    comparados.push([nome, !!previewHtml(b), a._lastQuote.totals.totalBRL]);
    if (previewHtml(b)) {
      assert.equal(previewHtml(b), previewHtml(a), "o e-mail refeito e identico (inclusive o proprio CRC)");
      assert.deepEqual(JSON.parse(JSON.stringify(b._lastQuote.totals)), JSON.parse(JSON.stringify(a._lastQuote.totals)));
    }
    a.close(); b.close();
  });
}

test("a ida e volta comparou o e-mail refeito na maioria dos exemplos", () => {
  const comE = comparados.filter((c) => c[1]);
  console.log("e-mail comparado em", comE.length, "de", comparados.length, "| sem previa:", comparados.filter((c) => !c[1]).map((c) => c[0]).join(", "));
  assert.ok(comE.length >= comparados.length - 3, "poucos exemplos ficaram sem previa");
  assert.ok(comE.filter((c) => c[2] > 0).length >= 10, "e com valores calculados");
});

test("markup volta e aparece na mensagem de quem reabre (objetivo: conferir a rentabilizacao)", () => {
  const raw = blocos("sabre_origem_exterior_eur_virada_ano.txt").join("\n\n");
  const a = cotar(raw, { markup: "10" });
  assert.match($(a, "markupInfo").textContent, /Markup embutido/);
  assert.doesNotMatch(previewText(a).replace(/CRC1-\S+/, ""), /markup/i, "fora o codigo, o e-mail continua sem citar markup");
  const b = carregar(crcDe(a));
  assert.equal($(b, "fldMarkup").value, "10");
  assert.equal($(b, "markupInfo").textContent, $(a, "markupInfo").textContent);
  assert.match($(b, "crcMsg").textContent, /Markup: 10%/);
  assert.match($(b, "crcMsg").textContent, /LOC XYZ789/);

  const semMk = cotar(raw, { markup: "" });
  const c = carregar(crcDe(semMk));
  assert.match($(c, "crcMsg").textContent, /Sem markup/);
  [a, b, semMk, c].forEach((w) => w.close());
});

test("nomes dos passageiros voltam; nome que estava na tela e nao veio no codigo e apagado", () => {
  const raw = blocos("sabre_origem_exterior_eur_virada_ano.txt").join("\n\n");
  const a = cotar(raw, { nomes: [["name_CHD_1", "TESTE/ANA MISS"]] });
  const b = novoApp();
  $(b, "qADT").value = "2"; $(b, "chkNomes").checked = true;
  b.refreshOptionalUI(); b.refreshPaxUI();
  $(b, "name_ADT_1").value = "OUTRO/CLIENTE MR";
  carregar(crcDe(a), b);
  assert.equal($(b, "chkNomes").checked, true);
  assert.equal($(b, "name_CHD_1").value, "TESTE/ANA MISS");
  assert.equal($(b, "name_ADT_1") ? $(b, "name_ADT_1").value : "", "");
  a.close(); b.close();
});

test("tela suja antes de carregar: o que nao veio no CRC volta ao padrao", () => {
  const raw = blocos("amadeus_tarifa_fxp.txt").join("\n\n");
  const a = cotar(raw, { rc: "" });
  const b = novoApp();
  $(b, "fldMultaReembolso").value = "USD 300";
  $(b, "payDeposito").checked = true;
  $(b, "fldRC").value = "40";
  carregar(crcDe(a), b);
  assert.equal($(b, "fldMultaReembolso").value, "");
  assert.equal($(b, "payDeposito").checked, false);
  assert.equal($(b, "fldRC").value, "");
  a.close(); b.close();
});

test("codigo quebrado em linhas e com '>' de citacao ainda e lido", () => {
  const raw = blocos("sabre_tarifa_xt.txt").join("\n\n");
  const a = cotar(raw);
  const code = crcDe(a);
  const quebrado = code.match(/.{1,60}/g).map((l) => "> " + l).join("\n");
  const b = carregar("> Em 04/11, Fulano escreveu:\n" + quebrado + "\n> \n> Atenciosamente");
  assert.equal(b.document.getElementById("fldLOC").value, "XYZ789");
  assert.equal(previewHtml(b), previewHtml(a));
  a.close(); b.close();
});

test("erros: CRR da Reemissao, codigo cortado e texto sem codigo nao mexem na tela", () => {
  const raw = blocos("sabre_tarifa_xt.txt").join("\n\n");
  const a = cotar(raw);
  const code = crcDe(a);
  const casos = [
    ["CRR4-N4IgLglmA2CmIC4QGEDyBZEAaEAjA", /CRR da Reemissão/],
    [code.slice(0, Math.floor(code.length / 2)), /incompleto ou danificado/],
    ["Prezados, segue o aceite.", /Nenhum código CRC/],
    ["   ", /Cole o e-mail/]
  ];
  for (const [texto, re] of casos) {
    const b = novoApp();
    $(b, "fldLOC").value = "MANTER";
    carregar(texto, b);
    assert.match($(b, "crcMsg").textContent, re);
    assert.equal($(b, "crcMsg").classList.contains("warn"), true);
    assert.equal($(b, "fldLOC").value, "MANTER", "tela intacta");
    b.close();
  }
  a.close();
});

test("a caixa do CRC nao entra no rascunho, no proprio CRC, nem marca a previa como desatualizada", () => {
  const raw = blocos("sabre_tarifa_xt.txt").join("\n\n");
  const a = cotar(raw);
  assert.equal("crcInput" in a.collectDraftControls(), false);
  const antes = previewHtml(a);
  const el = $(a, "crcInput");
  el.value = "qualquer coisa";
  el.dispatchEvent(new a.Event("input", { bubbles: true }));
  assert.equal(a.eval("previewDirty"), false);
  a.build();
  assert.equal(previewHtml(a), antes, "texto na caixa do CRC nao muda o codigo");
  a.close();
});

test("Limpar esvazia a caixa e a mensagem do CRC", () => {
  const a = cotar(blocos("sabre_tarifa_xt.txt").join("\n\n"));
  $(a, "crcInput").value = "x";
  $(a, "crcMsg").textContent = "y";
  $(a, "btnClear").click();
  assert.equal($(a, "crcInput").value, "");
  assert.equal($(a, "crcMsg").textContent, "");
  a.close();
});

test("campos so com espacos nao mudam o codigo (RAV '   ' = A definir)", () => {
  const raw = blocos("sabre_tarifa_xt.txt").join("\n\n");
  const a = cotar(raw, { rav: "" });
  const b = cotar(raw, { rav: "   " });
  assert.equal(crcDe(a), crcDe(b));
  a.close(); b.close();
});

test("CRC que para na validacao nao deixa na tela a previa de outra cotacao", () => {
  const raw = blocos("sabre_tarifa_xt.txt").join("\n\n");
  const ruim = cotar(raw, { rc: "abc" });            // build() direto nao valida; o botao valida
  const b = cotar(blocos("amadeus_tarifa_fxp.txt").join("\n\n"), { loc: "OUTRA1" });
  assert.ok(previewHtml(b), "havia uma previa de outra cotacao");
  carregar(crcDe(ruim), b);
  assert.equal($(b, "fldRC").value, "abc");
  assert.equal(previewHtml(b), "", "previa antiga removida");
  assert.equal($(b, "preview").innerHTML, "");
  ruim.close(); b.close();
});
