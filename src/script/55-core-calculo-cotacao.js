// [55-core-calculo-cotacao] NUCLEO: de "campos lidos da tela" para QuoteModel final (sem DOM)
// Sem DOM/window/localStorage: roda em qualquer motor JS (ver tests/core-sem-dom.test.cjs).
// Entrada: objeto `inputs` montado por readQuoteInputs() (UI). Saida: objeto com o
// finalQuote e os "pedidos" para a tela (preencher cabine, mostrar campos de bagagem).

function extractIataFx(txt) {
  const up = (txt || "").toUpperCase();
  let mm = up.match(/RATE\s+USED\s+1USD\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*BRL/);
  if (mm) return parseFloat(mm[1]);
  mm = up.match(/\bBSR\s*([0-9]+(?:\.[0-9]+)?)\b/);
  if (mm) return parseFloat(mm[1]);
  mm = up.match(/\b1USD\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*BRL\b/);
  if (mm) return parseFloat(mm[1]);
  return null;
}

// inputs: { itin, masks:{ADT,CHD,INF}, pax:{adt,chd,inf}, paxNames, payment,
//   cabinConfirm (ou null), cabine:{value,source}, condSel, condOutro, rcUSD, markupPct, ravPct, openTicket, loc,
//   multaReembolso, multaRemarcacao, assentosMode, assentosCustom,
//   bagOverrides:{ADT,CHD,INF}, fxInput, fx:{value,source,baseDate,usageDate} }
// Retorna { gds, finalQuote, cabineFill, bagOverrideShow:{ADT,CHD,INF} }
function computeQuote(inputs) {
  const itin = inputs.itin;
  const masks = inputs.masks;
  const pax = inputs.pax;
  const gds = detectGDSFromItin(itin);

  const year = inferYearFromText(itin + "\n" + masks.ADT + "\n" + masks.CHD + "\n" + masks.INF);
  const segs = parseItinerary(itin, gds, year);

  // Cabine confirmada por trecho (popup). So aplica se a confirmacao for
  // deste MESMO texto de itinerario -- se build() for chamado sem o popup ter
  // rodado (ex.: os testes chamam build() direto, sem nenhuma interacao de UI),
  // cabinConfirm fica null/desatualizado e a coluna Classe cai no
  // fallback de sempre (RBD cru), sem quebrar nada.
  const cc = inputs.cabinConfirm;
  if (cc && cc.itinText === itin) {
    let ai = 0;
    for (const s of segs) {
      if (s.surface) continue;
      s.cabinConfirmed = cc.cabins[ai] || null;
      ai++;
    }
  }

  // ── cabine inferida pela classe de reserva (RBD) ──────────────────────────
  // So preenche quando o campo nunca foi editado a mao ou quando o valor
  // atual veio desta mesma inferencia (source="RBD"); edicao manual do
  // operador trava o campo ate o "Limpar". A tela aplica cabineFill no campo.
  const canFillCabine = !inputs.cabine.source || inputs.cabine.source === "RBD";
  const inferCabine = inferirCabineItinerario(segs);
  const cabineFill = (canFillCabine && inferCabine.cabine) ? inferCabine.cabine : null;
  const cabine = cabineFill != null ? cabineFill : (inputs.cabine.value || "");
  const cabineSource = cabineFill != null ? "RBD" : (inputs.cabine.source || "");

  const condicao = (inputs.condSel === "Outro") ? ((inputs.condOutro || "").trim() || "") : (inputs.condSel || "");

  let assentosText = "";
  if (inputs.assentosMode === "padrao") assentosText = "Marcação antecipada mediante pagamento";
  else if (inputs.assentosMode === "custom") assentosText = (inputs.assentosCustom || "").trim();

  // ── parsing de tarifas ────────────────────────────────────────────────────
  const prices = {};
  const parseFor = (raw) => (gds === "SAB" ? parsePricingSabre(raw) : (gds === "AMA" ? parsePricingAmadeus(raw) : null));
  if (pax.adt > 0 && masks.ADT.trim()) prices.ADT = parseFor(masks.ADT);
  if (pax.chd > 0 && masks.CHD.trim()) prices.CHD = parseFor(masks.CHD);
  if (pax.inf > 0 && masks.INF.trim()) prices.INF = parseFor(masks.INF);

  // ── bagagem com mais valores do que trechos reais ─────────────────────────
  // O retorno do GDS pode duplicar um PQ inteiro por quebra de pagina do
  // terminal (visto num caso real: o PQ do INF apareceu duas vezes, identico,
  // por causa de um "MD«" de paginacao). Isso faz bagSegs sair mais longo que
  // a quantidade real de trechos aereos. O e-mail ja cortava corretamente ao
  // renderizar, mas o aviso de "trecho sem bagagem" nao cortava, e citava
  // trechos fantasmas ("trecho 6", "trecho 7") que nao existem no itinerario.
  // Cortar aqui, uma vez, corrige o aviso sem precisar de logica nova nele.
  {
    const airSegsTotal = segs.filter(s => s && !s.surface).length;
    for (const tipo of ["ADT", "CHD", "INF"]) {
      const pr = prices[tipo];
      if (pr && Array.isArray(pr.bagSegs) && pr.bagSegs.length > airSegsTotal) {
        pr.bagSegs = pr.bagSegs.slice(0, airSegsTotal);
      }
    }
  }

  // ── bagagem direcional do Sabre ───────────────────────────────────────────
  // Quando o PQ declara franquia por componente tarifario ("BAG ALLOWANCE
  // -GRUJFK-01P/..."), a leitura por linha numerada so acerta o ULTIMO trecho
  // de cada componente. Aqui a franquia é redistribuída pelos trechos aereos
  // reais do itinerario. Se a cadeia nao bater com confianca, bagSegs
  // permanece como a leitura original e o aviso generico de bagagem segue
  // valendo — nunca adivinha qual trecho fica com qual franquia.
  if (gds === "SAB") {
    const airSegsBag = segs.filter(s => s && !s.surface);
    for (const tipo of ["ADT", "CHD", "INF"]) {
      const pr = prices[tipo];
      if (!pr) continue;
      const direcionais = parseSabreDirectionalBagAllowances(masks[tipo]);
      const corrigido = assignDirectionalBagToSegments(direcionais, airSegsBag);
      if (corrigido) {
        pr.bagSegs = corrigido;
        const uniq = [...new Set(corrigido.filter(Boolean))];
        pr.bag = uniq.length === 0 ? null : (uniq.length === 1 ? uniq[0] : "VAR");
      }
    }
  }

  // ── bagagem manual override ───────────────────────────────────────────────
  // bagOverrideShow[tipo]: true = tela deve mostrar o campo manual; false = esconder;
  // ausente = nao mexer (tipo de passageiro ausente).
  const bagOverrideShow = {};
  for (const [tipo, qtd] of [["ADT", pax.adt], ["CHD", pax.chd], ["INF", pax.inf]]) {
    if (!(qtd > 0)) continue;
    const pr = prices[tipo] || null;
    let manual = (inputs.bagOverrides[tipo] || "").trim();
    const mu = manual.toUpperCase();
    if (mu === "NIL" || mu === "0P" || mu === "0PC") manual = "Sem Bag";
    else manual = mu;
    if (manual) {
      if (pr) { pr.bag = manual; pr.bagSegs = [manual]; }
      bagOverrideShow[tipo] = true;
    } else {
      bagOverrideShow[tipo] = !!(pr && !pr.bag);
    }
  }

  // ── câmbio IATA ───────────────────────────────────────────────────────────
  const fxRate = parseAmountAny(inputs.fx.value);

  // ── QuoteModel + Rules Engine ─────────────────────────────────────────────
  const commercial = {
    cabine,
    cabineSource,
    cabineMista: inferCabine.mista,
    condicao,
    rcUSD: inputs.rcUSD,
    markupPct: inputs.markupPct || "",   // interno: embutido na tarifa, a agencia nao ve
    ravPct: inputs.ravPct || "",         // comissao da agencia; vazio = "A definir" (nao entra no total)
    assentosText,
    payment: inputs.payment,
    openTicket: inputs.openTicket,
    loc: inputs.loc,
    penalties: {
      refund:  inputs.multaReembolso,
      reissue: inputs.multaRemarcacao
    }
  };

  const iataRate = (fxRate != null)
    ? {
        from: 'USD',
        to: 'BRL',
        rate: fxRate,
        source: inputs.fx.source || (inputs.fxInput ? 'MANUAL' : 'GDS'),
        baseDate: inputs.fx.baseDate || null,
        usageDate: inputs.fx.usageDate || null
      }
    : null;

  const quote = createQuoteModel({ gds, year, segs, prices, pax, paxNames: inputs.paxNames, commercial, iataRate });

  // applyRules não muta quote; retorna um novo objeto enriquecido.
  const finalQuote = applyRules(quote);
  return { gds, finalQuote, cabineFill, bagOverrideShow };
}
