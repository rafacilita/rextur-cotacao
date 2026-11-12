// CRC: os padroes da tela em branco fazem parte do formato.
// O CRC1 so guarda o que difere da tela em branco (CRC_DEFAULTS). Se o padrao de um campo mudar, se um id
// for renomeado ou removido, ou se uma opcao de lista sumir, um CRC1 JA ENVIADO reabre DIFERENTE sem erro.
// Se um teste daqui falhar: nao "atualize a lista". Ou o leitor ganha uma migracao que traduz o CRC1 antigo
// para a tela nova, ou nasce um formato novo (CRC2-) mantendo o CRC1 legivel.
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const root = join(__dirname, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const novoApp = () => new JSDOM(html, { runScripts: "dangerously", url: "https://cotacao.test/" }).window;
const copia = (x) => JSON.parse(JSON.stringify(x));

// Tela em branco do CRC1 (congelada em 12/11/2026, rextur-cotacao main c9a7ad9 + totais-cotacao-confiaveis).
const TELA_CRC1 = {
  "bagOvADT": { "value": "" },
  "bagOvCHD": { "value": "" },
  "bagOvINF": { "value": "" },
  "chkNomes": { "checked": false },
  "fldAssentosCustom": { "value": "" },
  "fldAssentosMode": { "value": "" },
  "fldCabine": { "value": "Econômica" },
  "fldCondOutro": { "value": "" },
  "fldCondicao": { "value": "Incluir a RAV" },
  "fldFX": { "value": "" },
  "fldLOC": { "value": "" },
  "fldMarkup": { "value": "" },
  "fldMultaReembolso": { "value": "" },
  "fldMultaRemarcacao": { "value": "" },
  "fldOpenTicket": { "value": "" },
  "fldRAV": { "value": "" },
  "fldRC": { "value": "" },
  "itin": { "value": "" },
  "maskADT": { "value": "" },
  "maskAll": { "value": "" },
  "maskCHD": { "value": "" },
  "maskINF": { "value": "" },
  "name_ADT_1": { "value": "" },
  "payCartao": { "checked": false },
  "payDeposito": { "checked": false },
  "payFaturado": { "checked": false },
  "payLink": { "value": "" },
  "payParcel": { "value": "1x" },
  "qADT": { "value": "1" },
  "qCHD": { "value": "0" },
  "qINF": { "value": "0" },
};

// Valores que um CRC1 pode trazer nas listas: cada um precisa continuar sendo uma opcao (incluir opcao nova pode).
const OPCOES_CRC1 = {
  fldAssentosMode: ["", "padrao", "custom"],
  fldCabine: ["Econômica", "Premium Economy", "Executiva", "Primeira Classe"],
  fldCondicao: ["Incluir a RAV", "Outro", ""],
  fldOpenTicket: ["", "Sim", "Não"],
  payParcel: ["1x", "2x", "3x", "4x", "5x", "6x", "7x", "8x", "9x", "10x", "11x", "12x"],
};

const vazio = (st) => ("checked" in st ? !st.checked : String(st.value ?? "") === "");

test("CRC1: cada campo da tela em branco continua com o mesmo id, tipo e padrao", () => {
  const app = novoApp();
  const atual = copia(app.eval("CRC_DEFAULTS"));
  for (const [id, st] of Object.entries(TELA_CRC1)) {
    assert.ok(id in atual, `o campo "${id}" sumiu ou mudou de id: CRC1 antigo com ele reabriria sem esse valor`);
    assert.deepEqual(atual[id], st, `o padrao de "${id}" mudou: CRC1 antigo que nao trazia "${id}" reabriria com o padrao novo`);
  }
  app.close();
});

test("CRC1: campo novo na tela so pode nascer vazio (ou desmarcado)", () => {
  const app = novoApp();
  const atual = copia(app.eval("CRC_DEFAULTS"));
  const novosCheios = Object.keys(atual).filter((id) => !(id in TELA_CRC1) && !vazio(atual[id]));
  assert.deepEqual(novosCheios, [], "campo novo com padrao preenchido: todo CRC1 antigo reabriria com esse valor, que a cotacao original nao tinha");
  app.close();
});

test("CRC1: as opcoes das listas que um CRC1 pode trazer continuam existindo", () => {
  const app = novoApp();
  for (const [id, valores] of Object.entries(OPCOES_CRC1)) {
    const el = app.document.getElementById(id);
    assert.ok(el && el.tagName === "SELECT", `"${id}" deixou de ser lista`);
    const atuais = Array.from(el.options, (o) => o.value);
    for (const v of valores) assert.ok(atuais.includes(v), `a opcao "${v}" de "${id}" sumiu: CRC1 com ela reabriria com a lista em branco`);
  }
  app.close();
});

test("CRC1: os campos de nome continuam com o padrao name_<TIPO>_<n>", () => {
  const app = novoApp();
  const $ = (id) => app.document.getElementById(id);
  $("chkNomes").checked = true;
  $("qADT").value = "2"; $("qCHD").value = "1"; $("qINF").value = "1";
  app.refreshOptionalUI(); app.refreshPaxUI();
  for (const id of ["name_ADT_1", "name_ADT_2", "name_CHD_1", "name_INF_1"]) assert.ok($(id), `"${id}" nao existe`);
  app.close();
});

test("CRC de tela diferente: campo que nao existe ou opcao que a lista nao tem gera aviso (nao some calado)", () => {
  const app = novoApp();
  const $ = (id) => app.document.getElementById(id);
  const code = app.eval(`encodeCRC({ v: 1, c: { fldLOC: "ABC123", campoQueSumiu: "x", payParcel: "13x" } })`);
  $("crcInput").value = code;
  $("btnLoadCRC").click();
  const msg = $("crcMsg").textContent;
  assert.equal($("fldLOC").value, "ABC123", "o resto da cotacao abre");
  assert.ok($("crcMsg").classList.contains("warn"), msg);
  assert.match(msg, /2 campos do código não existem nesta versão/);
  assert.match(msg, /campoQueSumiu/);
  assert.match(msg, /payParcel/);
  assert.doesNotMatch(msg, /fldLOC/);
  app.close();
});

test("CRC1: as listas que mudam a leitura (textos referenciados e campos fora do codigo) sao as mesmas", () => {
  const app = novoApp();
  // CRC_TEXT_FIELDS: o "r" do CRC aponta um campo para outro com o mesmo texto; mudar a lista muda o significado do "r".
  assert.deepEqual(copia(app.eval("CRC_TEXT_FIELDS")), ["itin", "maskADT", "maskCHD", "maskINF"]);
  assert.deepEqual(copia(app.eval("CRC_SKIP_FIELDS")), ["maskAll"]);
  app.close();
});
