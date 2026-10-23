#!/usr/bin/env node
/* Monta index.html a partir dos pedacos em src/.
 *
 * POR QUE ESTE SCRIPT EXISTE: o app e um unico arquivo HTML (CSS e JS inline, sem build
 * system, sem dependencia) por restricao real -- e publicado como arquivo unico e e
 * copiado byte a byte para o hub Central-Calculadora (sync.cjs). Este script permite que
 * a FONTE viva dividida em modulos pequenos (src/script/*.js, separados em NUCLEO sem DOM
 * e UI) sem abrir mao da saida unica.
 *
 * Os arquivos em src/script/*.js NAO sao modulos ES/CommonJS: sao recortes literais de
 * texto do <script>, concatenados na ordem do manifest. Por isso a ORDEM do manifest e
 * parte do contrato: declaracoes `function` sao hoisted e podem ficar em qualquer lugar,
 * mas `const`/`let` e codigo de carga (fiacao de eventos) executam na ordem em que
 * aparecem. Ver src/README.md.
 *
 * Uso:
 *   node ferramentas/build.cjs                 monta e grava index.html
 *   node ferramentas/build.cjs --check          so compara, nao grava; sai com 1 se o
 *                                                index.html atual divergir do que seria
 *                                                montado (a fonte esqueceu de ser buildada)
 *   node ferramentas/build.cjs <saida.html>      monta e grava noutro arquivo
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const MANIFEST_PATH = path.join(RAIZ, "src", "manifest.json");

function ler(relPath) {
  return fs.readFileSync(path.join(RAIZ, relPath), "utf8");
}

function montar() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const head = ler(manifest.head);
  const body = ler(manifest.body);
  const foot = ler(manifest.foot);
  const scriptContent = manifest.script.map(ler).join("");
  return head + body + scriptContent + foot;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const destinoArg = args.find((a) => !a.startsWith("--"));
  const destino = path.join(RAIZ, destinoArg || "index.html");

  const montado = montar();

  if (check) {
    if (!fs.existsSync(destino)) {
      console.error("ERRO: destino nao existe para comparar: " + destino);
      process.exit(1);
    }
    const atual = fs.readFileSync(destino, "utf8");
    if (atual === montado) {
      console.log("OK: build e byte-identico a " + path.relative(RAIZ, destino));
      process.exit(0);
    }
    let i = 0;
    const min = Math.min(atual.length, montado.length);
    while (i < min && atual[i] === montado[i]) i++;
    console.error("FALHA: build diverge do arquivo atual no caractere " + i);
    console.error("  atual (no destino) :", JSON.stringify(atual.slice(Math.max(0, i - 30), i + 30)));
    console.error("  montado (de src/)   :", JSON.stringify(montado.slice(Math.max(0, i - 30), i + 30)));
    console.error("  tamanho atual: " + atual.length + " | tamanho montado: " + montado.length);
    process.exit(1);
  }

  fs.writeFileSync(destino, montado);
  console.log("Gravado: " + path.relative(RAIZ, destino) + " (" + montado.length + " chars)");
}

main();
