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

// Le todos os campos da tela para um objeto simples (a unica parte de build() que le o DOM).
function readQuoteInputs() {
  const masks = { ADT: $("maskADT").value, CHD: $("maskCHD").value, INF: $("maskINF").value };

  // Cambio: o valor lido do GDS e gravado no campo (4 casas) ANTES de ser lido de volta,
  // para o calculo usar exatamente o numero que aparece na tela.
  const fxInput = $("fldFX").value.trim();
  const fxIata = extractIataFx([masks.ADT, masks.CHD, masks.INF].join("\n\n"));
  if (!fxInput && fxIata != null) setFxRate(fxIata, { source: "GDS" }, false);
  const fxEl = $("fldFX");

  return {
    itin: $("itin").value || "",
    masks,
    cabinConfirm: cabinConfirmState,
    cabine: { value: $("fldCabine").value || "", source: $("fldCabine").dataset.source || "" },
    condSel: $("fldCondicao").value,
    condOutro: $("fldCondOutro").value,
    rcUSD: $("fldRC").value.trim(),
    markupPct: $("fldMarkup").value.trim(),
    ravPct: $("fldRAV").value.trim(),
    fxInput,
    fx: { value: fxEl.value, source: fxEl.dataset.source || "", baseDate: fxEl.dataset.baseDate || "", usageDate: fxEl.dataset.usageDate || "" },
    openTicket: $("fldOpenTicket").value || "",
    loc: $("fldLOC").value.trim().toUpperCase(),
    multaReembolso: $("fldMultaReembolso").value.trim(),
    multaRemarcacao: $("fldMultaRemarcacao").value.trim(),
    assentosMode: $("fldAssentosMode").value,
    assentosCustom: $("fldAssentosCustom").value,
    // Pagamento e lido aqui e viaja no modelo: buildEmail nao deve tocar o DOM.
    payment: collectPayment(),
    pax: { adt: +$("qADT").value || 0, chd: +$("qCHD").value || 0, inf: +$("qINF").value || 0 },
    paxNames: $("chkNomes").checked ? collectPaxNames() : { ADT: [], CHD: [], INF: [] },
    bagOverrides: { ADT: $("bagOvADT").value, CHD: $("bagOvCHD").value, INF: $("bagOvINF").value }
  };
}

// Escreve o resultado de computeQuote() na tela (previa, KPIs, avisos).
function renderQuote(result) {
  const { gds, finalQuote } = result;
  $("gdsDetected").textContent = (gds === "AMA" ? "Amadeus" : (gds === "SAB" ? "Sabre" : "—"));
  if (gds === "—") {
    setStatus("GDS não identificado pelo formato do itinerário", true);
  } else {
    setStatus("GDS identificado: " + (gds === "AMA" ? "Amadeus" : "Sabre"));
  }

  if (result.cabineFill != null) {
    const fldCabineEl = $("fldCabine");
    fldCabineEl.value = result.cabineFill;
    fldCabineEl.dataset.source = "RBD";
  }

  for (const [tipo, wrapId] of [["ADT", "bagOvADTWrap"], ["CHD", "bagOvCHDWrap"], ["INF", "bagOvINFWrap"]]) {
    if (result.bagOverrideShow[tipo] === undefined) continue;
    document.getElementById(wrapId).style.display = result.bagOverrideShow[tipo] ? "" : "none";
  }

  // Expõe finalQuote no window para debug/próximas fases
  window._lastQuote = finalQuote;

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
  // Painel interno (nunca vai para o e-mail): quanto de markup e de RAV entrou no total do grupo.
  const g = finalQuote.totals.group || {};
  $("markupInfo").textContent = g.markupTotal > 0 ? `Markup embutido na tarifa do grupo: ${moneyBRL(g.markupTotal)}` : "";
  $("ravInfo").textContent    = g.ravTotal > 0    ? `RAV da agência no grupo: ${moneyBRL(g.ravTotal)}` : "";

  // ── Feedback ao operador: avisos do motor + confiabilidade ────────────────
  // Fica aqui, e não no handler do botão, porque os testes chamam build()
  // diretamente e nunca disparam eventos de clique.
  const engineIssues = engineIssuesFromQuote(finalQuote);
  renderValidation((validationActivated ? validateQuoteInput() : []).concat(engineIssues));
  renderConfidence(finalQuote);
}

// Orquestrador: ler tela -> calcular (nucleo, sem DOM) -> escrever tela.
function build() {
  renderQuote(computeQuote(readQuoteInputs()));
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

// Sugestao de RAV: preenche 7% (editavel). Dispara 'input' para marcar a previa como desatualizada e salvar o rascunho.
$("btnRav7").addEventListener("click", ()=>{
  const el = $("fldRAV");
  el.value = "7,00";
  el.dispatchEvent(new Event("input", { bubbles: true }));
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
  ["fldRC","fldMarkup","fldRAV","fldFX","fldAssentosCustom","fldMultaReembolso","fldMultaRemarcacao","fldLOC","fldCondOutro",
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
  $("markupInfo").textContent=""; $("ravInfo").textContent="";
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
