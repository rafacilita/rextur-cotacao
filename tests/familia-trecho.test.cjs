// Familia tarifaria por trecho (Amadeus: "FARE FAMILY:FC1:1-2:CLASICA"). Caso real: GRU-MEX-GDL-MEX-GRU
// com tres familias no mesmo bilhete. O e-mail diz qual familia vale para qual voo, na linha discreta
// "Familia tarifaria" de Condicoes -- e continua igual quando ha uma familia so.
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const html = readFileSync(join(__dirname, "..", "index.html"), "utf8");
const norm = (s) => s.split(String.fromCharCode(160)).join(" ");

const ITIN = `RTXYZ789
1.TESTE/JOAO MR
2  AM  15 R 20MAY 3 GRUMEX HK1  0940 1500 20MAY  E  AM/XYZ789
3  AM 200 R 25MAY 1 MEXGDL HK1  0605 0750 25MAY  E  AM/XYZ789
4  AM 201 D 30MAY 6 GDLMEX HK1  0546 0730 30MAY  E  AM/XYZ789
5  AM  14 I 07JUN 7 MEXGRU HK1  1845 0145 08JUN  E  AM/XYZ789`;

const FXR = `FXR/K

01 P1-2
NO REBOOKING REQUIRED FOR LOWEST AVAILABLE FARE
LAST TKT DTE 05NOV26/16:58 LT in POS - SEE ADV PURCHASE
------------------------------------------------------------
     AL FLGT  BK T DATE  TIME  FARE BASIS      NVB  NVA   BG
 SAO
 MEX AM    15 R  R 20MAY 0940  RNNH26CV        20MAY20MAY 1P
 GDL AM   200 R  R 25MAY 0605  RNNH26CV        25MAY25MAY 1P
 MEX AM   201 D  D 30MAY 0546  LLNN6QOT        30MAY30MAY 2P
 SAO AM    14 I  I 07JUN 1845  ILXSQ91M        07JUN07JUN 2P

USD  2623.00      20MAY27SAO AM MEX AM GDL342.00AM MEX206.00
BRL 14409.45      AM SAO2000.00 1S75.00NUC2623.00END ROE1.00
BRL    68.61-BR   XT BRL 293.62-UK BRL 359.32-XD BRL 387.62
BRL    69.27-S1   -XV
BRL  1040.56-XT
BRL 15587.89
RATE USED 1USD=5.4935BRL
FARE FAMILIES:    (ENTER FQFn FOR DETAILS, FXY FOR UPSELL)
>                                                 PAGE  2/ 3
>
md
FARE FAMILY:FC1:1-2:CLASICA                                                     
FARE FAMILY:FC2:3:PREMIER                                                       
FARE FAMILY:FC3:4:PREMIERONE                                                    
FXU/TS TO UPSELL CLASICAFLX-PREMIERFLX-PREMI* FOR 1384.36BRL                    
TICKET STOCK RESTRICTION                                                        
BG CXR: AM/AM/AM/AM                                                             
PRICED WITH VALIDATING CARRIER AM - REPRICE IF DIFFERENT VC                     
TICKETS ARE NON-REFUNDABLE                                                      
ENDOS NONEND/NONREF CHG/CXL - FEE APPLIES                                       
ATTN* CABIN C/S3,4 Y(M)/S1,2`;

function cotar(masks, { itin = ITIN } = {}) {
  const app = new JSDOM(html, { runScripts: "dangerously", url: "https://cotacao.test/" }).window;
  const $ = (id) => app.document.getElementById(id);
  $("qADT").value = String(masks.ADT ? 1 : 0); $("qCHD").value = String(masks.CHD ? 1 : 0); $("qINF").value = "0";
  app.refreshPaxUI();
  $("itin").value = itin;
  if (masks.ADT) $("maskADT").value = masks.ADT;
  if (masks.CHD) $("maskCHD").value = masks.CHD;
  app.build();
  return app;
}
const texto = (app) => norm(app.document.getElementById("preview").textContent);

test("parser: familia e os trechos que ela cobre", () => {
  const app = new JSDOM(html, { runScripts: "dangerously", url: "https://cotacao.test/" }).window;
  const p = app.parsePricingAmadeus(FXR);
  assert.deepEqual(JSON.parse(JSON.stringify(p.fareFamilySegs)), [
    { name: "CLASICA", segs: [1, 2] },
    { name: "PREMIER", segs: [3] },
    { name: "PREMIERONE", segs: [4] }
  ]);
  assert.deepEqual(Array.from(p.fareFamilies), ["CLASICA", "PREMIER", "PREMIERONE"], "lista de nomes de sempre");
  assert.equal(p.fareFamily, "CLASICA");
  app.close();
});

test("parser: lista de trechos aceita virgula, e familia repetida em trechos separados vira uma entrada", () => {
  const app = new JSDOM(html, { runScripts: "dangerously", url: "https://cotacao.test/" }).window;
  const r = app.extractFareFamilySegments("FARE FAMILY:FC1:1:LIGHT\nFARE FAMILY:FC2:2:CLASSIC\nFARE FAMILY:FC3:3-4:LIGHT");
  assert.deepEqual(JSON.parse(JSON.stringify(r)), [{ name: "LIGHT", segs: [1, 3, 4] }, { name: "CLASSIC", segs: [2] }]);
  assert.deepEqual(JSON.parse(JSON.stringify(app.extractFareFamilySegments("FARE FAMILY:FC1:1-2,4:X"))), [{ name: "X", segs: [1, 2, 4] }]);
  assert.deepEqual(JSON.parse(JSON.stringify(app.extractFareFamilySegments("FARE FAMILY:FC1:SL"))), [], "sem lista de trechos: nao inventa");
  assert.deepEqual(JSON.parse(JSON.stringify(app.extractFareFamilySegments("FARE FAMILIES:    (ENTER FQFn FOR DETAILS)"))), []);
  app.close();
});

test("e-mail: cada voo com a sua familia, na linha discreta de Condicoes", () => {
  const app = cotar({ ADT: FXR });
  const t = texto(app);
  assert.match(t, /Família tarifária\s*CLASICA: AM 15 GRU-MEX, AM 200 MEX-GDL; PREMIER: AM 201 GDL-MEX; PREMIERONE: AM 14 MEX-GRU/);
  assert.doesNotMatch(t, /ADT: CLASICA \| ADT: PREMIER/, "a lista antiga so de nomes sai");
  app.close();
});

test("e-mail: uma familia so continua igual a antes (so o nome)", () => {
  const um = FXR.replace(/FARE FAMILY:FC1:1-2:CLASICA[^\n]*\nFARE FAMILY:FC2:3:PREMIER[^\n]*\nFARE FAMILY:FC3:4:PREMIERONE[^\n]*/, "FARE FAMILY:FC1:1-4:CLASICA");
  const app = cotar({ ADT: um });
  assert.match(texto(app), /Família tarifária\s*ADT: CLASICA/);
  assert.doesNotMatch(texto(app), /CLASICA: AM 15/);
  app.close();
});

test("e-mail: ADT e CHD com a mesma divisao aparecem uma vez; divisoes diferentes levam o tipo", () => {
  const igual = cotar({ ADT: FXR, CHD: FXR });
  const m = texto(igual).match(/Família tarifária\s*(.*?)(?:Cabine|Forma de pagamento|Condição|Assentos|$)/);
  assert.ok(m && !/ADT —|CHD —/.test(m[1]), m && m[1]);
  igual.close();

  const outra = FXR.replace("FARE FAMILY:FC1:1-2:CLASICA", "FARE FAMILY:FC1:1-3:CLASICA").replace("FARE FAMILY:FC2:3:PREMIER", "FARE FAMILY:FC2:4:PREMIERONE").replace("FARE FAMILY:FC3:4:PREMIERONE", "");
  const dif = cotar({ ADT: FXR, CHD: outra });
  assert.match(texto(dif), /ADT — CLASICA: AM 15 GRU-MEX, AM 200 MEX-GDL; PREMIER: AM 201 GDL-MEX; PREMIERONE: AM 14 MEX-GRU \| CHD — CLASICA: AM 15 GRU-MEX, AM 200 MEX-GDL, AM 201 GDL-MEX; PREMIERONE: AM 14 MEX-GRU/);
  dif.close();
});

test("e-mail: trecho de familia fora do itinerario aparece como 'trecho N', sem quebrar", () => {
  const app = cotar({ ADT: FXR }, { itin: ITIN.split("\n").slice(0, 4).join("\n") });
  assert.match(texto(app), /PREMIERONE: trecho 4/);
  app.close();
});
