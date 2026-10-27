#!/usr/bin/env node
/* Fingerprint de carga: prova que duas versoes do index.html SE COMPORTAM igual ao subir.
 *
 * POR QUE ESTE ARQUIVO EXISTE: os testes (tests/parser.test.cjs) carregam o app em
 * jsdom, mas erro de script em jsdom NAO derruba o teste -- vai so para o console
 * virtual. Se uma reorganizacao do codigo fizesse o <script> abortar no meio (um
 * `const` em TDZ, por exemplo), as funcoes `function nome(){}` continuariam existindo
 * (hoisting), os testes de parser passariam, e a fiacao de eventos que vem depois do
 * ponto do erro simplesmente nunca rodaria. Aqui o boot e medido por inteiro.
 *
 * O que entra no fingerprint:
 *   - erros de script durante o boot (tem de ser zero)
 *   - TRACE dos efeitos colaterais de carga, em ordem: addEventListener (alvo, tipo,
 *     hash do handler), setTimeout/setInterval, e leitura/escrita de localStorage
 *   - hash de CADA binding global (function -> hash do codigo-fonte; const/let ->
 *     hash do valor serializado): pega funcao alterada, tabela de dados alterada,
 *     estado inicial diferente
 *   - hash do DOM depois do boot (sem os <script>)
 *
 * Uso:
 *   node ferramentas/fingerprint.cjs <arquivo.html>                 imprime o fingerprint
 *   node ferramentas/fingerprint.cjs --comparar <a.html> <b.html>   compara; sai com 1 se diferir
 */
"use strict";

const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require("jsdom"));
} catch (e) {
  console.error("ERRO: jsdom nao instalado. Rode:  npm install");
  process.exit(1);
}

const hash = (s) => createHash("sha1").update(String(s)).digest("hex").slice(0, 12);

function rotuloAlvo(w, alvo) {
  if (alvo === w) return "window";
  if (alvo === w.document) return "document";
  if (alvo && alvo.nodeType === 1) {
    if (alvo.id) return alvo.tagName.toLowerCase() + "#" + alvo.id;
    return alvo.tagName.toLowerCase() + (alvo.className ? "." + String(alvo.className).split(/\s+/)[0] : "");
  }
  return Object.prototype.toString.call(alvo);
}

// O jsdom registra um listener interno `document|load` (fireAnEvent("load", window...))
// SO na primeira carga de cada processo. Sem aquecimento, a primeira carga medida
// teria 1 evento a mais que as demais e a mesma pagina "diferiria dela mesma".
let aquecido = false;
async function aquecer() {
  if (aquecido) return;
  aquecido = true;
  const d = new JSDOM("<!doctype html><title>aquecimento</title>", { runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  await new Promise((r) => setTimeout(r, 300));
  d.window.close();
}

async function fingerprint(arquivo) {
  await aquecer();
  const html = readFileSync(arquivo, "utf8");
  const erros = [];
  const trace = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => erros.push(String((e && e.message) || e).split("\n")[0]));

  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://cotacao.test/",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      const origAdd = w.EventTarget.prototype.addEventListener;
      w.EventTarget.prototype.addEventListener = function (tipo, fn) {
        trace.push(["listener", rotuloAlvo(w, this), tipo, typeof fn === "function" ? hash(fn.toString()) : "obj"]);
        return origAdd.apply(this, arguments);
      };
      for (const nome of ["setTimeout", "setInterval"]) {
        const orig = w[nome];
        w[nome] = function (fn, ms) {
          trace.push([nome, typeof fn === "function" ? hash(fn.toString()) : String(fn), ms | 0]);
          return orig.apply(this, arguments);
        };
      }
      for (const metodo of ["getItem", "setItem", "removeItem"]) {
        const orig = w.Storage.prototype[metodo];
        w.Storage.prototype[metodo] = function (chave) {
          trace.push(["storage", metodo, String(chave)]);
          return orig.apply(this, arguments);
        };
      }
    },
  });
  const w = dom.window;
  await new Promise((r) => setTimeout(r, 500)); // deixa timers e promises do boot assentarem

  // nomes candidatos a binding global: function/const/let/var declarados no script
  const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [, ""])[1];
  const nomes = new Set();
  for (const m of script.matchAll(/(?:^|[\n;{}])\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) nomes.add(m[1]);
  for (const m of script.matchAll(/(?:^|[\n;{}])\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) nomes.add(m[1]);

  const substituidor = (chave, v) => {
    if (typeof v === "function") return "fn:" + hash(Function.prototype.toString.call(v));
    if (v instanceof w.Set) return { __set: [...v] };
    if (v instanceof w.Map) return { __map: [...v] };
    if (v && v.nodeType) return "dom:" + (v.id || v.tagName);
    return v;
  };

  const globais = {};
  for (const nome of [...nomes].sort()) {
    let tipo;
    try { tipo = w.eval("typeof " + nome); } catch (e) { globais[nome] = "TDZ/ERRO:" + e.name; continue; }
    if (tipo === "undefined") continue; // era local a alguma funcao, nao e global
    let v;
    try { v = w.eval(nome); } catch (e) { globais[nome] = "ERRO:" + e.name; continue; }
    if (tipo === "function") globais[nome] = "fn:" + hash(Function.prototype.toString.call(v));
    else if (tipo === "object" && v !== null) {
      try { globais[nome] = "obj:" + hash(JSON.stringify(v, substituidor)); } catch (e) { globais[nome] = "obj:nao-serializavel"; }
    } else globais[nome] = tipo + ":" + String(v);
  }

  const clone = w.document.documentElement.cloneNode(true);
  for (const s of [...clone.querySelectorAll("script")]) s.remove();
  const domHash = hash(clone.outerHTML);

  dom.window.close();
  return { erros, trace, globais, domHash, totalGlobais: Object.keys(globais).length };
}

function comparar(a, b) {
  const difs = [];
  if (JSON.stringify(a.erros) !== JSON.stringify(b.erros)) difs.push(`erros de boot diferem: A=${JSON.stringify(a.erros)} B=${JSON.stringify(b.erros)}`);
  if (a.erros.length || b.erros.length) difs.push(`boot com erro (A: ${a.erros.length}, B: ${b.erros.length}) -- fingerprint nao e confiavel`);

  const ta = a.trace.map((x) => x.join("|"));
  const tb = b.trace.map((x) => x.join("|"));
  if (ta.length !== tb.length) difs.push(`trace de carga: ${ta.length} eventos em A vs ${tb.length} em B`);
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    if (ta[i] !== tb[i]) { difs.push(`trace diverge no evento #${i}: A=${ta[i]}  B=${tb[i]}`); break; }
  }

  const nomes = new Set([...Object.keys(a.globais), ...Object.keys(b.globais)]);
  for (const n of [...nomes].sort()) {
    if (a.globais[n] !== b.globais[n]) difs.push(`binding global "${n}": A=${a.globais[n]}  B=${b.globais[n]}`);
  }
  if (a.domHash !== b.domHash) difs.push(`DOM pos-boot difere: A=${a.domHash} B=${b.domHash}`);
  return difs;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--comparar") {
    if (args.length !== 3) { console.error("uso: fingerprint.cjs --comparar <a.html> <b.html>"); process.exit(2); }
    const [fa, fb] = [await fingerprint(args[1]), await fingerprint(args[2])];
    console.log(`A: ${fa.totalGlobais} bindings globais | ${fa.trace.length} eventos de carga | ${fa.erros.length} erros de boot | DOM ${fa.domHash}`);
    console.log(`B: ${fb.totalGlobais} bindings globais | ${fb.trace.length} eventos de carga | ${fb.erros.length} erros de boot | DOM ${fb.domHash}`);
    const difs = comparar(fa, fb);
    if (!difs.length) { console.log("\nEQUIVALENTES: mesmo boot, mesmos efeitos de carga, mesmos bindings, mesmo DOM."); return; }
    console.log("\nDIFERENCAS (" + difs.length + "):");
    for (const d of difs.slice(0, 25)) console.log("  - " + d);
    if (difs.length > 25) console.log(`  ... e mais ${difs.length - 25}`);
    process.exit(1);
  }
  if (!args[0]) { console.error("uso: fingerprint.cjs <arquivo.html>  |  --comparar <a.html> <b.html>"); process.exit(2); }
  const f = await fingerprint(args[0]);
  console.log(JSON.stringify({ erros: f.erros, eventosDeCarga: f.trace.length, bindings: f.totalGlobais, domHash: f.domHash }, null, 2));
  if (f.erros.length) process.exit(1);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });
module.exports = { fingerprint, comparar };
