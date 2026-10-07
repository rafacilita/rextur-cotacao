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
  assert.match(app.document.getElementById("maskSplitStatus").textContent, /faltando: ADT/i);
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
  assert.doesNotMatch(app.document.getElementById("maskSplitStatus").textContent, /faltando/i);
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

test("reconhece CHD e INF em cabecalho FQQ Amadeus curto", () => {
  const app = createApp();
  const raw = fixture("amadeus_fqq_cabecalho_curto_cny.txt");
  const result = app.splitCombinedPricingMasks(raw);

  assert.deepEqual(
    { ADT: result.counts.ADT, CHD: result.counts.CHD, INF: result.counts.INF },
    { ADT: 1, CHD: 1, INF: 1 }
  );
  assert.match(result.masks.ADT, /01 BCN\s+\*/);
  assert.match(result.masks.CHD, /02 BCNCH\s+\* CH/);
  assert.match(result.masks.INF, /03 BCNINF\s+\* IN/);
  app.close();
});

test("gera os tres tipos a partir do FQQ Amadeus curto", () => {
  const app = createApp();
  app.document.getElementById("maskAll").value = fixture("amadeus_fqq_cabecalho_curto_cny.txt");
  app.applyCombinedPricingInput({ overwrite: true, announce: false });
  app.build();

  assert.equal(app.document.getElementById("qADT").value, "1");
  assert.equal(app.document.getElementById("qCHD").value, "1");
  assert.equal(app.document.getElementById("qINF").value, "1");
  assert.deepEqual(
    [
      app._lastQuote.pricing.ADT.fareAmt,
      app._lastQuote.pricing.CHD.fareAmt,
      app._lastQuote.pricing.INF.fareAmt
    ],
    [5810, 2910, 590]
  );
  assert.deepEqual(
    [
      app._lastQuote.pricing.ADT.totalBRL,
      app._lastQuote.pricing.CHD.totalBRL,
      app._lastQuote.pricing.INF.totalBRL
    ],
    [4587.46, 2274.65, 450.35]
  );
  assert.deepEqual(
    [
      app._lastQuote.pricing.ADT.bag,
      app._lastQuote.pricing.CHD.bag,
      app._lastQuote.pricing.INF.bag
    ],
    ["20KG", "20KG", "10KG"]
  );
  app.close();
});

test("interpreta itinerario visual Sabre em duas linhas", () => {
  const app = createApp();
  const raw = fixture("sabre_visual_yq_pq_paginado.txt");
  const result = app.splitCombinedPricingMasks(raw);
  const segments = app.parseItinerary(result.itinerary, "SAB", 2026);

  assert.equal(segments.length, 1);
  assert.deepEqual(
    [
      segments[0].airline,
      segments[0].flight,
      segments[0].rbd,
      segments[0].org,
      segments[0].dst,
      segments[0].depDateFmt,
      segments[0].depTimeFmt,
      segments[0].arrTimeFmt,
      segments[0].statusCode
    ],
    ["NH", "920", "W", "PVG", "NRT", "20/09/2026", "13:00", "16:55", "SS"]
  );
  app.close();
});

test("le taxas YQ em PQs Sabre paginados", () => {
  const app = createApp();
  const result = app.splitCombinedPricingMasks(fixture("sabre_visual_yq_pq_paginado.txt"));
  const chd = app.parsePricingSabre(result.masks.CHD);
  const inf = app.parsePricingSabre(result.masks.INF);

  assert.equal(result.masks.ADT, "");
  assert.deepEqual(
    [chd.fareCur, chd.fareAmt, chd.equivBRL, chd.taxesBRL, chd.totalBRL, chd.bag],
    ["CNY", 1690, 1291.52, 377.16, 1668.68, "2PC"]
  );
  assert.deepEqual(
    [inf.fareCur, inf.fareAmt, inf.equivBRL, inf.taxesBRL, inf.totalBRL, inf.bag],
    ["CNY", 230, 175.76, 40.15, 215.91, "1PC"]
  );
  app.close();
});

test("gera parcial Sabre visual preservando aviso de ADT ausente", () => {
  const app = createApp();
  app.document.getElementById("maskAll").value = fixture("sabre_visual_yq_pq_paginado.txt");
  app.applyCombinedPricingInput({ overwrite: true, announce: false });
  app.build();

  assert.equal(app._lastQuote.itinerary.length, 1);
  assert.equal(app._lastQuote.pricing.ADT, null);
  assert.equal(app._lastQuote.pricing.CHD.totalBRL, 1668.68);
  assert.equal(app._lastQuote.pricing.INF.totalBRL, 215.91);
  assert.match(app.document.getElementById("maskSplitStatus").textContent, /faltando: ADT/i);
  assert.match(app.document.getElementById("preview").textContent, /PVG.*NRT/s);
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

// ─── Passo 2: avisos do motor e confiabilidade na tela ────────────────────────

test("renderValidation aceita aviso sem id de campo", () => {
  const app = createApp();
  app.renderValidation([
    { id: null, message: "aviso do motor sem campo", level: "warning", source: "engine" }
  ]);
  const summary = app.document.getElementById("validationSummary");
  assert.ok(summary.classList.contains("show"));
  assert.match(summary.textContent, /aviso do motor sem campo/);
  assert.match(summary.textContent, /Avisos do motor de cota/);
  // Aviso sem id nao deve marcar nenhum controle.
  assert.equal(app.document.querySelectorAll(".is-invalid,.is-warning").length, 0);
  app.close();
});

test("separa avisos de campo e avisos do motor em blocos distintos", () => {
  const app = createApp();
  app.renderValidation([
    { id: "fldRC", message: "campo invalido", level: "error" },
    { id: null, message: "aviso do motor", level: "warning", source: "engine" }
  ]);
  const summary = app.document.getElementById("validationSummary");
  assert.ok(summary.classList.contains("error"));
  assert.equal(summary.querySelectorAll("ul").length, 2);
  assert.match(summary.textContent, /Revise os campos destacados/);
  assert.match(summary.textContent, /Avisos do motor de cota/);
  assert.ok(app.document.getElementById("fldRC").classList.contains("is-invalid"));
  app.close();
});

test("exibe avisos do motor e confiabilidade no painel apos gerar", () => {
  const app = createApp();
  const blocks = fixtureBlocks("amadeus_cny_adt_chd_inf.txt");
  app.document.getElementById("maskAll").value = blocks.join("\n\n");
  app.applyCombinedPricingInput({ overwrite: true, announce: false });
  // RC informado sem cambio garante ao menos um aviso do motor.
  app.document.getElementById("fldRC").value = "40";
  app.build();

  const summary = app.document.getElementById("validationSummary");
  assert.ok(summary.classList.contains("show"));
  assert.match(summary.textContent, /c[âa]mbio n[ãa]o encontrado/);

  const pill = app.document.getElementById("confidencePill");
  assert.equal(pill.hidden, false);
  assert.match(pill.textContent, /Confiabilidade da leitura/);
  const level = app._lastQuote.meta.confidence;
  assert.ok(["HIGH", "MEDIUM", "LOW"].includes(level));
  assert.ok(pill.className.includes("conf-" + level.toLowerCase()));
  app.close();
});

test("esconde a confiabilidade quando a previa fica obsoleta", () => {
  const app = createApp();
  const blocks = fixtureBlocks("amadeus_cny_adt_chd_inf.txt");
  app.document.getElementById("maskAll").value = blocks.join("\n\n");
  app.applyCombinedPricingInput({ overwrite: true, announce: false });
  app.build();

  const pill = app.document.getElementById("confidencePill");
  assert.equal(pill.hidden, false);

  app.markPreviewDirty();
  assert.equal(pill.hidden, true);
  assert.equal(pill.textContent, "");
  app.close();
});

// ─── Passo 3: status do segmento sai do e-mail e vira aviso do motor ──────────

const ITIN_AMA_WAITLISTED = [
  "RP/SAO2R2100/",
  "  1  LA8113 Y 15JUN 6*GRUMEX HK2  0830 1430  15JUN  E  0 320",
  "  2  LA8114 Y 25JUN 2*MEXGRU HL1  2300 1020  26JUN  E  0 320"
].join("\n");

test("classifica status confirmado e lista de espera no Amadeus", () => {
  const app = createApp();
  assert.equal(app.detectGDSFromItin(ITIN_AMA_WAITLISTED), "AMA");
  const segments = app.parseItinerary(ITIN_AMA_WAITLISTED, "AMA", 2026);
  // Array.from traz o array do realm do jsdom para o do Node (deepStrictEqual compara prototype).
  assert.deepEqual(Array.from(segments, segment => segment.statusCode), ["HK", "HL"]);
  assert.deepEqual(Array.from(segments, segment => segment.statusClass), ["confirmed", "waitlisted"]);
  app.close();
});

test("status de segmento nao vai para o e-mail do cliente", () => {
  const app = createApp();
  app.document.getElementById("itin").value = ITIN_AMA_WAITLISTED;
  app.document.getElementById("maskADT").value = fixture("amadeus_tarifa_fxp.txt");
  app.build();

  const preview = app.document.getElementById("preview").textContent;
  assert.doesNotMatch(preview, /LISTA|CANCELADO|VERIFICAR|AGUARDANDO|VOADO/);
  // O voo continua aparecendo; so o selo de status saiu.
  assert.match(preview, /LA\s*8114/);
  app.close();
});

test("status nao confirmado gera aviso do motor para o operador", () => {
  const app = createApp();
  app.document.getElementById("itin").value = ITIN_AMA_WAITLISTED;
  app.document.getElementById("maskADT").value = fixture("amadeus_tarifa_fxp.txt");
  app.build();

  const warnings = app._lastQuote.meta.warnings;
  assert.ok(warnings.some(w => /LA8114/.test(w) && /MEX-GRU/.test(w) && /lista de espera/i.test(w)));
  // O segmento confirmado nao deve gerar aviso.
  assert.equal(warnings.some(w => /LA8113/.test(w)), false);
  // E o aviso chega ao painel na tela.
  assert.match(app.document.getElementById("validationSummary").textContent, /LA8114/);
  app.close();
});

// ─── Passo 4: alinhamento de bagagem e rota com trecho terrestre (ARNK) ───────

test("interpreta ARNK como trecho de superficie no Amadeus", () => {
  const app = createApp();
  const [itinRaw] = fixtureBlocks("amadeus_arnk_surface_bio.txt");
  const segments = app.parseItinerary(itinRaw, "AMA", 2026);

  assert.equal(segments.length, 5);
  assert.equal(segments[2].surface, true);
  assert.deepEqual(
    Array.from(segments.filter(segment => !segment.surface), segment => `${segment.org}-${segment.dst}`),
    ["GRU-MAD", "MAD-VLC", "BIO-MAD", "MAD-GRU"]
  );
  app.close();
});

test("rota ignora o trecho terrestre e preserva o marcador de open jaw", () => {
  const app = createApp();
  const [itinRaw] = fixtureBlocks("amadeus_arnk_surface_bio.txt");
  const segments = app.parseItinerary(itinRaw, "AMA", 2026);
  // Antes da correcao saia "GRU-MAD-VLC // --MAD-GRU", com o ARNK contaminando a string.
  assert.equal(app.buildRouteString(segments), "GRU-MAD-VLC // BIO-MAD-GRU");
  app.close();
});

test("alinha bagagem por trecho aereo quando ha ARNK no Amadeus", () => {
  const app = createApp();
  const [itinRaw, maskRaw] = fixtureBlocks("amadeus_arnk_surface_bio.txt");
  app.document.getElementById("itin").value = itinRaw;
  app.document.getElementById("maskADT").value = maskRaw;
  app.build();

  assert.deepEqual(Array.from(app._lastQuote.pricing.ADT.bagSegs), ["2PC", "2PC", "Sem Bag", "1PC"]);

  const rows = Array.from(app.document.querySelectorAll("#preview tr"), tr => tr.textContent.replace(/\s+/g, " "));
  const bioRow = rows.find(text => /BIO/.test(text));
  const lastRow = rows.find(text => /MAD . GRU/.test(text));
  // Antes da correcao o trecho BIO-MAD exibia 1PC, prometendo bagagem que o GDS nao concedeu.
  assert.match(bioRow, /Sem Bag/);
  assert.doesNotMatch(bioRow, /1PC/);
  assert.match(lastRow, /1PC/);
  app.close();
});

test("aviso de trecho sem bagagem nomeia o trecho aereo correto", () => {
  const app = createApp();
  const [itinRaw, maskRaw] = fixtureBlocks("amadeus_arnk_surface_bio.txt");
  app.document.getElementById("itin").value = itinRaw;
  app.document.getElementById("maskADT").value = maskRaw;
  app.build();

  const warnings = app._lastQuote.meta.warnings;
  // Antes da correcao reportava "trecho 3", que era a linha do ARNK.
  assert.ok(warnings.some(w => /sem bagagem/i.test(w) && /BIO-MAD/.test(w)));
  assert.equal(warnings.some(w => /sem bagagem/i.test(w) && /trecho 3/.test(w)), false);
  assert.match(app.document.getElementById("subjectPill").textContent, /GRU-MAD-VLC \/\/ BIO-MAD-GRU/);
  app.close();
});

// ─── Passo 5: procedencia de total e taxas ────────────────────────────────────

test("registra procedencia sem alterar os valores lidos", () => {
  const app = createApp();

  const fxp = app.parsePricingAmadeus(fixture("amadeus_tarifa_fxp.txt"));
  assert.equal(fxp.totalBRL, 3200);   // inalterado
  assert.equal(fxp.taxesBRL, 450);    // inalterado
  assert.equal(fxp.totalSource, "EXPLICIT_TOTAL");
  assert.equal(fxp.taxesSource, "DERIVED_DIFF_CORROBORATED");

  const cny = app.parsePricingAmadeus(fixtureBlocks("amadeus_cny_adt_chd_inf.txt")[1]);
  assert.equal(cny.totalBRL, 20513.52);  // inalterado
  assert.equal(cny.totalSource, "LAST_BRL_LINE");
  assert.equal(cny.taxesSource, "DERIVED_DIFF_CORROBORATED");

  const sab = app.parsePricingSabre(fixture("sabre_origem_exterior_eur_virada_ano.txt"));
  assert.equal(sab.taxesBRL, 1217.05);   // inalterado
  assert.equal(sab.totalSource, "READ_LINE");
  assert.equal(sab.taxesSource, "READ");
  app.close();
});

test("avisa quando o total Amadeus foi inferido pelo maior valor em BRL", () => {
  const app = createApp();
  const mask = [
    "USD 500.00 10JAN27GRU LA MEX NUC500.00END ROE1.00",
    "BRL 2750.00 END ROE1.00",
    "BRL 450.00-YQ  BRL 3200.00-XT"
  ].join("\n");

  const price = app.parsePricingAmadeus(mask);
  assert.equal(price.totalSource, "MAX_BRL");

  app.document.getElementById("itin").value = fixture("amadeus_pnr_simples.txt");
  app.document.getElementById("maskADT").value = mask;
  app.build();
  assert.ok(app._lastQuote.meta.warnings.some(w => /inferido pelo maior valor/i.test(w)));
  app.close();
});

test("avisa quando as taxas saem por diferenca sem linha de taxa para conferir", () => {
  const app = createApp();
  // Mascara declara FARE/EQUIV/TOTAL mas nao discrimina taxa alguma:
  // os 450 saem apenas da subtracao, sem nada para cruzar.
  const mask = ["FARE     USD     500.00", "EQUIV    BRL    2750.00", "TOTAL    BRL    3200.00"].join("\n");
  const price = app.parsePricingAmadeus(mask);
  assert.equal(price.taxesBRL, 450);
  assert.equal(price.taxesSource, "DERIVED_DIFF");

  app.document.getElementById("itin").value = fixture("amadeus_pnr_simples.txt");
  app.document.getElementById("maskADT").value = mask;
  app.build();
  assert.ok(app._lastQuote.meta.warnings.some(w => /taxas inferidas por diferen[çc]a/i.test(w)));
  app.close();
});

test("nao avisa taxa inferida nas mascaras Amadeus reais", () => {
  for(const name of ["amadeus_cny_adt_chd_inf.txt", "amadeus_fqq_cabecalho_curto_cny.txt", "amadeus_fqq_combinado_eur.txt"]){
    const app = createApp();
    app.document.getElementById("maskAll").value = fixtureAll(name);
    app.applyCombinedPricingInput({ overwrite: true, announce: false });
    app.build();
    const warnings = app._lastQuote.meta.warnings;
    assert.equal(
      warnings.some(w => /inferid/i.test(w)),
      false,
      `${name} nao deveria gerar aviso de valor inferido, mas gerou: ${JSON.stringify(warnings)}`
    );
    app.close();
  }
});

test("taxa zero sem linha de taxa e leitura coerente, nao suspeita", () => {
  const app = createApp();
  // Caso comum de INF isento: equivalente igual ao total e nenhuma linha de taxa.
  const price = app.parsePricingAmadeus(["BRL  1564.77      CAN221.29NUC300.42END ROE6.823555", "BRL  1564.77"].join("\n"));
  assert.equal(price.taxesBRL, 0);
  assert.equal(price.taxesSource, "DERIVED_DIFF_CORROBORATED");

  // Tarifa zero no Sabre tambem nao deve virar aviso.
  const zero = app.parsePricingSabre("JPY0            BRL0.00                              BRL0.00INF");
  assert.equal(zero.totalBRL, 0);
  assert.notEqual(zero.taxesSource, "DERIVED_DIFF");
  app.close();
});

// ─── Passo 6: buildEmail puro e totais calculados num unico lugar ─────────────

test("total do grupo no e-mail bate com o KPI e com totals.group", () => {
  const app = createApp();
  const raw = fixture("sabre_origem_exterior_eur_virada_ano.txt");
  app.document.getElementById("qADT").value = "3";
  app.document.getElementById("qCHD").value = "0";
  app.document.getElementById("qINF").value = "0";
  app.refreshPaxUI();
  app.document.getElementById("itin").value = raw;
  app.document.getElementById("maskADT").value = raw;
  app.document.getElementById("fldRC").value = "10";
  app.setFxRate(5.1695, { source: "BCB" }, false);
  app.build();

  // RC de USD 10 a 5,1695 da 51,695: o motor arredonda por passageiro antes de multiplicar.
  assert.equal(app._lastQuote.totals.group.rcTotal, 155.10);
  assert.equal(app._lastQuote.totals.group.grandTotal, 44826.60);

  const preview = app.document.getElementById("preview").textContent.replace(/\s+/g, " ");
  const idx = preview.indexOf("Total estimado do grupo");
  assert.ok(idx >= 0);
  const trecho = preview.slice(idx, idx + 50);
  // Antes da correcao o e-mail mostrava 44.826,58 e a tela 44.826,60.
  assert.match(trecho, /44\.826,60/);
  assert.doesNotMatch(trecho, /44\.826,58/);
  assert.equal(
    app.document.getElementById("kTotal").textContent,
    app.moneyBRL(app._lastQuote.totals.group.grandTotal)
  );
  app.close();
});

test("buildEmail nao le o DOM: pagamento viaja pelo modelo", () => {
  const app = createApp();
  const raw = fixture("sabre_origem_exterior_eur_virada_ano.txt");
  app.document.getElementById("itin").value = raw;
  app.document.getElementById("maskADT").value = raw;
  app.document.getElementById("payCartao").checked = true;
  app.document.getElementById("payParcel").value = "6x";
  app.build();

  assert.deepEqual(
    Array.from(app._lastQuote.commercial.payment.methods),
    ["Cartão de crédito (6x sem juros)"]
  );
  assert.match(app.document.getElementById("preview").textContent, /6x sem juros/);

  // Reexecutar buildEmail com o modelo salvo, apos mexer no DOM, deve dar o mesmo HTML
  // e nao pode escrever na tela.
  app.document.getElementById("payCartao").checked = false;
  app.document.getElementById("subjectPill").textContent = "sentinela";
  const again = app.buildEmail(app._lastQuote);
  assert.equal(again.html, app.document.getElementById("preview").dataset.html);
  assert.equal(app.document.getElementById("subjectPill").textContent, "sentinela");
  app.close();
});

test("createQuoteModel entrega apenas fareDisplay em totals", () => {
  const app = createApp();
  const raw = fixture("sabre_origem_exterior_eur_virada_ano.txt");
  app.document.getElementById("itin").value = raw;
  app.document.getElementById("maskADT").value = raw;
  app.build();
  // applyTotalsByPax e a unica fonte dos totais; o modelo cru so carrega o rotulo do KPI.
  assert.match(app._lastQuote.totals.fareDisplay, /\(ADT\)/);
  assert.ok(app._lastQuote.totals.byType);
  assert.ok(app._lastQuote.totals.group);
  app.close();
});

// ─── Passo 7: Assentos chega ao e-mail ────────────────────────────────────────

test("assentos no modo padrao aparece no bloco de condicoes", () => {
  const app = createApp();
  const raw = fixture("sabre_origem_exterior_eur_virada_ano.txt");
  app.document.getElementById("itin").value = raw;
  app.document.getElementById("maskADT").value = raw;
  app.document.getElementById("fldAssentosMode").value = "padrao";
  app.build();

  const preview = app.document.getElementById("preview").textContent;
  assert.match(preview, /Assentos/);
  assert.match(preview, /Marca[çc][ãa]o antecipada mediante pagamento/);
  app.close();
});

test("assentos em texto livre aparece no e-mail", () => {
  const app = createApp();
  const raw = fixture("sabre_origem_exterior_eur_virada_ano.txt");
  app.document.getElementById("itin").value = raw;
  app.document.getElementById("maskADT").value = raw;
  app.document.getElementById("fldAssentosMode").value = "custom";
  app.document.getElementById("fldAssentosCustom").value = "Corredor confirmado na ida";
  app.build();
  assert.match(app.document.getElementById("preview").textContent, /Corredor confirmado na ida/);
  app.close();
});

test("assentos nao informado fica fora do e-mail", () => {
  const app = createApp();
  const raw = fixture("sabre_origem_exterior_eur_virada_ano.txt");
  app.document.getElementById("itin").value = raw;
  app.document.getElementById("maskADT").value = raw;
  app.document.getElementById("fldAssentosMode").value = "";
  app.build();
  assert.doesNotMatch(app.document.getElementById("preview").textContent, /Assentos/);
  app.close();
});

// ─── Passo 8: consulta de cambio BCB ──────────────────────────────────────────

test("prefere o boletim de Fechamento PTAX quando ha boletins intermediarios", async () => {
  const app = createApp();
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      value: [
        { tipoBoletim: "Abertura",        cotacaoCompra: 5.0000, cotacaoVenda: 5.0010 },
        { tipoBoletim: "Fechamento PTAX", cotacaoCompra: 5.1689, cotacaoVenda: 5.1695 },
        { tipoBoletim: "Intermediario",   cotacaoCompra: 5.2000, cotacaoVenda: 5.2010 }
      ]
    })
  });

  const quote = await app.fetchBcbUsdRateForUsageDate(new Date(Date.UTC(2026, 5, 9)), fakeFetch);
  // Sem a preferencia explicita cairia no ultimo item, 5.2010.
  assert.equal(quote.rate, 5.1695);
  app.close();
});

test("usa o ultimo boletim quando nenhum e Fechamento PTAX", async () => {
  const app = createApp();
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ value: [{ cotacaoCompra: 5.1689, cotacaoVenda: 5.1695 }] })
  });
  const quote = await app.fetchBcbUsdRateForUsageDate(new Date(Date.UTC(2026, 5, 9)), fakeFetch);
  assert.equal(quote.rate, 5.1695);
  app.close();
});

test("ambiente sem fetch nao quebra a consulta de cambio", async () => {
  const app = createApp();
  // jsdom nao expoe window.fetch: a camada com cache deve degradar para null.
  assert.equal(typeof app.fetch, "undefined");
  const entry = await app.fetchBcbUsdRateCached();
  assert.equal(entry, null);
  // E o autofill nao deve mexer no campo nem lancar.
  const result = await app.maybeAutofillFx();
  assert.equal(result, null);
  assert.equal(app.document.getElementById("fldFX").value, "");
  app.close();
});

test("autofill preserva cambio digitado a mao e o vindo da mascara GDS", async () => {
  const app = createApp();
  const fx = app.document.getElementById("fldFX");

  // Valor manual precisa sobreviver.
  fx.value = "5,0000";
  fx.dataset.source = "MANUAL";
  assert.equal(await app.maybeAutofillFx(), null);
  assert.equal(fx.value, "5,0000");

  // Valor lido da mascara GDS tambem.
  app.setFxRate(5.3333, { source: "GDS" }, false);
  assert.equal(await app.maybeAutofillFx(), null);
  assert.equal(fx.dataset.source, "GDS");
  app.close();
});

test("cache do cambio guarda e reusa a cotacao do dia", async () => {
  const app = createApp();
  const cacheKey = "bcb_fx_cache_v1";
  const dayKey = app.formatDateForBcb(app.getSaoPauloUsageDate());
  app.localStorage.setItem(cacheKey, JSON.stringify({
    USD: { rate: 5.4321, source: "BCB", baseDate: "08/06/2026", usageDate: "09/06/2026", dayKey }
  }));

  // Mesmo sem fetch disponivel, o cache do dia deve ser aproveitado.
  const entry = await app.fetchBcbUsdRateCached();
  assert.ok(entry, "deveria reusar o cache do dia");
  assert.equal(entry.rate, 5.4321);
  app.close();
});

test("cache de outro dia nao e reaproveitado", async () => {
  const app = createApp();
  app.localStorage.setItem("bcb_fx_cache_v1", JSON.stringify({
    USD: { rate: 9.9999, source: "BCB", baseDate: "01/01/2020", usageDate: "02/01/2020", dayKey: "01-01-2020" }
  }));
  // Chave de dia diferente: precisa tentar a rede, que nao existe aqui, e devolver null.
  assert.equal(await app.fetchBcbUsdRateCached(), null);
  app.close();
});

// ─── Acabamento visual: câmbio sempre em vírgula decimal ──────────────────────

test("campo de cambio usa virgula decimal, igual ao resto da interface", () => {
  const app = createApp();
  app.setFxRate(5.1695, { source: "BCB", baseDate: "03/10/2026", usageDate: "06/10/2026" }, false);
  const valor = app.document.getElementById("fldFX").value;
  assert.equal(valor, "5,1695");
  // E o valor com virgula precisa ser reconhecido de volta pelo parser.
  assert.equal(app.parseAmountAny(valor), 5.1695);
  app.close();
});

// ─── Moeda da tarifa: ler o codigo ISO que o GDS imprime ──────────────────────
// A moeda nao pode ser deduzida da origem: BKK sai em THB, mas o Brasil costuma
// sair em USD para rotas internacionais. A unica fonte confiavel e a mascara.

test("le tarifa em THB com indicador de tipo na linha FARE", () => {
  const app = createApp();
  const price = app.parsePricingAmadeus(fixture("amadeus_thb_origem_bkk_tst.txt"));

  // Antes da correcao a moeda e o valor saiam nulos, porque o parser exigia o
  // codigo ISO imediatamente apos FARE e aqui vem "FARE  F THB".
  assert.equal(price.fareCur, "THB");
  assert.equal(price.fareAmt, 42535);
  assert.equal(price.equivBRL, 6634.91);
  assert.equal(price.taxesBRL, 1629.24);
  assert.equal(price.totalBRL, 8264.15);
  app.close();
});

test("indicador de tipo na linha FARE nao quebra os formatos ja suportados", () => {
  const app = createApp();
  // Sem indicador, formato classico.
  const semIndicador = app.parsePricingAmadeus(fixture("amadeus_tarifa_fxp.txt"));
  assert.equal(semIndicador.fareCur, "USD");
  assert.equal(semIndicador.fareAmt, 500);

  // "FARE BASIS" e "FARE FAMILIES" nao podem ser confundidos com linha de tarifa.
  const armadilha = app.parsePricingAmadeus([
    "FARE BASIS QLTSL58E",
    "FARE FAMILIES:    (ENTER FQFn FOR DETAILS)",
    "EUR 1200.00",
    "BRL 7200.00 NUC1200.00END ROE1.00",
    "BRL 7200.00"
  ].join("\n"));
  assert.equal(armadilha.fareCur, "EUR");
  assert.equal(armadilha.fareAmt, 1200);
  app.close();
});

test("conferencia de taxas reconhece o formato TXnnn", () => {
  const app = createApp();
  const price = app.parsePricingAmadeus(fixture("amadeus_thb_origem_bkk_tst.txt"));

  // As sete taxas TXnnn somam exatamente total menos equivalente, entao a
  // leitura esta conferida e nao deve gerar aviso de taxa inferida.
  assert.equal(price.taxLinesBRL, 1629.24);
  assert.equal(price.taxesSource, "DERIVED_DIFF_CORROBORATED");

  const app2 = createApp();
  app2.document.getElementById("itin").value = fixture("amadeus_pnr_simples.txt");
  app2.document.getElementById("maskADT").value = fixture("amadeus_thb_origem_bkk_tst.txt");
  app2.build();
  const avisos = app2._lastQuote.meta.warnings;
  assert.equal(avisos.some(w => /inferid/i.test(w)), false,
    `nao deveria avisar sobre valor inferido: ${JSON.stringify(avisos)}`);
  assert.equal(avisos.some(w => /moeda da tarifa/i.test(w)), false,
    `nao deveria avisar sobre moeda: ${JSON.stringify(avisos)}`);
  app.close();
  app2.close();
});

test("avisa quando a moeda da tarifa nao e lida, em vez de enviar em branco", () => {
  const app = createApp();
  // Mascara com valores em BRL legiveis, mas sem nenhuma linha de moeda original.
  const mask = [
    "EQUIV   BRL    6634.91",
    "TOTAL   BRL    8264.15",
    "GRAND TOTAL BRL    8264.15"
  ].join("\n");
  const price = app.parsePricingAmadeus(mask);
  assert.equal(price.fareCur, null);
  assert.equal(price.equivBRL, 6634.91);

  app.document.getElementById("itin").value = fixture("amadeus_pnr_simples.txt");
  app.document.getElementById("maskADT").value = mask;
  app.build();
  assert.ok(
    app._lastQuote.meta.warnings.some(w => /moeda da tarifa não identificada/i.test(w)),
    "a falha de leitura da moeda precisa aparecer na tela"
  );
  app.close();
});

// ─── Identidade RexturAdvance no e-mail ───────────────────────────────────────

test("e-mail carrega a identidade da marca", () => {
  const app = createApp();
  const raw = fixture("sabre_origem_exterior_eur_virada_ano.txt");
  app.document.getElementById("itin").value = raw;
  app.document.getElementById("maskADT").value = raw;
  app.build();

  const html = app.document.getElementById("preview").dataset.html;
  // Navy do logo no cabecalho.
  assert.match(html, /#002554/);
  // Nome da marca acima do titulo.
  assert.match(html, /RexturAdvance/);
  // Filete com as quatro cores do laco, em celulas solidas que o Outlook aceita.
  for(const cor of ["#ed458f", "#8c4593", "#04a8db", "#f2a75e"]){
    assert.match(html, new RegExp(cor), `filete da marca sem a cor ${cor}`);
  }
  app.close();
});

test("cor de marca nao substitui cor de estado no e-mail", () => {
  const app = createApp();
  const [itinRaw, maskRaw] = fixtureBlocks("amadeus_arnk_surface_bio.txt");
  app.document.getElementById("itin").value = itinRaw;
  app.document.getElementById("maskADT").value = maskRaw;
  app.build();

  const html = app.document.getElementById("preview").dataset.html;
  // O trecho sem bagagem precisa seguir em vermelho de alerta, e nao em cor da
  // marca: e sinal de risco, nao identidade. Se virar magenta, a agencia perde
  // a leitura de que algo exige atencao.
  assert.match(html, /#a8321f/);
  assert.doesNotMatch(html, /Sem Bag<\/td>[\s\S]{0,40}#ed458f/);
  app.close();
});

// ─── Portal NDC (eLATAM e similares) ─────────────────────────────────────────
// Portais de companhia nao devolvem mascara de texto: a tela e HTML. Os dados
// chegam transcritos em campos estruturados, mas desembocam no MESMO modelo.

const ITIN_NDC = [
  "AZ675 W GRU FCO 10FEV27 1545 0705+1 339",
  "AZ202 W FCO LHR 11FEV27 0750 0940 32N",
  "ARNK",
  "LH2227 T CDG MUC 24FEV27 0910 1035 32N",
  "LH504 T MUC GRU 24FEV27 1155 2025 359"
].join("\n");

function preencheNdc(app, { moeda = "USD", rate = "5,2238" } = {}) {
  const set = (id, v) => { app.document.getElementById(id).value = v; };
  set("fldFonte", "ndc");
  app.refreshSourceUI();
  set("itin", ITIN_NDC);
  set("ndcCarrier", "AZ");
  set("ndcFareCur", moeda);
  set("ndcRate", rate);
  set("ndcBag", "1PC");
  set("ndcFareADT", "1039.00");
  set("ndcEquivADT", "5427.52");
  set("ndcTaxesADT", "848.03");
  set("ndcTotalADT", "6275.55");
}

test("converte horario de 12 horas do portal para 24 horas", () => {
  const app = createApp();
  assert.equal(app.ndcTime12to24("03:45p"), "1545");
  assert.equal(app.ndcTime12to24("07:05a"), "0705");
  assert.equal(app.ndcTime12to24("08:25p"), "2025");
  // Meia-noite e meio-dia sao os casos onde conversao ingenua erra.
  assert.equal(app.ndcTime12to24("12:30a"), "0030");
  assert.equal(app.ndcTime12to24("12:15p"), "1215");
  assert.equal(app.ndcTime12to24("abacaxi"), null);
  app.close();
});

test("le itinerario do portal com virada de dia e trecho terrestre", () => {
  const app = createApp();
  const segs = app.parseNdcItinerary(ITIN_NDC, 2027);

  assert.equal(segs.length, 5);
  assert.equal(segs[2].surface, true);
  assert.deepEqual(
    Array.from(segs.filter(s => !s.surface), s => `${s.airline}${s.flight} ${s.org}-${s.dst}`),
    ["AZ675 GRU-FCO", "AZ202 FCO-LHR", "LH2227 CDG-MUC", "LH504 MUC-GRU"]
  );
  // Sai 10/02 as 15:45 e chega 11/02 as 07:05: o +1 precisa virar a data.
  assert.equal(segs[0].depDateFmt, "10/02/2027");
  assert.equal(segs[0].depTimeFmt, "15:45");
  assert.equal(segs[0].arrDateFmt, "11/02/2027");
  assert.equal(segs[0].arrTimeFmt, "07:05");
  assert.equal(segs[0].arrDayOffset, 1);
  assert.equal(segs[0].equipment, "339");
  app.close();
});

test("rota do portal preserva o open jaw entre LHR e CDG", () => {
  const app = createApp();
  const segs = app.parseNdcItinerary(ITIN_NDC, 2027);
  assert.equal(app.buildRouteString(segs), "GRU-FCO-LHR // CDG-MUC-GRU");
  app.close();
});

test("valores do portal entram como lidos, nao como inferidos", () => {
  const app = createApp();
  const pr = app.buildNdcPricing({
    fareCur: "USD", fareAmt: "1039.00",
    equivBRL: "5427.52", taxesBRL: "848.03", totalBRL: "6275.55", bag: "1PC"
  });
  assert.equal(pr.fareCur, "USD");
  assert.equal(pr.fareAmt, 1039);
  assert.equal(pr.equivBRL, 5427.52);
  assert.equal(pr.taxesBRL, 848.03);
  assert.equal(pr.totalBRL, 6275.55);
  assert.equal(pr.bag, "1PC");
  // A tela mostra o total de taxas explicito, entao e leitura e nao subtracao.
  assert.equal(pr.taxesSource, "READ");
  assert.equal(pr.totalSource, "NDC_MANUAL");
  app.close();
});

test("total ausente no portal e somado, nao inferido", () => {
  const app = createApp();
  const pr = app.buildNdcPricing({
    fareCur: "USD", fareAmt: "1039", equivBRL: "5427.52", taxesBRL: "848.03", totalBRL: ""
  });
  assert.equal(pr.totalBRL, 6275.55);
  assert.equal(pr.totalSource, "NDC_MANUAL");
  app.close();
});

test("gera cotacao completa a partir do portal NDC", () => {
  const app = createApp();
  preencheNdc(app);
  app.document.getElementById("fldRC").value = "25";
  app.build();

  const q = app._lastQuote;
  assert.equal(q.meta.gds, "NDC");
  assert.equal(app.document.getElementById("gdsDetected").textContent, "Portal NDC");
  assert.equal(q.totals.group.grandTotal, 6406.14);   // 6275.55 + RC 130.59
  assert.equal(q.meta.confidence, "HIGH");
  assert.deepEqual(Array.from(q.meta.warnings), []);
  assert.match(app.document.getElementById("subjectPill").textContent, /GRU-FCO-LHR \/\/ CDG-MUC-GRU/);
  app.close();
});

test("companhia validadora aparece no e-mail", () => {
  const app = createApp();
  preencheNdc(app);
  app.build();
  const preview = app.document.getElementById("preview").textContent;
  assert.match(preview, /Companhia validadora/);
  app.close();
});

test("cambio do portal so alimenta o RC quando a tarifa e em USD", () => {
  // A taxa da tela converte a MOEDA DA TARIFA para BRL. Usa-la com tarifa em
  // outra moeda calcularia o RC errado, que foi o risco visto no caso THB.
  const comUsd = createApp();
  preencheNdc(comUsd, { moeda: "USD" });
  comUsd.document.getElementById("fldRC").value = "25";
  comUsd.build();
  assert.equal(comUsd.document.getElementById("fldFX").value, "5,2238");
  assert.equal(comUsd._lastQuote.totals.byType.ADT.rcPerPax, 130.59);
  comUsd.close();

  for (const moeda of ["EUR", "THB"]) {
    const app = createApp();
    preencheNdc(app, { moeda });
    app.document.getElementById("fldRC").value = "25";
    app.build();
    assert.equal(app.document.getElementById("fldFX").value, "",
      `câmbio do portal nao deveria ser aceito com tarifa em ${moeda}`);
    assert.ok(app._lastQuote.meta.warnings.some(w => /câmbio não encontrado/i.test(w)),
      `deveria avisar falta de câmbio com tarifa em ${moeda}`);
    app.close();
  }
});

test("modo portal nao exige mascara de GDS", () => {
  const app = createApp();
  preencheNdc(app);
  const issues = app.validateQuoteInput();
  assert.equal(issues.some(i => /máscara/i.test(i.message)), false,
    `nao deveria cobrar mascara no modo portal: ${JSON.stringify(issues)}`);
  app.close();
});

test("modo GDS segue exigindo mascara", () => {
  const app = createApp();
  app.document.getElementById("itin").value = fixture("amadeus_pnr_simples.txt");
  const issues = app.validateQuoteInput();
  assert.ok(issues.some(i => i.id === "maskADT"),
    "o modo GDS precisa continuar cobrando a mascara do ADT");
  app.close();
});

// ─── eLATAM em modo texto, com RAV embutida como DU ──────────────────────────

const FIX_ELATAM = "elatam_texto_la_cwb_mia_rav_du.txt";

test("le itinerario do eLATAM em modo texto", () => {
  const app = createApp();
  const [itinRaw] = fixtureBlocks(FIX_ELATAM);
  const segs = app.parseElatamItinerary(itinRaw, 2027);

  assert.equal(segs.length, 4);
  assert.deepEqual(
    Array.from(segs, s => `${s.airline}${s.flight} ${s.rbd} ${s.org}-${s.dst}`),
    ["LA3065 N CWB-CGH", "LA8190 N GRU-MIA", "LA8191 N MIA-GRU", "LA4538 N GRU-CWB"]
  );
  // Chegada em data diferente da partida equivale a offset de um dia.
  assert.equal(segs[1].arrDayOffset, 1);
  assert.equal(segs[1].depTimeFmt, "23:00");
  assert.equal(segs[1].arrTimeFmt, "05:25");
  assert.equal(segs[0].arrDayOffset, 0);
  // A linha de continuacao da a companhia operadora.
  assert.equal(segs[0].opName, "LATAM AIRLINES BRASIL");
  app.close();
});

test("rota do eLATAM marca a troca de aeroporto em Sao Paulo", () => {
  const app = createApp();
  const [itinRaw] = fixtureBlocks(FIX_ELATAM);
  const segs = app.parseElatamItinerary(itinRaw, 2027);
  // Chega em CGH e parte de GRU: uma descontinuidade. O ultimo trecho parte de
  // onde o anterior chegou, entao e continuo.
  assert.equal(app.buildRouteString(segs), "CWB-CGH // GRU-MIA-GRU-CWB");
  app.close();
});

test("separa a RAV das taxas usando o codigo DU", () => {
  const app = createApp();
  const [, tarifaRaw] = fixtureBlocks(FIX_ELATAM);
  const pr = app.parseElatamPricing(tarifaRaw);

  assert.equal(pr.fareCur, "USD");
  assert.equal(pr.fareAmt, 1552);
  assert.equal(pr.equivBRL, 7738.11);
  assert.equal(pr.totalBRL, 8809.13);

  // O portal imprime 1071.02 de taxas, dos quais 541.66 sao RAV (DU).
  assert.equal(pr.taxesPrintedBRL, 1071.02);
  assert.equal(pr.ravBRL, 541.66);
  assert.equal(pr.taxesBRL, 529.36);

  // O total que o cliente paga nao muda com a separacao.
  assert.equal(+(pr.equivBRL + pr.taxesBRL + pr.ravBRL).toFixed(2), pr.totalBRL);
  app.close();
});

test("conferencia do detalhamento de taxas prova a leitura", () => {
  const app = createApp();
  const [, tarifaRaw] = fixtureBlocks(FIX_ELATAM);
  const pr = app.parseElatamPricing(tarifaRaw);

  assert.equal(pr.taxBreakdown.length, 9);
  assert.equal(pr.taxLinesBRL, 1071.02);
  // A soma dos nove codigos fecha com o total impresso, entao a leitura confere.
  assert.equal(pr.taxesSource, "READ");
  assert.equal(pr.bag, "1PC");
  app.close();
});

test("detalhamento que nao fecha marca a leitura como nao conferida", () => {
  const app = createApp();
  // Um digito alterado no XT faz a soma divergir do total impresso.
  const ruim = [
    "1-  1552.00USD  7738.11BRL                   1071.02                8809.13BRL",
    "XT          84.38BR 68.61BR 541.66DU 999.99US"
  ].join("\n");
  const pr = app.parseElatamPricing(ruim);
  assert.equal(pr.taxesSource, "READ_UNVERIFIED");
  app.close();
});

test("ano e deduzido como viagem futura quando o texto nao traz ano", () => {
  const app = createApp();
  // Em outubro de 2026, um voo de fevereiro pertence a 2027.
  const outubro = new Date(2026, 9, 6);
  assert.equal(app.anoParaDataSemAno("10FEV", outubro), 2027);
  assert.equal(app.anoParaDataSemAno("20DEZ", outubro), 2026);
  // Data de hoje nao deve ser empurrada para o ano seguinte.
  assert.equal(app.anoParaDataSemAno("06OUT", outubro), 2026);
  app.close();
});

test("colar o texto do portal preenche os campos e a RAV chega ao e-mail", () => {
  const app = createApp();
  app.document.getElementById("fldFonte").value = "ndc";
  app.refreshSourceUI();
  app.document.getElementById("ndcPaste").value = fixtureAll(FIX_ELATAM);
  app.applyElatamPaste({ announce: false });

  // Itinerario reescrito no formato de uma linha por voo.
  const linhas = app.document.getElementById("itin").value.split("\n");
  assert.equal(linhas.length, 4);
  assert.match(linhas[0], /^LA3065 N CWB CGH \d{2}FEV\d{2} 1340 1440$/);
  assert.match(linhas[1], /0525\+1$/);

  // Campos de valor preenchidos, com a RAV ja descontada das taxas.
  assert.equal(app.document.getElementById("ndcFareCur").value, "USD");
  assert.equal(app.document.getElementById("ndcTaxesADT").value, "529.36");
  assert.equal(app.document.getElementById("ndcTotalADT").value, "8809.13");
  // Cambio implicito: equivalente dividido pela tarifa em USD.
  assert.equal(app.document.getElementById("ndcRate").value, "4,9859");

  app.document.getElementById("ndcCarrier").value = "LA";
  app.build();

  const bt = app._lastQuote.totals.byType.ADT;
  assert.equal(bt.taxesPerPax, 529.36);
  assert.equal(bt.ravPerPax, 541.66);
  assert.equal(bt.totalPerPax, 8809.13);
  assert.equal(app._lastQuote.totals.group.ravTotal, 541.66);

  // A separacao nao pode gerar aviso de total que nao fecha.
  assert.deepEqual(Array.from(app._lastQuote.meta.warnings), []);
  assert.equal(app._lastQuote.meta.confidence, "HIGH");

  // E a RAV aparece em coluna propria no e-mail.
  const preview = app.document.getElementById("preview").textContent;
  assert.match(preview, /RAV \(BRL\)/);
  assert.match(preview, /A RAV está destacada das taxas/);
  app.close();
});

test("cotacao sem RAV nao ganha coluna de RAV", () => {
  const app = createApp();
  const raw = fixture("sabre_origem_exterior_eur_virada_ano.txt");
  app.document.getElementById("itin").value = raw;
  app.document.getElementById("maskADT").value = raw;
  app.build();
  assert.doesNotMatch(app.document.getElementById("preview").textContent, /RAV \(BRL\)/);
  app.close();
});

// ─── Leitura por imagem: a confirmacao dos voos e obrigatoria ─────────────────
// Medicao nas capturas reais: o bloco de tarifa saiu 13/13, mas o itinerario
// perdeu todos os numeros de voo. As taxas tem conta que as verifique; os
// numeros de voo nao tem. Dai a confirmacao explicita.

test("confirmacao de voos bloqueia a copia e libera ao confirmar", () => {
  const app = createApp();
  app.document.getElementById("fldFonte").value = "ndc";
  app.refreshSourceUI();
  app.document.getElementById("ndcPaste").value = fixtureAll(FIX_ELATAM);
  app.applyElatamPaste({ announce: false });
  app.build();

  // Antes de simular leitura por imagem, nada bloqueia.
  assert.equal(app.voosPendentesDeConfirmacao(), false);

  // Itinerario vindo de imagem passa a exigir confirmacao.
  app.exigeConfirmacaoDeVoos(true);
  assert.equal(app.voosPendentesDeConfirmacao(), true);
  assert.equal(app.document.getElementById("ocrConfirmWrap").style.display, "");

  // Marcar a confirmacao libera.
  app.document.getElementById("ocrConfirmado").checked = true;
  assert.equal(app.voosPendentesDeConfirmacao(), false);
  app.close();
});

test("editar o itinerario a mao invalida a confirmacao anterior", () => {
  const app = createApp();
  app.document.getElementById("fldFonte").value = "ndc";
  app.refreshSourceUI();
  app.exigeConfirmacaoDeVoos(true);
  app.document.getElementById("ocrConfirmado").checked = true;
  assert.equal(app.voosPendentesDeConfirmacao(), false);

  // Mexer no itinerario depois de confirmar precisa pedir confirmacao de novo.
  const itin = app.document.getElementById("itin");
  itin.value = "LA3065 N CWB CGH 10FEV27 1340 1440";
  itin.dispatchEvent(new app.Event("input", { bubbles: true }));
  assert.equal(app.voosPendentesDeConfirmacao(), true);
  app.close();
});

test("leitura por imagem indisponivel nao impede o uso manual", async () => {
  const app = createApp();
  app.document.getElementById("fldFonte").value = "ndc";
  app.refreshSourceUI();

  // Motor falso que falha de imediato, simulando CDN bloqueado sem esperar o
  // tempo limite real de 20 segundos.
  app.Tesseract = { recognize: () => Promise.reject(new Error("rede bloqueada")) };

  let lancou = false;
  try {
    await app.lerImagemDoPortal(new app.Blob(["nao e imagem"], { type: "image/png" }));
  } catch (e) { lancou = true; }
  assert.equal(lancou, false, "a falha de OCR nao pode propagar excecao");

  // O aviso precisa explicar o caminho alternativo.
  const aviso = app.document.getElementById("ocrAviso").textContent;
  assert.match(aviso, /colar o texto/i);

  // E o caminho manual segue funcionando.
  app.document.getElementById("ndcPaste").value = fixtureAll(FIX_ELATAM);
  app.applyElatamPaste({ announce: false });
  assert.equal(app.document.getElementById("ndcTotalADT").value, "8809.13");
  app.close();
});

test("soma de taxas que nao fecha derruba a confiabilidade e avisa", () => {
  const app = createApp();
  app.document.getElementById("fldFonte").value = "ndc";
  app.refreshSourceUI();

  // Mesmo texto do exemplo, com UM digito trocado, como um OCR ruim faria:
  // 233.34 vira 283.34. A soma passa a dar 1121.02 contra 1071.02 impresso.
  const corrompido = fixtureAll(FIX_ELATAM).replace("233.34", "283.34");
  app.document.getElementById("ndcPaste").value = corrompido;
  app.applyElatamPaste({ announce: false });
  app.build();

  const avisos = app._lastQuote.meta.warnings;
  assert.ok(avisos.some(w => /soma das taxas n[ãa]o fecha/i.test(w)),
    `deveria avisar que a soma nao fecha: ${JSON.stringify(avisos)}`);
  assert.notEqual(app._lastQuote.meta.confidence, "HIGH",
    "leitura nao conferida nao pode manter confiabilidade alta");
  app.close();
});

test("leitura correta nao dispara o aviso de soma", () => {
  const app = createApp();
  app.document.getElementById("fldFonte").value = "ndc";
  app.refreshSourceUI();
  app.document.getElementById("ndcPaste").value = fixtureAll(FIX_ELATAM);
  app.applyElatamPaste({ announce: false });
  app.build();
  assert.equal(
    app._lastQuote.meta.warnings.some(w => /soma das taxas/i.test(w)),
    false
  );
  app.close();
});
