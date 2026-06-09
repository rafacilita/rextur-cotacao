const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const root = join(__dirname, "..");
const html = readFileSync(join(root, "index.html"), "utf8");

function createApp(){
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://cotacao.test/"
  });
  return dom.window;
}

function fixture(name){
  const content = readFileSync(join(root, "exemplos_gds", name), "utf8");
  const match = content.match(/```text\s*([\s\S]*?)```/i);
  if(!match) throw new Error(`Bloco GDS nao encontrado em ${name}`);
  return match[1].trim();
}

function fixtureAll(name){
  const content = readFileSync(join(root, "exemplos_gds", name), "utf8");
  const blocks = Array.from(content.matchAll(/```text\s*([\s\S]*?)```/gi), match => match[1].trim());
  if(!blocks.length) throw new Error(`Blocos GDS nao encontrados em ${name}`);
  return blocks.join("\n\n");
}

test("detecta e interpreta PNR Amadeus simples", () => {
  const app = createApp();
  const raw = fixture("amadeus_pnr_simples.txt");
  assert.equal(app.detectGDSFromItin(raw), "AMA");
  const segments = app.parseItinerary(raw, "AMA", 2026);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].org, "GRU");
  assert.equal(segments[0].dst, "MEX");
  assert.equal(segments[0].statusCode, "HK");
  app.close();
});

test("detecta e interpreta PNR Sabre simples", () => {
  const app = createApp();
  const raw = fixture("sabre_pnr_simples.txt");
  assert.equal(app.detectGDSFromItin(raw), "SAB");
  const segments = app.parseItinerary(raw, "SAB", 2026);
  assert.equal(segments.length, 2);
  assert.equal(segments[1].org, "MEX");
  assert.equal(segments[1].dst, "GRU");
  assert.equal(segments[1].arrDayOffset, 1);
  app.close();
});

test("le tarifa Amadeus com cambio e bagagem", () => {
  const app = createApp();
  const price = app.parsePricingAmadeus(fixture("amadeus_tarifa_fxp.txt"));
  assert.equal(price.fareCur, "USD");
  assert.equal(price.fareAmt, 500);
  assert.equal(price.totalBRL, 3200);
  assert.equal(price.bag, "1PC");
  app.close();
});

test("le tarifa Sabre com XT", () => {
  const app = createApp();
  const price = app.parsePricingSabre(fixture("sabre_tarifa_xt.txt"));
  assert.equal(price.fareAmt, 500);
  assert.equal(price.equivBRL, 2750);
  assert.equal(price.taxesBRL, 450);
  assert.equal(price.totalBRL, 3200);
  app.close();
});

test("identifica companhia operadora em code-share", () => {
  const app = createApp();
  const raw = fixture("code_share_operated_by.txt");
  const gds = app.detectGDSFromItin(raw);
  const segments = app.parseItinerary(raw, gds, 2026);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].airline, "LA");
  assert.equal(segments[0].opCarrier, "IB");
  assert.equal(segments[0].opFlight, "6824");
  assert.equal(segments[0].opName, "IBERIA");
  app.close();
});

test("nao aceita disponibilidade como PNR vendido", () => {
  const app = createApp();
  const raw = fixture("disponibilidade_nao_pnr.txt");
  app.document.getElementById("itin").value = raw;
  const issues = app.validateQuoteInput();
  assert.ok(
    issues.some(issue => issue.level === "error" && issue.id === "itin"),
    "Disponibilidade deveria bloquear a geracao"
  );
  app.close();
});

test("preserva bagagem diferente por trecho no Sabre", () => {
  const app = createApp();
  const raw = fixture("sabre_bagagem_variavel.txt");
  const price = app.parsePricingSabre(raw);
  assert.equal(price.totalBRL, 4048.33);
  assert.deepEqual(
    Array.from(price.bagSegs),
    ["1PC", "Sem Bag", "1PC", "1PC"]
  );
  app.close();
});

test("classifica ADT CHD e INF no Sabre", () => {
  const app = createApp();
  const pax = app.parsePaxFromItin(fixture("sabre_adt_chd_inf.txt"));
  assert.equal(pax.filter(item => item.type === "ADT").length, 2);
  assert.equal(pax.filter(item => item.type === "CHD").length, 1);
  assert.equal(pax.filter(item => item.type === "INF").length, 1);
  app.close();
});

test("interpreta Sabre complexo sem transformar VOID em voo", () => {
  const app = createApp();
  const raw = fixture("sabre_ib_adt_chd_inf_stop_mad_surface_vlc_bio.txt");
  const segments = app.parseItinerary(raw, "SAB", 2026);
  assert.equal(segments.filter(segment => !segment.surface).length, 4);
  assert.equal(segments.some(segment => segment.flight === "VOID"), false);
  assert.deepEqual(
    Array.from(segments.filter(segment => !segment.surface), segment => `${segment.org}-${segment.dst}`),
    ["GRU-MAD", "MAD-VLC", "BIO-MAD", "MAD-GRU"]
  );
  app.close();
});

test("le familia tarifaria e bagagem no Sabre complexo", () => {
  const app = createApp();
  const raw = fixtureAll("sabre_ib_adt_chd_inf_stop_mad_surface_vlc_bio.txt");
  const price = app.parsePricingSabre(raw);
  assert.equal(price.fareFamily, "OPTIMA");
  assert.ok(price.bagSegs.length >= 4);
  assert.ok(price.bagSegs.every(item => item === "1PC"));
  app.close();
});

test("interpreta Amadeus com ADT CHD e INF", () => {
  const app = createApp();
  const raw = fixture("amadeus_adt_chd_inf.txt");
  const segments = app.parseItinerary(raw, "AMA", 2026);
  const pricingBlocks = raw.split(/(?=LAST TKT DTE)/).slice(1);
  const prices = pricingBlocks.map(block => app.parsePricingAmadeus(block));
  assert.equal(segments.length, 2);
  assert.deepEqual(
    prices.map(price => price.totalBRL),
    [4705.30, 4705.30, 782.58]
  );
  assert.ok(prices.every(price => price.bag === "Sem Bag"));
  assert.ok(prices.every(price => price.fareFamily === "SL"));
  app.close();
});

test("salva e restaura rascunho", () => {
  const app = createApp();
  const loc = app.document.getElementById("fldLOC");
  loc.value = "ABC123";
  app.saveDraft();
  loc.value = "";
  assert.equal(app.restoreDraft(), true);
  assert.equal(loc.value, "ABC123");
  app.close();
});
