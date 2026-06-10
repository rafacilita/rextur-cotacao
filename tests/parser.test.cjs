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

function fixtureBlocks(name){
  const content = readFileSync(join(root, "exemplos_gds", name), "utf8");
  const blocks = Array.from(content.matchAll(/```text\s*([\s\S]*?)```/gi), match => match[1].trim());
  if(!blocks.length) throw new Error(`Blocos GDS nao encontrados em ${name}`);
  return blocks;
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

test("preserva tarifa original Amadeus em CNY para ADT CHD e INF", () => {
  const app = createApp();
  const [, adtRaw, chdRaw, infRaw] = fixtureBlocks("amadeus_cny_adt_chd_inf.txt");
  const prices = [adtRaw, chdRaw, infRaw].map(raw => app.parsePricingAmadeus(raw));

  assert.deepEqual(prices.map(price => price.fareCur), ["CNY", "CNY", "CNY"]);
  assert.deepEqual(prices.map(price => price.fareAmt), [20500, 15380, 2050]);
  assert.deepEqual(prices.map(price => price.equivBRL), [15647.79, 11739.66, 1564.77]);
  assert.deepEqual(prices.map(price => price.totalBRL), [20513.52, 16338.26, 1564.77]);
  assert.deepEqual(prices.map(price => price.bag), ["2PC", "2PC", "1PC"]);
  app.close();
});

test("gera cotacao Amadeus CNY sem usar cambio CNY no RC", () => {
  const app = createApp();
  const [itinRaw, adtRaw, chdRaw, infRaw] = fixtureBlocks("amadeus_cny_adt_chd_inf.txt");
  app.document.getElementById("qADT").value = "1";
  app.document.getElementById("qCHD").value = "1";
  app.document.getElementById("qINF").value = "1";
  app.refreshPaxUI();
  app.document.getElementById("itin").value = itinRaw;
  app.document.getElementById("maskADT").value = adtRaw;
  app.document.getElementById("maskCHD").value = chdRaw;
  app.document.getElementById("maskINF").value = infRaw;
  app.document.getElementById("fldRC").value = "40";
  app.setFxRate(5.1693, { source: "BCB" }, false);
  app.build();

  assert.equal(app._lastQuote.pricing.ADT.fareCur, "CNY");
  assert.equal(app._lastQuote.pricing.CHD.fareCur, "CNY");
  assert.equal(app._lastQuote.pricing.INF.fareCur, "CNY");
  assert.equal(app._lastQuote.iataRate.rate, 5.1693);
  assert.match(app.document.getElementById("preview").textContent, /CNY\s*20,500\.00/);
  assert.match(app.document.getElementById("preview").textContent, /CNY\s*15,380\.00/);
  assert.match(app.document.getElementById("preview").textContent, /CNY\s*2,050\.00/);
  app.close();
});

test("aceita outras moedas ISO em tarifas Amadeus", () => {
  const app = createApp();
  const cases = [
    { currency: "GBP", fare: "875.50", expected: 875.50 },
    { currency: "JPY", fare: "125000", expected: 125000 },
    { currency: "AUD", fare: "1430.75", expected: 1430.75 },
    { currency: "CAD", fare: "1299.00", expected: 1299 },
    { currency: "CHF", fare: "910.40", expected: 910.40 },
    { currency: "AED", fare: "3280", expected: 3280 }
  ];

  for(const item of cases){
    const raw = [
      `${item.currency} ${item.fare} 10JAN27AAA XX BBB100.00NUC100.00END ROE1.00`,
      "BRL 5000.00 END ROE1.00",
      "BRL 400.00-YQ",
      "BRL 5400.00",
      `RATE USED 1${item.currency}=1.000000BRL`
    ].join("\n");
    const price = app.parsePricingAmadeus(raw);
    assert.equal(price.fareCur, item.currency);
    assert.equal(price.fareAmt, item.expected);
    assert.match(app.moneyCurrency(price.fareAmt, price.fareCur), new RegExp(`^${item.currency}\\s`));
  }
  app.close();
});

test("nao usa cambio de moeda estrangeira como cambio USD do RC", () => {
  const app = createApp();
  const [itinRaw, adtRaw] = fixtureBlocks("amadeus_cny_adt_chd_inf.txt");
  app.document.getElementById("itin").value = itinRaw;
  app.document.getElementById("maskADT").value = adtRaw;
  app.document.getElementById("fldRC").value = "40";
  app.build();

  assert.equal(app.document.getElementById("fldFX").value, "");
  assert.equal(app._lastQuote.iataRate, null);
  assert.equal(app._lastQuote.totals.group.rcTotal, 0);
  assert.ok(app._lastQuote.meta.warnings.some(warning => warning.includes("câmbio não encontrado")));
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

test("separa PQs Sabre colados em um unico campo", () => {
  const app = createApp();
  const raw = fixture("sabre_wp_pq_combinado_jpy.txt");
  const result = app.splitSabrePricingMasks(raw);

  assert.deepEqual(
    { ADT: result.counts.ADT, CHD: result.counts.CHD, INF: result.counts.INF },
    { ADT: 1, CHD: 1, INF: 1 }
  );
  assert.equal(result.masks.ADT, "");
  assert.match(result.masks.CHD, /PQ 2\s+PCNN/);
  assert.match(result.masks.INF, /PQ 3\s+PINF/);
  assert.match(result.itinerary, /JL 225N 20DEC/);
  app.close();
});

test("le JPY e tarifa zero nos PQs Sabre combinados", () => {
  const app = createApp();
  const result = app.splitSabrePricingMasks(fixture("sabre_wp_pq_combinado_jpy.txt"));
  const chd = app.parsePricingSabre(result.masks.CHD);
  const inf = app.parsePricingSabre(result.masks.INF);

  assert.deepEqual(
    [chd.fareCur, chd.fareAmt, chd.equivBRL, chd.taxesBRL, chd.totalBRL, chd.bag],
    ["JPY", 11400, 367.94, 52.92, 420.86, "2PC"]
  );
  assert.deepEqual(
    [inf.fareCur, inf.fareAmt, inf.equivBRL, inf.taxesBRL, inf.totalBRL, inf.bag],
    ["JPY", 0, 0, 0, 0, "1PC"]
  );
  app.close();
});

test("distribui campo combinado e sinaliza PQ ausente", () => {
  const app = createApp();
  app.document.getElementById("maskAll").value = fixture("sabre_wp_pq_combinado_jpy.txt");
  const result = app.applyCombinedPricingInput({ overwrite: true, announce: false });

  assert.equal(app.document.getElementById("qADT").value, "1");
  assert.equal(app.document.getElementById("qCHD").value, "1");
  assert.equal(app.document.getElementById("qINF").value, "1");
  assert.equal(app.document.getElementById("maskADT").value, "");
  assert.match(app.document.getElementById("maskCHD").value, /JPY11400/);
  assert.match(app.document.getElementById("maskINF").value, /JPY0/);
  assert.match(app.document.getElementById("itin").value, /HNDKIX/);
  assert.match(app.document.getElementById("maskSplitStatus").textContent, /faltando: ADT/);
  assert.equal(result.counts.CHD, 1);
  app.close();
});

test("distribui ADT CHD e INF quando todos os PQs estao presentes", () => {
  const app = createApp();
  const partial = fixture("sabre_wp_pq_combinado_jpy.txt");
  const adtBlock = [
    "    PQ 1  NCB",
    "    BASE FARE       EQUIV AMT     TAXES/FEES/CHARGES          TOTAL",
    "    JPY15000        BRL483.50       60.00XT            BRL543.50ADT",
    "    ADT-01  NJPSLJAP",
    "    01 O HND JL 225N 20DEC 1245  NJPSLJAP        20DEC2620DEC26 02P",
    "         KIX"
  ].join("\n");
  const complete = partial.replace(/(\n\s*PQ 2\s+PCNN)/, `\n${adtBlock}$1`);
  app.document.getElementById("maskAll").value = complete;
  app.applyCombinedPricingInput({ overwrite: true, announce: false });
  app.build();

  assert.match(app.document.getElementById("maskADT").value, /JPY15000/);
  assert.match(app.document.getElementById("maskCHD").value, /JPY11400/);
  assert.match(app.document.getElementById("maskINF").value, /JPY0/);
  assert.equal(app._lastQuote.pricing.ADT.fareAmt, 15000);
  assert.equal(app._lastQuote.pricing.CHD.fareAmt, 11400);
  assert.equal(app._lastQuote.pricing.INF.fareAmt, 0);
  assert.doesNotMatch(app.document.getElementById("maskSplitStatus").textContent, /faltando/);
  app.close();
});

test("separa FQQs Amadeus colados em um unico campo", () => {
  const app = createApp();
  const raw = fixture("amadeus_fqq_combinado_eur.txt");
  const result = app.splitCombinedPricingMasks(raw);

  assert.deepEqual(
    { ADT: result.counts.ADT, CHD: result.counts.CHD, INF: result.counts.INF },
    { ADT: 1, CHD: 1, INF: 1 }
  );
  assert.match(result.masks.ADT, /^FQQ01/m);
  assert.match(result.masks.CHD, /^FQQ02/m);
  assert.match(result.masks.INF, /^FQQ03/m);
  assert.match(result.itinerary, /TK 418 S 20NOV/);
  app.close();
});

test("le ADT CHD e INF dos FQQs Amadeus combinados", () => {
  const app = createApp();
  const result = app.splitCombinedPricingMasks(fixture("amadeus_fqq_combinado_eur.txt"));
  const prices = ["ADT", "CHD", "INF"].map(type => app.parsePricingAmadeus(result.masks[type]));

  assert.deepEqual(prices.map(price => price.fareCur), ["EUR", "EUR", "EUR"]);
  assert.deepEqual(prices.map(price => price.fareAmt), [2348, 1761, 235]);
  assert.deepEqual(prices.map(price => price.equivBRL), [13997.13, 10497.85, 1400.90]);
  assert.deepEqual(prices.map(price => price.totalBRL), [18196.12, 14696.84, 1400.90]);
  assert.deepEqual(prices.map(price => price.bag), ["2PC", "2PC", "1PC"]);
  app.close();
});

test("gera cotacao completa a partir do campo combinado Amadeus", () => {
  const app = createApp();
  app.document.getElementById("maskAll").value = fixture("amadeus_fqq_combinado_eur.txt");
  app.applyCombinedPricingInput({ overwrite: true, announce: false });
  app.build();

  assert.equal(app.document.getElementById("qADT").value, "1");
  assert.equal(app.document.getElementById("qCHD").value, "1");
  assert.equal(app.document.getElementById("qINF").value, "1");
  assert.equal(app._lastQuote.meta.gds, "AMA");
  assert.equal(app._lastQuote.pricing.ADT.fareAmt, 2348);
  assert.equal(app._lastQuote.pricing.CHD.fareAmt, 1761);
  assert.equal(app._lastQuote.pricing.INF.fareAmt, 235);
  assert.match(app.document.getElementById("preview").textContent, /EUR\s*2,348\.00/);
  assert.match(app.document.getElementById("preview").textContent, /EUR\s*1,761\.00/);
  assert.match(app.document.getElementById("preview").textContent, /EUR\s*235\.00/);
  app.close();
});

test("interpreta retorno de marco no ano seguinte no Amadeus combinado", () => {
  const app = createApp();
  const raw = fixture("amadeus_fqq_combinado_eur.txt");
  const result = app.splitCombinedPricingMasks(raw);
  const year = app.inferYearFromText(raw);
  const segments = app.parseItinerary(result.itinerary, "AMA", year);

  assert.equal(year, 2026);
  assert.equal(segments[0].depDateFmt, "20/11/2026");
  assert.equal(segments[2].depDateFmt, "05/03/2027");
  assert.equal(segments[3].depDateFmt, "06/03/2027");
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

test("interpreta Sabre com origem exterior e virada de ano", () => {
  const app = createApp();
  const raw = fixture("sabre_origem_exterior_eur_virada_ano.txt");
  const year = app.inferYearFromText(raw);
  const segments = app.parseItinerary(raw, "SAB", year);
  assert.equal(year, 2026);
  assert.equal(segments.length, 4);
  assert.equal(segments[0].depDateFmt, "20/12/2026");
  assert.equal(segments[2].depDateFmt, "05/01/2027");
  assert.equal(segments[3].arrDateFmt, "06/01/2027");
  assert.equal(segments[3].arrDayOffset, 0);
  app.close();
});

test("le tarifa Sabre em EUR com equivalente BRL", () => {
  const app = createApp();
  const price = app.parsePricingSabre(fixture("sabre_origem_exterior_eur_virada_ano.txt"));
  assert.equal(price.fareCur, "EUR");
  assert.equal(price.fareAmt, 2315);
  assert.equal(price.equivBRL, 13673.45);
  assert.equal(price.taxesBRL, 1217.05);
  assert.equal(price.totalBRL, 14890.50);
  assert.equal(price.bag, "1PC");
  assert.match(app.moneyCurrency(price.fareAmt, price.fareCur), /^EUR\s/);
  app.close();
});

test("gera cotacao CNN em EUR com totais em BRL", () => {
  const app = createApp();
  const raw = fixture("sabre_origem_exterior_eur_virada_ano.txt");
  app.document.getElementById("qADT").value = "0";
  app.document.getElementById("qCHD").value = "1";
  app.document.getElementById("qINF").value = "0";
  app.refreshPaxUI();
  app.document.getElementById("itin").value = raw;
  app.document.getElementById("maskCHD").value = raw;
  app.build();

  assert.equal(app._lastQuote.pricing.CHD.fareCur, "EUR");
  assert.equal(app._lastQuote.totals.totalBRL, 14890.50);
  assert.match(app.document.getElementById("preview").textContent, /EUR\s*2,315\.00/);
  assert.match(app.document.getElementById("preview").textContent, /R\$\s*14\.890,50/);
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

test("consulta a venda BCB anterior a data de uso", async () => {
  const app = createApp();
  const requestedUrls = [];
  const fakeFetch = async url => {
    requestedUrls.push(url);
    return {
      ok: true,
      json: async () => ({
        value: url.includes("06-08-2026")
          ? [{ cotacaoCompra: 5.1689, cotacaoVenda: 5.1695 }]
          : []
      })
    };
  };

  const usageDate = new Date(Date.UTC(2026, 5, 9));
  const quote = await app.fetchBcbUsdRateForUsageDate(usageDate, fakeFetch);

  assert.equal(quote.rate, 5.1695);
  assert.equal(app.formatDateBR(quote.baseDate), "08/06/2026");
  assert.equal(app.formatDateBR(quote.usageDate), "09/06/2026");
  assert.equal(requestedUrls.length, 1);
  app.close();
});

test("cambio USD BRL altera somente o RC", () => {
  const app = createApp();
  const raw = fixture("sabre_origem_exterior_eur_virada_ano.txt");
  app.document.getElementById("qADT").value = "0";
  app.document.getElementById("qCHD").value = "1";
  app.document.getElementById("qINF").value = "0";
  app.refreshPaxUI();
  app.document.getElementById("itin").value = raw;
  app.document.getElementById("maskCHD").value = raw;
  app.document.getElementById("fldRC").value = "10";
  app.setFxRate(5.1695, { source: "BCB" }, false);
  app.build();

  assert.equal(app._lastQuote.pricing.CHD.equivBRL, 13673.45);
  assert.equal(app._lastQuote.pricing.CHD.taxesBRL, 1217.05);
  assert.equal(app._lastQuote.totals.group.rcTotal, 51.70);
  assert.equal(app._lastQuote.totals.totalBRL, 14942.20);
  app.close();
});
