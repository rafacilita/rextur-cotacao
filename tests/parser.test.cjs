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
    // Regex restrita a taxa/total inferido: RBD das fixtures pode inferir
    // cabine com confianca, e esse aviso e esperado, nao um bug de taxa.
    assert.equal(
      warnings.some(w => /taxas inferidas|o total não veio de uma linha/i.test(w)),
      false,
      `${name} nao deveria gerar aviso de taxa ou total inferido, mas gerou: ${JSON.stringify(warnings)}`
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
  // Regex restrita a taxa/total inferido (nao "inferid" generico): o fixture
  // tem RBD que infere cabine com confianca, e esse aviso e esperado, nao um bug.
  assert.equal(avisos.some(w => /taxas inferidas|o total não veio de uma linha/i.test(w)), false,
    `nao deveria avisar sobre taxa ou total inferido: ${JSON.stringify(avisos)}`);
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

// ─── Equipamento da aeronave ─────────────────────────────────────────────────

test("tabela de equipamentos traduz os codigos conhecidos", () => {
  const app = createApp();
  const esperado = {
    "319": "Airbus A319", "320": "Airbus A320", "321": "Airbus A321",
    "32N": "Airbus A320neo", "32Q": "Airbus A321neo",
    "332": "Airbus A330-200", "333": "Airbus A330-300", "339": "Airbus A330-900neo",
    "351": "Airbus A350-1000", "359": "Airbus A350-900", "388": "Airbus A380-800",
    "738": "Boeing 737-800", "739": "Boeing 737-900",
    "73M": "Boeing 737 MAX 8", "73J": "Boeing 737 MAX 9",
    "772": "Boeing 777-200", "773": "Boeing 777-300", "77W": "Boeing 777-300ER",
    "788": "Boeing 787-8 Dreamliner", "789": "Boeing 787-9 Dreamliner",
    "78X": "Boeing 787-10 Dreamliner",
    "E90": "Embraer 190", "E95": "Embraer 195", "E29": "Embraer E195-E2",
    "CRJ": "Bombardier CRJ"
  };
  for (const [codigo, nome] of Object.entries(esperado)) {
    assert.equal(app.equipmentName(codigo), nome, `codigo ${codigo}`);
  }
  // Minuscula e espaco nao devem impedir a consulta.
  assert.equal(app.equipmentName(" 32n "), "Airbus A320neo");
  app.close();
});

test("codigo de equipamento desconhecido nao e inventado", () => {
  const app = createApp();
  // Codigo fora da tabela devolve null e o correto: o e-mail mostra o codigo
  // cru, rotulado, em vez de inventar um nome.
  assert.equal(app.equipmentName("XYZ"), null);
  assert.equal(app.equipmentName(""), null);
  assert.equal(app.equipmentName(null), null);
  app.close();
});

test("32B e CR9 confirmados pelo proprio GDS", () => {
  const app = createApp();
  // Confirmado por retorno real do Sabre (comando de equipamento da aeronave):
  // "32B AIRBUS INDUSTRIE A321 SHARKLETS" e "CR9 CANADAIR(BOMBARDIER)REGIONAL JET".
  assert.equal(app.equipmentName("32B"), "Airbus A321 com sharklets");
  assert.equal(app.equipmentName("CR9"), "Bombardier CRJ-900");
  app.close();
});

test("deteccao aceita codigo alfanumerico e rejeita estado de segmento", () => {
  const app = createApp();
  // Padroes com digito sao inequivocos.
  for (const ok of ["359", "737", "32N", "73M", "77W", "32B", "E90", "E29", "CR9"]) {
    assert.equal(app.pareceEquipamento(ok), true, `deveria aceitar ${ok}`);
  }
  // Estados de segmento tem o mesmo formato de CR9 e nao podem ser confundidos.
  for (const nao of ["HK1", "SS2", "DK2", "HL1", "UC1", "TK2"]) {
    assert.equal(app.pareceEquipamento(nao), false, `nao deveria aceitar ${nao}`);
  }
  // So letras: aceita apenas o que esta na tabela.
  assert.equal(app.pareceEquipamento("CRJ"), true);
  assert.equal(app.pareceEquipamento("ATR"), true);
  assert.equal(app.pareceEquipamento("MLS"), false);
  // Tamanho diferente de tres nunca e equipamento.
  for (const nao of ["20NOV", "E", "0", "LA/ABC123", "3590"]) {
    assert.equal(app.pareceEquipamento(nao), false, `nao deveria aceitar ${nao}`);
  }
  app.close();
});

test("le equipamento alfanumerico que antes era perdido", () => {
  const app = createApp();
  // Antes da correcao a deteccao exigia digitos puros, entao CR9 saia vazio.
  const [itinRaw] = fixtureBlocks("amadeus_arnk_surface_bio.txt");
  const segs = app.parseItinerary(itinRaw, "AMA", 2026);
  const aereos = segs.filter(s => !s.surface);
  assert.deepEqual(Array.from(aereos, s => s.equipment), ["359", "320", "CR9", "359"]);
  app.close();
});

test("le 32B nos quatro trechos do exemplo combinado", () => {
  const app = createApp();
  // Antes da correcao este exemplo lia apenas 2 dos 4 equipamentos.
  const itinRaw = fixtureAll("amadeus_fqq_combinado_eur.txt");
  const segs = app.parseItinerary(itinRaw, "AMA", 2026).filter(s => !s.surface);
  assert.deepEqual(Array.from(segs, s => s.equipment), ["32B", "359", "359", "32B"]);
  app.close();
});

test("itinerario sem equipamento no texto nao inventa equipamento", () => {
  const app = createApp();
  // Esta linha termina em "E  LA/ABC123", sem campo de equipamento.
  const [itinRaw] = fixtureBlocks("amadeus_pnr_simples.txt");
  const segs = app.parseItinerary(itinRaw, "AMA", 2026);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].equipment, null);
  app.close();
});

test("e-mail mostra o nome da aeronave para codigos conhecidos", () => {
  const app = createApp();
  const [itinRaw, maskRaw] = fixtureBlocks("amadeus_arnk_surface_bio.txt");
  app.document.getElementById("itin").value = itinRaw;
  app.document.getElementById("maskADT").value = maskRaw;
  app.build();

  const preview = app.document.getElementById("preview").textContent;
  // Codigo conhecido aparece como nome, sem o rotulo de codigo nem o numero cru.
  assert.match(preview, /Airbus A350-900/);
  assert.match(preview, /Airbus A320/);
  // CR9 foi confirmado pelo proprio GDS do usuario e ja tem nome na tabela.
  assert.match(preview, /Bombardier CRJ-900/);
  assert.doesNotMatch(preview, /Equipamento 359/);
  assert.doesNotMatch(preview, /Equip\. CR9/);
  app.close();
});

test("e-mail rotula codigo de equipamento fora da tabela", () => {
  const app = createApp();
  // ZZ1 nao existe na tabela oficial: serve so para provar o fallback.
  const itin = [
    "1  IB6830 Q 20SEP 7*GRUMAD HK1  2210 1215  21SEP  E  0 359",
    "2  IB3100 Q 21SEP 1*MADVLC HK1  1400 1510  21SEP  E  0 ZZ1"
  ].join("\n");
  app.document.getElementById("itin").value = itin;
  app.document.getElementById("maskADT").value = fixture("amadeus_tarifa_fxp.txt");
  app.build();

  const preview = app.document.getElementById("preview").textContent;
  assert.match(preview, /Airbus A350-900/);
  // Codigo fora da tabela aparece cru, mas rotulado como codigo.
  assert.match(preview, /Equip\. ZZ1/);
  app.close();
});

// ─── Bagagem direcional do Sabre ──────────────────────────────────────────────
// Reportado pelo usuario: o PQ declara franquia por COMPONENTE TARIFARIO
// ("BAG ALLOWANCE -GRUJFK-01P/..."), nao por trecho fisico. A leitura por linha
// numerada so acerta o ultimo trecho de cada componente, e repetir esse valor
// para os demais produzia 2PC nos tres trechos quando o correto era 1PC/1PC/2PC.

test("le franquias direcionais BAG ALLOWANCE, ignorando bagagem de mao e tarifa de bagagem extra", () => {
  const app = createApp();
  const raw = fixtureAll("sabre_bag_allowance_direcional_aa.txt");
  const direcionais = app.parseSabreDirectionalBagAllowances(raw);

  assert.deepEqual(
    Array.from(direcionais, d => `${d.from}-${d.to}:${d.bag}`),
    ["GRU-JFK:1PC", "JFK-GRU:2PC"]
  );
  // CARRY ON ALLOWANCE e 2NDCHECKED BAG FEE nao podem ser lidos como franquia.
  assert.equal(direcionais.length, 2);
  app.close();
});

test("distribui a franquia direcional pelos trechos aereos corretos", () => {
  const app = createApp();
  const raw = fixtureAll("sabre_bag_allowance_direcional_aa.txt");
  const segs = app.parseItinerary(raw, "SAB", 2026).filter(s => !s.surface);
  const direcionais = app.parseSabreDirectionalBagAllowances(raw);
  const resultado = app.assignDirectionalBagToSegments(direcionais, segs);

  // GRUJFK cobre dois trechos fisicos (GRU-MIA e MIA-JFK); JFKGRU cobre so um.
  assert.deepEqual(Array.from(resultado), ["1PC", "1PC", "2PC"]);
  app.close();
});

test("assignDirectionalBagToSegments recusa quando a cadeia nao bate, em vez de adivinhar", () => {
  const app = createApp();
  const segs = [{ org: "GRU", dst: "MIA" }, { org: "MIA", dst: "JFK" }, { org: "JFK", dst: "GRU" }];

  // Caso simples (so uma direcional): a funcao nao se aplica, devolve null.
  assert.equal(app.assignDirectionalBagToSegments([{ from: "GRU", to: "JFK", bag: "1PC" }], segs), null);

  // Origem da primeira direcional nao bate com o primeiro trecho.
  assert.equal(app.assignDirectionalBagToSegments(
    [{ from: "MAD", to: "JFK", bag: "1PC" }, { from: "JFK", to: "GRU", bag: "2PC" }], segs
  ), null);

  // Destino da direcional nunca e alcancado pela cadeia de trechos.
  assert.equal(app.assignDirectionalBagToSegments(
    [{ from: "GRU", to: "LHR", bag: "1PC" }, { from: "JFK", to: "GRU", bag: "2PC" }], segs
  ), null);

  // Sobra trecho sem direcional correspondente.
  assert.equal(app.assignDirectionalBagToSegments(
    [{ from: "GRU", to: "MIA", bag: "1PC" }], segs
  ), null);
  app.close();
});

test("gera a cotacao real da AA com a franquia correta por trecho", () => {
  const app = createApp();
  const raw = fixtureAll("sabre_bag_allowance_direcional_aa.txt");
  app.document.getElementById("itin").value = raw;
  app.document.getElementById("maskADT").value = raw;
  app.build();

  const q = app._lastQuote;
  // Antes da correcao, bagSegs saia ["2PC"] (so a linha numerada do trecho de
  // volta), e o preenchimento repetia esse valor nos tres trechos.
  assert.deepEqual(Array.from(q.pricing.ADT.bagSegs), ["1PC", "1PC", "2PC"]);
  assert.equal(q.pricing.ADT.bag, "VAR");
  assert.ok(q.meta.warnings.some(w => /franquia muda durante o itiner[áa]rio/i.test(w)));
  // Nenhum trecho ficou sem bagagem, entao esse aviso especifico nao deve aparecer.
  assert.equal(q.meta.warnings.some(w => /sem bagagem/i.test(w)), false);

  const linhas = Array.from(app.document.querySelectorAll("#preview tr"), tr => tr.textContent.replace(/\s+/g, " ").trim());
  assert.ok(linhas.some(l => /GRU.*MIA/.test(l) && /\b1PC\b/.test(l)));
  assert.ok(linhas.some(l => /MIA.*JFK/.test(l) && /\b1PC\b/.test(l)));
  assert.ok(linhas.some(l => /JFK.*GRU/.test(l) && /\b2PC\b/.test(l)));
  app.close();
});

test("bagagem manual override continua tendo prioridade sobre a franquia direcional", () => {
  const app = createApp();
  const raw = fixtureAll("sabre_bag_allowance_direcional_aa.txt");
  app.document.getElementById("itin").value = raw;
  app.document.getElementById("maskADT").value = raw;
  app.refreshPaxUI();
  app.document.getElementById("bagOvADT").value = "NIL";
  app.build();

  // O override manual precisa vencer tanto a leitura simples quanto a direcional.
  assert.deepEqual(Array.from(app._lastQuote.pricing.ADT.bagSegs), ["Sem Bag"]);
  app.close();
});

test("franquia direcional nao afeta Amadeus nem quebra fixtures sem bagagem direcional", () => {
  const app = createApp();
  // Fixtures Amadeus e Sabre ja existentes nao devem mudar de comportamento:
  // a correcao direcional so entra quando ha 2+ linhas BAG ALLOWANCE distintas.
  const raw = fixture("sabre_origem_exterior_eur_virada_ano.txt");
  app.document.getElementById("itin").value = raw;
  app.document.getElementById("maskADT").value = raw;
  app.build();
  assert.equal(app._lastQuote.meta.gds, "SAB");
  app.close();
});

// Contraponto do caso AA: aqui cada trecho e seu proprio componente tarifario,
// com quatro linhas numeradas e cada uma ja com seu codigo de bagagem. Trava
// que a correcao direcional nao interfere no caso simples por segmento.
test("le quatro franquias diferentes por segmento, sem ativar a correcao direcional", () => {
  const app = createApp();
  const raw = fixtureAll("sabre_bagagem_por_segmento_am_4trechos.txt");

  // Nao ha nenhuma linha BAG ALLOWANCE neste retorno.
  assert.deepEqual(Array.from(app.parseSabreDirectionalBagAllowances(raw)), []);

  app.document.getElementById("itin").value = raw;
  app.document.getElementById("maskADT").value = raw;
  app.build();

  const q = app._lastQuote;
  assert.deepEqual(Array.from(q.pricing.ADT.bagSegs), ["Sem Bag", "Sem Bag", "2PC", "1PC"]);
  assert.equal(q.pricing.ADT.bag, "VAR");

  assert.equal(q.pricing.ADT.fareCur, "USD");
  assert.equal(q.pricing.ADT.fareAmt, 2397);
  assert.equal(q.pricing.ADT.equivBRL, 11912.61);
  assert.equal(q.pricing.ADT.taxesBRL, 1108.22);
  assert.equal(q.pricing.ADT.totalBRL, 13020.83);

  assert.ok(q.meta.warnings.some(w => /franquia muda durante o itiner[áa]rio/i.test(w)));
  // Os DOIS trechos sem bagagem precisam ser citados juntos, nao so o primeiro.
  assert.ok(q.meta.warnings.some(w => /sem bagagem/i.test(w) && /GRU-MEX/.test(w) && /MEX-GDL/.test(w)));

  const linhas = Array.from(app.document.querySelectorAll("#preview tr"), tr => tr.textContent.replace(/\s+/g, " ").trim());
  assert.ok(linhas.some(l => /GRU.*MEX/.test(l) && /Sem Bag/.test(l)));
  assert.ok(linhas.some(l => /MEX.*GDL/.test(l) && /Sem Bag/.test(l)));
  assert.ok(linhas.some(l => /GDL.*MEX/.test(l) && /\b2PC\b/.test(l)));
  assert.ok(linhas.some(l => /MEX.*GRU/.test(l) && /\b1PC\b/.test(l)));
  app.close();
});

// ─── ADT + CHD + INF com franquia distinta por tipo (Sabre e Amadeus) ────────
// Reportado pelo usuario: o INF tem franquia PROPRIA, diferente de ADT/CHD, e
// isso expos dois defeitos reais no caminho combinado do Sabre, nenhum deles
// na leitura de bagagem em si.

const FIX_SABRE_3TIPOS = "sabre_adt_chd_inf_bagagem_distinta_am.txt";
const FIX_AMADEUS_3TIPOS = "amadeus_adt_chd_inf_bagagem_distinta_am.txt";

test("splitSabrePricingMasks nao deixa a secao WP*BAG vazar para o ultimo PQ", () => {
  const app = createApp();
  const [, maskRaw] = fixtureBlocks(FIX_SABRE_3TIPOS);
  const split = app.splitSabrePricingMasks(maskRaw);

  // Sem o corte, a secao WP*BAG (rotulada ADT-02) vazava para dentro da
  // mascara do INF, por ser o ultimo PQ do retorno. Nenhuma mascara deve
  // conter a secao WP*BAG.
  for (const tipo of ["ADT", "CHD", "INF"]) {
    assert.doesNotMatch(split.masks[tipo], /WP\*BAG/, `mascara ${tipo} nao deveria conter WP*BAG`);
    assert.doesNotMatch(split.masks[tipo], /BAG ALLOWANCE/, `mascara ${tipo} nao deveria conter BAG ALLOWANCE da secao WP`);
  }
  app.close();
});

test("INF tem franquia propria, diferente do ADT e do CHD, no Sabre combinado", () => {
  const app = createApp();
  const [itinRaw, maskRaw] = fixtureBlocks(FIX_SABRE_3TIPOS);
  const split = app.splitSabrePricingMasks(maskRaw);

  app.document.getElementById("itin").value = itinRaw;
  app.document.getElementById("qADT").value = "1";
  app.document.getElementById("qCHD").value = "1";
  app.document.getElementById("qINF").value = "1";
  app.refreshPaxUI();
  app.document.getElementById("maskADT").value = split.masks.ADT;
  app.document.getElementById("maskCHD").value = split.masks.CHD;
  app.document.getElementById("maskINF").value = split.masks.INF;
  app.build();

  const q = app._lastQuote;
  // ADT e CHD compartilham o mesmo padrao; o INF tem o seu PROPRIO, distinto.
  assert.deepEqual(Array.from(q.pricing.ADT.bagSegs), ["Sem Bag", "Sem Bag", "2PC", "1PC"]);
  assert.deepEqual(Array.from(q.pricing.CHD.bagSegs), ["Sem Bag", "Sem Bag", "2PC", "1PC"]);
  assert.deepEqual(Array.from(q.pricing.INF.bagSegs), ["1PC", "Sem Bag", "Sem Bag", "1PC"]);

  // O aviso do INF precisa nomear os trechos REAIS (MEX-GDL, GDL-MEX), nunca
  // um "trecho 6" ou "trecho 7" fantasma vindo da duplicacao de pagina do PQ.
  const avisosInf = q.meta.warnings.filter(w => w.startsWith("INF:"));
  assert.ok(avisosInf.some(w => /sem bagagem/i.test(w) && /MEX-GDL/.test(w) && /GDL-MEX/.test(w)));
  assert.equal(q.meta.warnings.some(w => /trecho \d/i.test(w)), false,
    `nao deveria haver trecho fantasma: ${JSON.stringify(q.meta.warnings)}`);

  assert.equal(q.pricing.ADT.totalBRL, 13020.83);
  assert.equal(q.pricing.CHD.totalBRL, 13020.83);
  assert.equal(q.pricing.INF.totalBRL, 2081.00);

  const linhas = Array.from(app.document.querySelectorAll("#preview tr"), tr => tr.textContent.replace(/\s+/g, " ").trim());
  const gruMex = linhas.find(l => /GRU.*MEX/.test(l) && /20\/04/.test(l));
  assert.match(gruMex, /Sem BagSem Bag1PC|Sem Bag\s*Sem Bag\s*1PC/);
  app.close();
});

test("bagSegs duplicado por quebra de pagina e cortado para o numero real de trechos", () => {
  const app = createApp();
  const [itinRaw, maskRaw] = fixtureBlocks(FIX_SABRE_3TIPOS);
  const split = app.splitSabrePricingMasks(maskRaw);

  app.document.getElementById("itin").value = itinRaw;
  app.document.getElementById("qADT").value = "1";
  app.document.getElementById("qCHD").value = "1";
  app.document.getElementById("qINF").value = "1";
  app.refreshPaxUI();
  app.document.getElementById("maskADT").value = split.masks.ADT;
  app.document.getElementById("maskCHD").value = split.masks.CHD;
  app.document.getElementById("maskINF").value = split.masks.INF;
  app.build();

  // O PQ do INF aparece duplicado no texto bruto (artefato de paginacao do
  // terminal). bagSegs precisa ter exatamente 4 posicoes, uma por trecho
  // aereo real, nunca 8.
  assert.equal(app._lastQuote.pricing.INF.bagSegs.length, 4);
  app.close();
});

test("Amadeus le a franquia propria do INF a partir dos tres FQQ separados", () => {
  const app = createApp();
  const [itinRaw, maskADT, maskCHD, maskINF] = fixtureBlocks(FIX_AMADEUS_3TIPOS);

  app.document.getElementById("itin").value = itinRaw;
  app.document.getElementById("qADT").value = "1";
  app.document.getElementById("qCHD").value = "1";
  app.document.getElementById("qINF").value = "1";
  app.refreshPaxUI();
  app.document.getElementById("maskADT").value = maskADT;
  app.document.getElementById("maskCHD").value = maskCHD;
  app.document.getElementById("maskINF").value = maskINF;
  app.build();

  const q = app._lastQuote;
  assert.deepEqual(Array.from(q.pricing.ADT.bagSegs), ["Sem Bag", "Sem Bag", "2PC", "1PC"]);
  assert.deepEqual(Array.from(q.pricing.CHD.bagSegs), ["Sem Bag", "Sem Bag", "2PC", "1PC"]);
  assert.deepEqual(Array.from(q.pricing.INF.bagSegs), ["1PC", "Sem Bag", "Sem Bag", "1PC"]);

  // Mesmos totais do exemplo Sabre equivalente: conferencia cruzada entre GDS.
  assert.equal(q.pricing.ADT.totalBRL, 13020.83);
  assert.equal(q.pricing.INF.totalBRL, 2081.00);
  app.close();
});

test("deteccao de equipamento aceita o formato digito-letra-digito (7M8, 7M9)", () => {
  const app = createApp();
  // Antes desta correcao, 7M8 e 7M9 nao eram reconhecidos como equipamento
  // em nenhuma forma: o campo saia null, nao so sem traducao de nome.
  assert.equal(app.pareceEquipamento("7M8"), true);
  assert.equal(app.pareceEquipamento("7M9"), true);
  // E o nome continua SEM traducao: nao foi confirmado pelo GDS, so pela
  // posicao no retorno. Mostrar o codigo cru e o correto aqui.
  assert.equal(app.equipmentName("7M8"), null);
  assert.equal(app.equipmentName("7M9"), null);

  const [itinRaw] = fixtureBlocks(FIX_AMADEUS_3TIPOS);
  const segs = app.parseItinerary(itinRaw, "AMA", 2026).filter(s => !s.surface);
  assert.deepEqual(Array.from(segs, s => s.equipment), ["789", "7M8", "7M9", "789"]);
  app.close();
});

// ─── Cabine inferida pela classe de reserva (RBD) ────────────────────────────
// O campo Cabine era 100% manual. A inferencia usa a letra RBD que o parser
// ja extraia (campo .rbd) e nunca usava, com uma tabela deliberadamente
// conservadora: so confirma cabine quando ha alta confianca, nunca adivinha.

test("cabinePorRBD mapeia letras confiaveis e deixa as ambiguas de fora", () => {
  const app = createApp();
  assert.equal(app.cabinePorRBD("F"), "Primeira Classe");
  assert.equal(app.cabinePorRBD("J"), "Executiva");
  assert.equal(app.cabinePorRBD("y"), "Econômica");
  // Ambiguas entre companhias: nao estao na tabela, nunca inventadas.
  assert.equal(app.cabinePorRBD("W"), null);
  assert.equal(app.cabinePorRBD("R"), null);
  assert.equal(app.cabinePorRBD("E"), null);
  assert.equal(app.cabinePorRBD("O"), null);
  assert.equal(app.cabinePorRBD("X"), null);
  // "I" foi deliberadamente excluida: um exemplo real da AM usa "I" para
  // tarifa economica com desconto, nao executiva (ver sabre_adt_chd_inf...).
  assert.equal(app.cabinePorRBD("I"), null);
  app.close();
});

test("inferirCabineItinerario concorda, discorda ou nao tem RBD confiavel", () => {
  const app = createApp();
  // deepEqual nao serve aqui: o objeto retornado nasce no realm do jsdom, com
  // um Object.prototype diferente do deste arquivo de teste. Conferir campo a campo.
  const uniforme = [
    { org: "GRU", dst: "MEX", rbd: "Y" },
    { org: "MEX", dst: "GRU", rbd: "H" }
  ];
  const r1 = app.inferirCabineItinerario(uniforme);
  assert.equal(r1.cabine, "Econômica");
  assert.equal(r1.mista, false);

  const mista = [
    { org: "GRU", dst: "MIA", rbd: "Y" },
    { org: "MIA", dst: "GRU", rbd: "J" }
  ];
  const r2 = app.inferirCabineItinerario(mista);
  assert.equal(r2.cabine, null);
  assert.equal(r2.mista, true);

  const semConfianca = [
    { org: "GRU", dst: "MEX", rbd: "I" },
    { org: "MEX", dst: "GRU", rbd: "" }
  ];
  const r3 = app.inferirCabineItinerario(semConfianca);
  assert.equal(r3.cabine, null);
  assert.equal(r3.mista, false);

  // Trecho de superficie (ARNK) e ignorado mesmo que tenha algo em .rbd.
  const comSuperficie = [
    { org: "GRU", dst: "MAD", rbd: "Y" },
    { org: "BIO", dst: "MAD", rbd: "J", surface: true }
  ];
  const r4 = app.inferirCabineItinerario(comSuperficie);
  assert.equal(r4.cabine, "Econômica");
  assert.equal(r4.mista, false);
  app.close();
});

test("Cabine e autopreenchida pela RBD e o motor avisa para confirmar", () => {
  const app = createApp();
  const [itinRaw, maskRaw] = fixtureBlocks(FIX_SABRE_3TIPOS);
  const split = app.splitSabrePricingMasks(maskRaw);

  app.document.getElementById("itin").value = itinRaw;
  app.document.getElementById("qADT").value = "1";
  app.document.getElementById("qCHD").value = "1";
  app.document.getElementById("qINF").value = "1";
  app.refreshPaxUI();
  app.document.getElementById("maskADT").value = split.masks.ADT;
  app.document.getElementById("maskCHD").value = split.masks.CHD;
  app.document.getElementById("maskINF").value = split.masks.INF;
  app.build();

  // Os trechos GDL-MEX/MEX-GRU usam RBD "I" (fora da tabela confiavel) e os
  // trechos GRU-MEX/MEX-GDL usam "V" (Economica) -- unico voto confiavel,
  // entao a cabine inferida e Economica, batendo com o exemplo real.
  const fldCabine = app.document.getElementById("fldCabine");
  assert.equal(fldCabine.value, "Econômica");
  assert.equal(fldCabine.dataset.source, "RBD");
  assert.ok(app._lastQuote.meta.warnings.some(w => /Cabine \(Econômica\) inferida automaticamente/.test(w)));
  app.close();
});

test("edicao manual da cabine trava o autopreenchimento e silencia o aviso", () => {
  const app = createApp();
  const [itinRaw, maskRaw] = fixtureBlocks(FIX_SABRE_3TIPOS);
  const split = app.splitSabrePricingMasks(maskRaw);

  app.document.getElementById("itin").value = itinRaw;
  app.document.getElementById("qADT").value = "1";
  app.document.getElementById("qCHD").value = "1";
  app.document.getElementById("qINF").value = "1";
  app.refreshPaxUI();
  app.document.getElementById("maskADT").value = split.masks.ADT;
  app.document.getElementById("maskCHD").value = split.masks.CHD;
  app.document.getElementById("maskINF").value = split.masks.INF;

  const fldCabine = app.document.getElementById("fldCabine");
  fldCabine.value = "Executiva";
  fldCabine.dataset.source = "MANUAL"; // o handler de "change" real faz este stamp

  app.build();

  assert.equal(fldCabine.value, "Executiva", "nao deveria sobrescrever escolha manual");
  assert.equal(
    app._lastQuote.meta.warnings.some(w => /inferida automaticamente/.test(w)),
    false,
    "nao deveria avisar sobre inferencia quando a cabine foi escolhida a mao"
  );
  app.close();
});

test("itinerario com cabine mista por trecho avisa e nao autopreenche", () => {
  const app = createApp();
  const itinMista = [
    "RTABC123",
    "1.TESTE/JOAO MR",
    "2  LA 8113 Y 15JUN 6 GRUMIA HK1  0830 1430 15JUN  E  LA/ABC123",
    "3  LA 8114 J 20JUN 4 MIAGRU HK1  0930 2030 20JUN  E  LA/ABC123"
  ].join("\n");
  app.document.getElementById("itin").value = itinMista;
  app.build();

  const fldCabine = app.document.getElementById("fldCabine");
  assert.notEqual(fldCabine.dataset.source, "RBD", "cabine mista nao deveria ser autopreenchida");
  assert.ok(app._lastQuote.meta.warnings.some(w => /cabines diferentes por trecho/i.test(w)));
  app.close();
});

test("Limpar reseta a origem da cabine, permitindo nova inferencia", () => {
  const app = createApp();
  const fldCabine = app.document.getElementById("fldCabine");
  fldCabine.dataset.source = "RBD";
  app.document.getElementById("btnClear").dispatchEvent(new app.MouseEvent("click", { bubbles: true }));
  assert.equal(fldCabine.value, "Econômica");
  assert.equal(fldCabine.dataset.source, undefined);
  app.close();
});
