// Botao copiar: a versao em texto simples (text/plain) do e-mail. Antes era o HTML sem as tags,
// com entidades cruas (&mdash;, &nbsp;, &amp;) e tudo numa linha so.
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const root = join(__dirname, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const fixtures = readdirSync(join(root, "exemplos_gds")).filter((f) => f.endsWith(".txt"));
const blocos = (nome) => Array.from(readFileSync(join(root, "exemplos_gds", nome), "utf8").matchAll(/```text\s*([\s\S]*?)```/gi), (m) => m[1].trim());
const novoApp = () => new JSDOM(html, { runScripts: "dangerously", url: "https://cotacao.test/" }).window;
const $ = (app, id) => app.document.getElementById(id);
const previewHtml = (app) => $(app, "preview").dataset.html || "";
const valores = (s) => (s.split(String.fromCharCode(160)).join(" ").match(/R\$ ?[0-9.]+,[0-9]{2}/g) || []).map((v) => v.replace(" ", ""));

function cotar(raw, extra = {}) {
  const app = novoApp();
  $(app, "itin").value = raw;
  $(app, "maskAll").value = raw;
  app.applyCombinedPricingInput({ overwrite: true, announce: false });
  for (const t of ["ADT", "CHD", "INF"]) {
    const q = $(app, "q" + t);
    if ($(app, "mask" + t).value.trim() && !(+q.value)) q.value = "1";
    else if (!$(app, "mask" + t).value.trim() && t === "ADT" && ($(app, "maskCHD").value.trim() || $(app, "maskINF").value.trim())) q.value = "0";
  }
  app.refreshPaxUI();
  $(app, "fldMarkup").value = extra.markup ?? "8";
  $(app, "fldRAV").value = extra.rav ?? "7,00";
  $(app, "fldRC").value = extra.rc ?? "25";
  app.setFxRate(5.4321, { source: "BCB", baseDate: "2026-11-03", usageDate: "2026-11-04" }, false);
  if (extra.condOutro) { $(app, "fldCondicao").value = "Outro"; $(app, "fldCondOutro").value = extra.condOutro; app.refreshOptionalUI(); }
  app.eval(`(function(){
    const t = $("itin").value;
    const segs = parseItinerary(t, detectGDSFromItin(t), inferYearFromText(t)).filter(s => s && !s.surface);
    cabinConfirmState = { itinText: t, cabins: segs.map(() => "Econômica") };
  })()`);
  app.build();
  return app;
}

for (const nome of fixtures) {
  const bs = blocos(nome);
  if (!bs.length) continue;
  test(`texto simples: ${nome} sem entidades, com os mesmos valores, e o CRC dele reabre a cotacao`, () => {
    const a = cotar(bs.join("\n\n"));
    const texto = a.emailPlainText(previewHtml(a));
    assert.doesNotMatch(texto, /&[#a-zA-Z0-9]+;/, "entidade HTML crua no texto");
    assert.doesNotMatch(texto, /<[a-z\/]/i, "tag no texto");
    assert.ok(texto.split("\n").length > 10, "texto em linhas, nao numa linha so");
    assert.deepEqual(valores(texto), valores($(a, "preview").textContent), "mesmos valores, na mesma ordem, que a previa");
    const b = novoApp();
    $(b, "crcInput").value = texto;
    $(b, "btnLoadCRC").click();
    assert.equal($(b, "crcMsg").classList.contains("warn"), false, $(b, "crcMsg").textContent);
    const tela = (app) => { const t = JSON.parse(JSON.stringify(app.collectDraftControls())); delete t.maskAll; return t; };
    assert.deepEqual(tela(b), tela(a), "o CRC do texto simples reabre a mesma tela");
    // como no crc.test: sem previa so quando a validacao para a geracao (ex.: disponibilidade, que nao e PNR)
    if (previewHtml(b)) assert.equal(previewHtml(b), previewHtml(a), "o CRC do texto simples reabre o mesmo e-mail");
    a.close(); b.close();
  });
}

test("texto simples: '&', '<' e travessao digitados saem como caractere, e cada linha de tabela e uma linha", () => {
  const a = cotar(blocos("sabre_adt_chd_inf.txt").join("\n\n"), { condOutro: "Tarifa A&B <promo> — sem troca" });
  const texto = a.emailPlainText(previewHtml(a));
  assert.match(texto, /Tarifa A&B <promo> — sem troca/);
  assert.match(texto, /^Cotação INTER — Nova emissão$/m);
  assert.match(texto, /^Tipo \| Tarifa \(moeda\) \| Tarifa \(BRL\) \| Taxas \(BRL\)/m);
  assert.match(texto, /^QR 780 \| São Paulo \(Guarulhos\) → Doha GRU → DOH \| 20\/07\/2026 20:30 \|/m);
  a.close();
});

test("botao copiar: grava o HTML intacto e o texto simples novo", async () => {
  const a = cotar(blocos("sabre_adt_chd_inf.txt").join("\n\n"));
  const gravado = {};
  a.Blob = class { constructor(partes, opt) { this.conteudo = partes.join(""); this.type = opt.type; } };
  a.ClipboardItem = class { constructor(itens) { Object.assign(gravado, itens); } };
  Object.defineProperty(a.navigator, "clipboard", { value: { write: async () => {} }, configurable: true });
  $(a, "btnCopy").click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(gravado["text/html"].conteudo, previewHtml(a));
  assert.equal(gravado["text/plain"].conteudo, a.emailPlainText(previewHtml(a)));
  assert.doesNotMatch(gravado["text/plain"].conteudo, /&mdash;|&nbsp;|&amp;/);
  a.close();
});
