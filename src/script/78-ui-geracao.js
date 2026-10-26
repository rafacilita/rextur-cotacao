// [78-ui-geracao] UI: modal de cabine, build() e fiacao de eventos de carga

// Popup bloqueante: um <select> por trecho aereo, pre-preenchido com o
// palpite de cabinePorRBD. Resolve com o array de cabines escolhidas (uma
// por trecho, na mesma ordem de airSegs) ao confirmar, ou null ao cancelar.
function openCabinModal(airSegs){
  return new Promise(resolve => {
    const dlg  = $("cabinModal");
    const rows = $("cabinModalRows");
    rows.innerHTML = "";
    airSegs.forEach((s, i) => {
      const guess = cabinePorRBD(s.rbd) || "Econômica";
      const row = document.createElement("div");
      row.className = "cabinModalRow";
      row.innerHTML = `
        <span>${escapeHtml(s.airline||"")}${escapeHtml(s.flight||"")} ${escapeHtml(s.org||"")}-${escapeHtml(s.dst||"")}</span>
        <select data-idx="${i}">
          <option>Econômica</option><option>Premium Economy</option>
          <option>Executiva</option><option>Primeira Classe</option>
        </select>`;
      row.querySelector("select").value = guess;
      rows.appendChild(row);
    });

    const cancelBtn = $("cabinModalCancel");
    function onCancel(){ dlg.close("cancel"); }
    function onClose(){
      dlg.removeEventListener("close", onClose);
      cancelBtn.removeEventListener("click", onCancel);
      if (dlg.returnValue === "confirm") {
        resolve(Array.from(rows.querySelectorAll("select")).map(sel => sel.value));
      } else {
        resolve(null);
      }
    }

    dlg.addEventListener("close", onClose);
    cancelBtn.addEventListener("click", onCancel);
    dlg.showModal();
  });
}

// ─── PAGAMENTO (inalterado) ───────────────────────────────────────────────────

function collectPayment(){
  const parts=[];
  if($("payFaturado").checked) parts.push("Faturado");
  if($("payCartao").checked){ const p = $("payParcel").value || "1x"; parts.push(`Cartão de crédito (${p} sem juros)`); }
  if($("payDeposito").checked) parts.push("Transferência Bancária");
  const link = $("payLink").value.trim();
  return {methods: parts, link};
}

// ═══════════════════════════════════════════════════════════════════════════════
// build() — orquestrador principal
// Mudanças: monta QuoteModel após parsing; passa quote para buildEmail e KPIs.
// Parser, UI, renderização: inalterados.
// ═══════════════════════════════════════════════════════════════════════════════

function build() {
  const itin = $("itin").value || "";
  const gds = detectGDSFromItin(itin);
  $("gdsDetected").textContent = (gds === "AMA" ? "Amadeus" : (gds === "SAB" ? "Sabre" : "—"));
  if (gds === "—") {
    setStatus("GDS não identificado pelo formato do itinerário", true);
  } else {
    setStatus("GDS identificado: " + (gds === "AMA" ? "Amadeus" : "Sabre"));
  }

  const year = inferYearFromText(
    itin + "\n" + $("maskADT").value + "\n" + $("maskCHD").value + "\n" + $("maskINF").value
  );
  const segs = parseItinerary(itin, gds, year);

  // Cabine confirmada por trecho (popup). So aplica se a confirmacao for
  // deste MESMO texto de itinerario -- se build() for chamado sem o popup ter
  // rodado (ex.: os testes chamam build() direto, sem nenhuma interacao de UI),
  // cabinConfirmState fica null/desatualizado e a coluna Classe cai no
  // fallback de sempre (RBD cru), sem quebrar nada.
  if (cabinConfirmState && cabinConfirmState.itinText === itin) {
    let ai = 0;
    for (const s of segs) {
      if (s.surface) continue;
      s.cabinConfirmed = cabinConfirmState.cabins[ai] || null;
      ai++;
    }
  }

  // ── cabine inferida pela classe de reserva (RBD) ──────────────────────────
  // So preenche quando o campo nunca foi editado a mao ou quando o valor
  // atual veio desta mesma inferencia (dataset.source="RBD"); edicao manual
  // do operador trava o campo ate o "Limpar" (handler perto da linha 4021).
  const fldCabineEl = $("fldCabine");
  const canFillCabine = !fldCabineEl.dataset.source || fldCabineEl.dataset.source === "RBD";
  const inferCabine = inferirCabineItinerario(segs);
  if (canFillCabine && inferCabine.cabine) {
    fldCabineEl.value = inferCabine.cabine;
    fldCabineEl.dataset.source = "RBD";
  }

  // ── coleta campos de configuração (inalterado) ────────────────────────────
  const cabine       = $("fldCabine").value || "";
  const csel         = $("fldCondicao").value;
  const condicao     = (csel === "Outro") ? ($("fldCondOutro").value.trim() || "") : (csel || "");
  const rcUSD        = $("fldRC").value.trim();
  const fxInput      = $("fldFX").value.trim();
  const openTicket   = $("fldOpenTicket").value || "";
  const loc          = $("fldLOC").value.trim().toUpperCase();
  const multaReembolso  = $("fldMultaReembolso").value.trim();
  const multaRemarcacao = $("fldMultaRemarcacao").value.trim();

  let assentosText = "";
  const am = $("fldAssentosMode").value;
  if (am === "padrao") assentosText = "Marcação antecipada mediante pagamento";
  else if (am === "custom") assentosText = $("fldAssentosCustom").value.trim();

  // Pagamento e lido aqui e viaja no modelo: buildEmail nao deve tocar o DOM.
  const payment = collectPayment();

  const pax = { adt: +$("qADT").value || 0, chd: +$("qCHD").value || 0, inf: +$("qINF").value || 0 };

  // ── parsing de tarifas (inalterado) ───────────────────────────────────────
  const prices = {};
  const parseFor = (raw) => (gds === "SAB" ? parsePricingSabre(raw) : (gds === "AMA" ? parsePricingAmadeus(raw) : null));
  if (pax.adt > 0 && $("maskADT").value.trim()) prices.ADT = parseFor($("maskADT").value);
  if (pax.chd > 0 && $("maskCHD").value.trim()) prices.CHD = parseFor($("maskCHD").value);
  if (pax.inf > 0 && $("maskINF").value.trim()) prices.INF = parseFor($("maskINF").value);

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
    const masksPorTipo = { ADT: $("maskADT").value, CHD: $("maskCHD").value, INF: $("maskINF").value };
    for (const tipo of ["ADT", "CHD", "INF"]) {
      const pr = prices[tipo];
      if (!pr) continue;
      const direcionais = parseSabreDirectionalBagAllowances(masksPorTipo[tipo]);
      const corrigido = assignDirectionalBagToSegments(direcionais, airSegsBag);
      if (corrigido) {
        pr.bagSegs = corrigido;
        const uniq = [...new Set(corrigido.filter(Boolean))];
        pr.bag = uniq.length === 0 ? null : (uniq.length === 1 ? uniq[0] : "VAR");
      }
    }
  }

  // ── bagagem manual override (inalterado) ─────────────────────────────────
  function applyBagOverride(typeKey, wrapId, inputId) {
    const pr = prices[typeKey] || null;
    const wrap = document.getElementById(wrapId);
    const inp  = document.getElementById(inputId);
    if (!wrap || !inp) return;
    let manual = (inp.value || "").trim();
    const mu = manual.toUpperCase();
    if (mu === "NIL" || mu === "0P" || mu === "0PC") manual = "Sem Bag";
    else manual = mu;
    if (manual) {
      wrap.style.display = "";
      if (pr) { pr.bag = manual; pr.bagSegs = [manual]; }
      return;
    }
    wrap.style.display = (pr && !pr.bag) ? "" : "none";
  }
  if (pax.adt > 0) applyBagOverride("ADT", "bagOvADTWrap", "bagOvADT");
  if (pax.chd > 0) applyBagOverride("CHD", "bagOvCHDWrap", "bagOvCHD");
  if (pax.inf > 0) applyBagOverride("INF", "bagOvINFWrap", "bagOvINF");

  // ── câmbio IATA (inalterado) ──────────────────────────────────────────────
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
  const fxMaskSrc = [$("maskADT").value, $("maskCHD").value, $("maskINF").value].join("\n\n");
  const fxIata = extractIataFx(fxMaskSrc);
  if (!fxInput && fxIata != null) setFxRate(fxIata, { source: "GDS" }, false);
  const fxRate = parseAmountAny($("fldFX").value);

  // ── nomes de passageiros (inalterado) ────────────────────────────────────
  const paxNames = $("chkNomes").checked ? collectPaxNames() : { ADT: [], CHD: [], INF: [] };

  // ── NOVO: monta QuoteModel ───────────────────────────────────────────────
  // Agrega os dados já parseados em uma estrutura única e tipada.
  const commercial = {
    cabine,
    cabineSource: fldCabineEl.dataset.source || "",
    cabineMista: inferCabine.mista,
    condicao,
    rcUSD,
    assentosText,
    payment,
    openTicket,
    loc,
    penalties: {
      refund:  multaReembolso,
      reissue: multaRemarcacao
    }
  };

  const iataRate = (fxRate != null)
    ? {
        from: 'USD',
        to: 'BRL',
        rate: fxRate,
        source: $("fldFX").dataset.source || (fxInput ? 'MANUAL' : 'GDS'),
        baseDate: $("fldFX").dataset.baseDate || null,
        usageDate: $("fldFX").dataset.usageDate || null
      }
    : null;

  const quote = createQuoteModel({ gds, year, segs, prices, pax, paxNames, commercial, iataRate });

  // ── FASE 2: Rules Engine ─────────────────────────────────────────────────
  // applyRules não muta quote; retorna um novo objeto enriquecido.
  const finalQuote = applyRules(quote);

  // Expõe finalQuote no window para debug/próximas fases
  window._lastQuote = finalQuote;
  // ─────────────────────────────────────────────────────────────────────────

  // ── renderização: passa finalQuote (buildEmail extrai o que precisa) ─────
  const out = buildEmail(finalQuote);
  $("subjectPill").textContent = "Assunto: " + out.subject;
  $("preview").innerHTML    = out.html;
  $("preview").dataset.html = out.html;
  // Revela a coluna da previa. Sem cotacao gerada o formulario usa a largura toda.
  document.body.classList.add("has-preview");

  // ── KPIs lidos de finalQuote.totals ──────────────────────────────────────
  $("kFare").textContent  = finalQuote.totals.fareDisplay;
  $("kEquiv").textContent = finalQuote.totals.equivBRL  != null ? moneyBRL(finalQuote.totals.equivBRL)  : "—";
  $("kTaxes").textContent = finalQuote.totals.taxesBRL  != null ? moneyBRL(finalQuote.totals.taxesBRL)  : "—";
  $("kTotal").textContent = finalQuote.totals.totalBRL  != null ? moneyBRL(finalQuote.totals.totalBRL)  : "—";

  // ── Feedback ao operador: avisos do motor + confiabilidade ────────────────
  // Fica aqui, e não no handler do botão, porque os testes chamam build()
  // diretamente e nunca disparam eventos de clique.
  const engineIssues = engineIssuesFromQuote(finalQuote);
  renderValidation((validationActivated ? validateQuoteInput() : []).concat(engineIssues));
  renderConfidence(finalQuote);
}

// ─── EVENTOS (inalterados) ────────────────────────────────────────────────────

$("itin").addEventListener("input", ()=>{
  const itinRaw = $("itin").value || "";
  const g = detectGDSFromItin(itinRaw);
  $("gdsDetected").textContent = (g==="AMA" ? "Amadeus" : (g==="SAB" ? "Sabre" : "—"));
  const paxList = parsePaxFromItin(itinRaw);
  if(paxList.length){
    const adt = paxList.filter(p=>p.type==="ADT").length;
    const chd = paxList.filter(p=>p.type==="CHD").length;
    const inf = paxList.filter(p=>p.type==="INF").length;
    const curADT = +$("qADT").value || 0;
    const curCHD = +$("qCHD").value || 0;
    const curINF = +$("qINF").value || 0;
    const differs = (adt!==curADT) || (chd!==curCHD) || (inf!==curINF);
    $("autoPaxSuggest").style.display = differs ? "" : "none";
    if(differs){
      $("autoPaxSuggest").firstChild.textContent = `Detectei nomes no itinerário (ADT ${adt} • CHD ${chd} • INF ${inf}). `;
      $("btnAutoPax").onclick = () => applyAutoPax(paxList);
    }
  } else {
    $("autoPaxSuggest").style.display = "none";
  }
});

$("btnSplitMasks").addEventListener("click", ()=>{
  applyCombinedPricingInput({ overwrite: true, announce: true });
});

$("btnBuild").addEventListener("click", async ()=>{
  validationActivated = true;
  const issues = validateQuoteInput();
  renderValidation(issues);
  const errors = issues.filter(issue => issue.level === "error");
  if(errors.length){
    setStatus("Revise os campos obrigatórios", true);
    const first = $(errors[0].id);
    if(first) first.focus();
    return;
  }

  const itinText = $("itin").value;
  const gdsPreview  = detectGDSFromItin(itinText);
  const yearPreview = inferYearFromText(itinText);
  const airSegsPreview = parseItinerary(itinText, gdsPreview, yearPreview).filter(s => s && !s.surface);

  const precisaConfirmar = airSegsPreview.length > 0
    && (!cabinConfirmState || cabinConfirmState.itinText !== itinText);

  if (precisaConfirmar) {
    const cabins = await openCabinModal(airSegsPreview);
    if (!cabins) { setStatus("Geração cancelada: confirme a cabine de cada trecho.", true); return; }
    cabinConfirmState = { itinText, cabins };
  }

  try{
    clearError();
    setStatus("Gerando prévia");
    build();
    previewDirty = false;
    saveDraft();
    const inputWarnings = issues.filter(issue => issue.level !== "error").length;
    const lastQuote = window._lastQuote;
    const conf = (lastQuote && lastQuote.meta) ? lastQuote.meta.confidence : null;
    const engineWarnings = (lastQuote && lastQuote.meta && lastQuote.meta.warnings) ? lastQuote.meta.warnings.length : 0;
    const totalWarnings = inputWarnings + engineWarnings;
    const resumo = totalWarnings === 0
      ? "Prévia gerada sem avisos"
      : `Prévia gerada com ${totalWarnings === 1 ? "1 aviso" : totalWarnings + " avisos"}`;
    setStatus(resumo, conf !== "HIGH" || totalWarnings > 0);
  }
  catch(e){ console.error(e); setStatus("Erro ao gerar", true); showError(e); }
});

$("btnCopy").addEventListener("click", async ()=>{
  if(previewDirty){
    setStatus("Gere a prévia novamente antes de copiar", true);
    return;
  }
  const html = $("preview").dataset.html || $("preview").innerHTML || "";
  if(!html.trim()){ setStatus("Nada pra copiar (gere a prévia)", true); return; }
  try{
    const textFallback = html.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
    if(navigator.clipboard && window.ClipboardItem){
      const blobHtml=new Blob([html],{type:"text/html"});
      const blobText=new Blob([textFallback],{type:"text/plain"});
      await navigator.clipboard.write([new ClipboardItem({"text/html":blobHtml,"text/plain":blobText})]);
    } else {
      const temp=document.createElement("div");
      temp.style.position="fixed"; temp.style.left="-9999px";
      temp.innerHTML=html;
      document.body.appendChild(temp);
      const range=document.createRange(); range.selectNodeContents(temp);
      const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      document.execCommand("copy");
      sel.removeAllRanges(); document.body.removeChild(temp);
    }
    setStatus("HTML copiado");
  }
  catch(e){ console.error(e); setStatus("Falha ao copiar", true); showError(e); }
});

$("btnFetchFX").addEventListener("click", async ()=>{
  const button = $("btnFetchFX");
  button.disabled = true;
  button.textContent = "Consultando";
  setStatus("Consultando o fechamento no BCB");
  // force: o clique explicito ignora o cache do dia e o valor ja preenchido.
  const entry = await maybeAutofillFx({ force: true });
  button.disabled = false;
  button.textContent = "Consultar BCB";
  if(entry){
    setStatus(`C\u00e2mbio BCB carregado: ${entry.rate.toFixed(4).replace(".", ",")}`);
  } else {
    // Sem caixa de erro: o campo continua editavel para digitacao manual.
    setStatus("N\u00e3o foi poss\u00edvel consultar o BCB \u2014 informe o c\u00e2mbio manualmente", true);
  }
});

$("btnClear").addEventListener("click", ()=>{
  clearTimeout(draftSaveTimer);
  localStorage.removeItem(DRAFT_STORAGE_KEY);
  ["fldRC","fldFX","fldAssentosCustom","fldMultaReembolso","fldMultaRemarcacao","fldLOC","fldCondOutro",
   "itin","maskAll","maskADT","maskCHD","maskINF","payLink","bagOvADT","bagOvCHD","bagOvINF"].forEach(id=>{ if($(id)) $(id).value=""; });
  $("maskSplitStatus").textContent = "Aguardando conteúdo";
  $("maskSplitStatus").classList.remove("warn");
  $("maskReview").open = false;
  ["source","baseDate","usageDate"].forEach(key => { delete $("fldFX").dataset[key]; });
  renderFxHint();
  $("fldCabine").value="Econômica";
  delete $("fldCabine").dataset.source;
  $("fldCondicao").value="Incluir a RAV";
  $("fldAssentosMode").value="";
  $("fldOpenTicket").value="";
  $("qADT").value="1"; $("qCHD").value="0"; $("qINF").value="0";
  $("chkNomes").checked=false;
  ["payFaturado","payCartao","payDeposito"].forEach(id=>$(id).checked=false);
  $("payParcel").value="1x";
  refreshOptionalUI();
  refreshPaxUI();
  clearError();
  $("preview").innerHTML="";
  $("preview").dataset.html="";
  document.body.classList.remove("has-preview");
  $("subjectPill").textContent="Assunto: —";
  $("gdsDetected").textContent="—";
  ["kFare","kEquiv","kTaxes","kTotal"].forEach(id=>$(id).textContent="—");
  window._lastQuote = null;
  previewDirty = false;
  validationActivated = false;
  clearValidationMarks();
  const summary = $("validationSummary");
  if(summary){ summary.innerHTML=""; summary.classList.remove("show","error"); }
  renderConfidence(null);
  updateDraftPill("Não salvo");
  setStatus("Limpo");
});

refreshOptionalUI();
refreshPaxUI();
enhanceAccessibility();

document.querySelector("main").addEventListener("input", (event)=>{
  if(!event.target.matches("input,select,textarea")) return;
  if(event.target.id === "maskAll"){
    $("maskSplitStatus").textContent = event.target.value.trim() ? "Conteúdo pronto para identificar" : "Aguardando conteúdo";
    $("maskSplitStatus").classList.remove("warn");
  }
  if(event.target.id === "fldFX"){
    event.target.dataset.source = event.target.value.trim() ? "MANUAL" : "";
    delete event.target.dataset.baseDate;
    delete event.target.dataset.usageDate;
    renderFxHint();
  }
  scheduleDraftSave();
  markPreviewDirty();
  if(validationActivated) renderValidation(validateQuoteInput());
});
document.querySelector("main").addEventListener("change", (event)=>{
  if(!event.target.matches("input,select,textarea")) return;
  if(event.target.id === "fldCabine"){
    event.target.dataset.source = "MANUAL";
  }
  scheduleDraftSave();
  markPreviewDirty();
  if(validationActivated) renderValidation(validateQuoteInput());
});

const restoredDraft = restoreDraft();
if(restoredDraft){
  const restoredGds = detectGDSFromItin($("itin").value || "");
  $("gdsDetected").textContent = restoredGds === "AMA" ? "Amadeus" : (restoredGds === "SAB" ? "Sabre" : "—");
}

// Preenchimento automatico do cambio na abertura. Nao lanca e nao bloqueia a tela:
// em ambiente sem fetch (jsdom nos testes) simplesmente nao faz nada.
maybeAutofillFx().catch(() => {});
