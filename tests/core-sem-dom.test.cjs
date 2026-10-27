// Prova que o NUCLEO (src/script/10..60-core-*.js) roda SEM navegador: carregado numa vm
// sem document/window/localStorage. Se alguem colocar acesso a DOM no nucleo, este teste
// quebra com ReferenceError. Tambem compara o resultado com o app inteiro (jsdom).
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const root = join(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "src", "manifest.json"), "utf8"));
const coreFiles = manifest.script.filter((f) => /\/\d+-core-/.test(f));
assert.ok(coreFiles.length >= 6, "esperava os modulos de nucleo no manifest");

// contexto nu: so o que o JS padrao oferece (vm.createContext nao injeta document/window)
const ctx = vm.createContext({});
vm.runInContext(coreFiles.map((f) => readFileSync(join(root, f), "utf8")).join("\n"), ctx, { filename: "nucleo" });
const nucleo = (expr) => JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, ctx));

const html = readFileSync(join(root, "index.html"), "utf8");
const app = new JSDOM(html, { runScripts: "dangerously", url: "https://cotacao.test/" }).window;
const viaApp = (fn, ...args) => JSON.parse(JSON.stringify(app[fn](...args)));

const fixtures = readdirSync(join(root, "exemplos_gds")).filter((f) => f.endsWith(".txt"));
function blocos(nome) {
  const c = readFileSync(join(root, "exemplos_gds", nome), "utf8");
  return Array.from(c.matchAll(/```text\s*([\s\S]*?)```/gi), (m) => m[1].trim());
}

test("nucleo carrega sem document/window/localStorage", () => {
  for (const g of ["document", "window", "localStorage", "navigator"]) {
    assert.equal(vm.runInContext(`typeof ${g}`, ctx), "undefined", g);
  }
  for (const fn of ["detectGDSFromItin", "parseItinerary", "parsePricingAmadeus", "parsePricingSabre", "createQuoteModel", "applyRules", "buildEmail"]) {
    assert.equal(vm.runInContext(`typeof ${fn}`, ctx), "function", fn);
  }
});

for (const nome of fixtures) {
  const bs = blocos(nome);
  if (!bs.length) continue;
  test(`nucleo == app (jsdom): ${nome}`, () => {
    const raw = bs.join("\n\n");
    ctx.__raw = raw;
    app.__raw = raw;
    assert.equal(vm.runInContext("detectGDSFromItin(__raw)", ctx), app.detectGDSFromItin(raw));
    const gds = app.detectGDSFromItin(raw);
    const a = nucleo(`parseItinerary(__raw, ${JSON.stringify(gds)}, 2026)`);
    assert.deepEqual(a, viaApp("parseItinerary", raw, gds, 2026));
    assert.deepEqual(nucleo("detectPaxCountsFromPricing(__raw)"), viaApp("detectPaxCountsFromPricing", raw));
    assert.deepEqual(nucleo("splitCombinedPricingMasks(__raw)"), viaApp("splitCombinedPricingMasks", raw));
    for (const b of bs) {
      ctx.__b = b;
      assert.deepEqual(nucleo("parsePricingAmadeus(__b)"), viaApp("parsePricingAmadeus", b));
      assert.deepEqual(nucleo("parsePricingSabre(__b)"), viaApp("parsePricingSabre", b));
    }
  });
}

test("computeQuote roda sem DOM e gera o mesmo QuoteModel que o app", () => {
  const [itin, adt] = blocos("amadeus_cny_adt_chd_inf.txt");
  const inputs = {
    itin, masks: { ADT: adt, CHD: "", INF: "" }, pax: { adt: 1, chd: 0, inf: 0 },
    paxNames: { ADT: [], CHD: [], INF: [] }, payment: { methods: [], link: "" }, cabinConfirm: null,
    cabine: { value: "", source: "" }, condSel: "Incluir a RAV", condOutro: "", rcUSD: "40", openTicket: "", loc: "",
    multaReembolso: "", multaRemarcacao: "", assentosMode: "", assentosCustom: "",
    bagOverrides: { ADT: "", CHD: "", INF: "" }, fxInput: "5,1693",
    fx: { value: "5,1693", source: "BCB", baseDate: "", usageDate: "" },
  };
  ctx.__inputs = JSON.parse(JSON.stringify(inputs));
  const r = nucleo("computeQuote(__inputs)");
  const doc = app.document;
  doc.getElementById("qADT").value = "1"; doc.getElementById("qCHD").value = "0"; doc.getElementById("qINF").value = "0";
  app.refreshPaxUI();
  doc.getElementById("itin").value = itin; doc.getElementById("maskADT").value = adt; doc.getElementById("fldRC").value = "40";
  app.setFxRate(5.1693, { source: "BCB" }, false);
  app.build();
  const semHora = (q) => JSON.parse(JSON.stringify(q, (k, v) => (k === "parsedAt" ? undefined : v)));
  assert.deepEqual(semHora(r.finalQuote), semHora(app._lastQuote));
  assert.equal(r.gds, "AMA");
});
