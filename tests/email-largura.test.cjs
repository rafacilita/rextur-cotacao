// Largura FIXA das tabelas do e-mail. Com width="100%" o Outlook (motor do Word) ignora a largura da div e trata a
// tabela como "Autoajuste a janela": ela estica, fica espacosa e atrapalha escrever texto antes/depois.
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const root = join(__dirname, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const W = 680;

function blocos(nome) {
  return Array.from(readFileSync(join(root, "exemplos_gds", nome), "utf8").matchAll(/```text\s*([\s\S]*?)```/gi), (m) => m[1].trim());
}

function gerar(nome, { rc = "", markup = "", rav = "" } = {}) {
  const app = new JSDOM(html, { runScripts: "dangerously", url: "https://cotacao.test/" }).window;
  const $ = (id) => app.document.getElementById(id);
  const raw = blocos(nome).join("\n\n");
  const c = app.detectPaxCountsFromPricing(raw);
  if (c) { $("qADT").value = String(c.adt || 0); $("qCHD").value = String(c.chd || 0); $("qINF").value = String(c.inf || 0); app.refreshPaxUI(); }
  $("itin").value = raw;
  const sp = app.splitCombinedPricingMasks(raw);
  if (sp) { $("maskADT").value = sp.ADT || ""; $("maskCHD").value = sp.CHD || ""; $("maskINF").value = sp.INF || ""; }
  $("fldRC").value = rc; $("fldMarkup").value = markup; $("fldRAV").value = rav;
  if (rc) app.setFxRate(5.1693, { source: "BCB" }, false);
  app.build();
  return app;
}

const fixtures = readdirSync(join(root, "exemplos_gds")).filter((f) => f.endsWith(".txt") && blocos(f).length);

for (const nome of ["amadeus_adt_chd_inf.txt", "sabre_adt_chd_inf.txt", "amadeus_pnr_simples.txt"]) {
  test(`e-mail com largura fixa de ${W}px, sem autoajuste: ${nome}`, () => {
    const app = gerar(nome, { rc: "40", markup: "5", rav: "7" });
    const wrap = app.document.querySelector("#preview > div > div");          // a div de 680px
    assert.ok(wrap, "div de largura do e-mail");
    const principais = Array.from(wrap.children).filter((el) => el.tagName === "TABLE");
    assert.ok(principais.length >= 4, "tabelas principais do e-mail: " + principais.length);
    for (const t of principais) {
      assert.equal(t.getAttribute("width"), String(W), "atributo width da tabela (o que o Outlook le)");
      assert.match(t.getAttribute("style"), new RegExp(`width:${W}px`), "style width em px");
      assert.match(t.getAttribute("style"), new RegExp(`max-width:${W}px`), "style max-width em px");
    }
    // nenhuma tabela de primeiro nivel pode ser 100%
    assert.equal(wrap.querySelectorAll(':scope > table[width="100%"]').length, 0);
    app.close();
  });
}

test("a largura vem de uma constante unica (EMAIL_W) no gerador do e-mail", () => {
  const src = readFileSync(join(root, "src", "script", "60-core-email.js"), "utf8");
  assert.match(src, /const EMAIL_W = \d+;/);
  assert.equal((src.match(/width="\$\{EMAIL_W\}"/g) || []).length, 5, "as 5 tabelas principais usam EMAIL_W");
  assert.doesNotMatch(src, /<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:100%; font-size:/, "sem tabela principal em 100%");
});

test("todas as fixtures geram e-mail com a largura fixa", () => {
  for (const nome of fixtures) {
    const app = gerar(nome);
    const prev = app.document.getElementById("preview").dataset.html || "";
    if (prev) {
      assert.match(prev, new RegExp(`<table width="${W}"[^>]*width:${W}px`), nome);
      assert.doesNotMatch(prev, /<table width="100%"[^>]*font-size:1[34]px/, nome + ": tabela principal em 100%");
    }
    app.close();
  }
});
