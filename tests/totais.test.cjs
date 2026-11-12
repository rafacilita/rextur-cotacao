// Totais da cotacao confiaveis: leitura da linha Sabre, soma sem parcial, linha x qtd = total, arredondamento.
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const root = join(__dirname, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const createApp = () => new JSDOM(html, { runScripts: "dangerously", url: "https://cotacao.test/" }).window;
const norm = (s) => s.split(String.fromCharCode(160)).join(" ");

test("A1: linha Sabre com codigo de passageiro fora da lista le o total inteiro", () => {
  const app = createApp();
  for (const code of ["C06", "C05", "INS", "JCB", "YTH", "SRC", "CNN", "ADT", ""]) {
    const raw = "EUR2315.00      BRL13673.45     1217.05XT        BRL14890.50" + code;
    const p = app.parsePricingSabre(raw);
    assert.equal(p.totalBRL, 14890.5, "codigo " + code);
    assert.equal(p.taxesBRL, 1217.05, "codigo " + code);
  }
  app.close();
});
