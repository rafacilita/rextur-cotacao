// [74-ui-rascunho-validacao] UI: rascunho (autosave) e validacao de entrada

function updateDraftPill(text){
  const el = $("draftPill");
  if(el) el.textContent = text;
}

function collectDraftControls(){
  const controls = {};
  document.querySelectorAll("main input[id], main select[id], main textarea[id]").forEach(el => {
    controls[el.id] = (el.type === "checkbox" || el.type === "radio")
      ? { checked: !!el.checked }
      : { value: el.value };
  });
  return controls;
}

function saveDraft(){
  try{
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      controls: collectDraftControls(),
      fxMeta: readFxMeta(),
      cabineSource: $("fldCabine") ? ($("fldCabine").dataset.source || "") : ""
    };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
    updateDraftPill("Salvo " + new Date(payload.savedAt).toLocaleTimeString("pt-BR", {hour:"2-digit", minute:"2-digit"}));
  }catch(e){
    console.warn("Não foi possível salvar o rascunho.", e);
    updateDraftPill("Falha ao salvar");
  }
}

function scheduleDraftSave(){
  clearTimeout(draftSaveTimer);
  updateDraftPill("Salvando");
  draftSaveTimer = setTimeout(saveDraft, 450);
}

function markPreviewDirty(){
  const preview = $("preview");
  if(!preview || !(preview.dataset.html || "").trim()) return;
  previewDirty = true;
  setStatus("Prévia desatualizada", true);
  // A confiabilidade se referia a previa anterior; esconder evita leitura enganosa.
  renderConfidence(null);
}

function restoreDraft(){
  let payload = null;
  try{
    payload = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || "null");
  }catch(e){
    console.warn("Rascunho local inválido.", e);
  }
  if(!payload || !payload.controls){
    updateDraftPill("Não salvo");
    return false;
  }

  const entries = Object.entries(payload.controls);
  entries.filter(([id]) => !id.startsWith("name_")).forEach(([id, state]) => {
    const el = $(id);
    if(!el) return;
    if(el.type === "checkbox" || el.type === "radio") el.checked = !!state.checked;
    else if(state.value != null) el.value = state.value;
  });

  refreshOptionalUI();
  refreshPaxUI();

  entries.filter(([id]) => id.startsWith("name_")).forEach(([id, state]) => {
    const el = $(id);
    if(el && state.value != null) el.value = state.value;
  });

  if(payload.fxMeta && $("fldFX")){
    $("fldFX").dataset.source = payload.fxMeta.source || "";
    $("fldFX").dataset.baseDate = payload.fxMeta.baseDate || "";
    $("fldFX").dataset.usageDate = payload.fxMeta.usageDate || "";
  } else if($("fldFX").value.trim()){
    $("fldFX").dataset.source = "MANUAL";
  }
  if($("fldCabine")){
    if(payload.cabineSource) $("fldCabine").dataset.source = payload.cabineSource;
    else delete $("fldCabine").dataset.source;
  }
  if($("maskAll")) $("maskAll").value = "";
  renderFxHint();

  const savedAt = payload.savedAt ? new Date(payload.savedAt) : null;
  updateDraftPill(savedAt && !Number.isNaN(savedAt.getTime())
    ? "Salvo " + savedAt.toLocaleTimeString("pt-BR", {hour:"2-digit", minute:"2-digit"})
    : "Rascunho restaurado");
  setStatus("Rascunho restaurado. Gere a prévia.");
  return true;
}

function clearValidationMarks(){
  document.querySelectorAll(".is-invalid,.is-warning").forEach(el => {
    el.classList.remove("is-invalid", "is-warning");
    el.removeAttribute("aria-invalid");
  });
}

function validateQuoteInput(){
  const issues = [];
  const add = (id, message, level="warning") => issues.push({id, message, level});
  const qADT = +$("qADT").value || 0;
  const qCHD = +$("qCHD").value || 0;
  const qINF = +$("qINF").value || 0;
  const itin = $("itin").value.trim();

  if(qADT + qCHD + qINF <= 0) add("qADT", "Informe pelo menos um passageiro.", "error");
  if(!itin) add("itin", "Cole o itinerário antes de gerar a prévia.", "error");
  else if(detectGDSFromItin(itin) === "—") add("itin", "O formato colado não corresponde a Sabre nem a Amadeus.", "error");

  if(qADT > 0 && !$("maskADT").value.trim()) add("maskADT", "A máscara do ADT está vazia.");
  if(qCHD > 0 && !$("maskCHD").value.trim()) add("maskCHD", "A máscara do CHD está vazia.");
  if(qINF > 0 && !$("maskINF").value.trim()) add("maskINF", "A máscara do INF está vazia.");

  if($("fldCondicao").value === "Outro" && !$("fldCondOutro").value.trim()){
    add("fldCondOutro", "Escreva a condição ou escolha outra opção.");
  }
  if($("fldAssentosMode").value === "custom" && !$("fldAssentosCustom").value.trim()){
    add("fldAssentosCustom", "Escreva o texto dos assentos ou escolha outra opção.");
  }

  const rcRaw = $("fldRC").value.trim();
  if(rcRaw && (parseAmountAny(rcRaw) == null || parseAmountAny(rcRaw) < 0)){
    add("fldRC", "O RC precisa ser um número válido.", "error");
  }
  const fxRaw = $("fldFX").value.trim();
  if(fxRaw && (parseAmountAny(fxRaw) == null || parseAmountAny(fxRaw) <= 0)){
    add("fldFX", "O câmbio precisa ser um número maior que zero.", "error");
  }

  if($("chkNomes").checked){
    const names = collectPaxNames();
    if(names.ADT.length < qADT) add("chkNomes", "Faltam nomes de adultos.");
    if(names.CHD.length < qCHD) add("chkNomes", "Faltam nomes de crianças.");
    if(names.INF.length < qINF) add("chkNomes", "Faltam nomes de bebês.");
  }
  return issues;
}

// Renderiza o painel de avisos. Aceita dois tipos de item:
//   • avisos de campo    — têm `id` e marcam o controle correspondente;
//   • avisos do motor    — `source:"engine"`, sem `id`, exibidos em bloco próprio.
// Itens sem `id` nunca marcam controle, por isso a guarda antes do $().
function renderValidation(issues){
  clearValidationMarks();
  const summary = $("validationSummary");
  if(!summary) return;
  summary.innerHTML = "";
  summary.classList.remove("show", "error");
  const all = Array.isArray(issues) ? issues : [];
  if(!all.length) return;

  const hasError = all.some(issue => issue.level === "error");
  summary.classList.add("show");
  if(hasError) summary.classList.add("error");

  const appendBlock = (titleText, items) => {
    if(!items.length) return;
    const title = document.createElement("strong");
    title.textContent = titleText;
    const list = document.createElement("ul");
    items.forEach(issue => {
      const item = document.createElement("li");
      item.textContent = issue.message;
      list.appendChild(item);
      const control = issue.id ? $(issue.id) : null;
      if(control){
        control.classList.add(issue.level === "error" ? "is-invalid" : "is-warning");
        if(issue.level === "error") control.setAttribute("aria-invalid", "true");
      }
    });
    summary.append(title, list);
  };

  appendBlock(
    hasError ? "Revise os campos destacados" : "Confira antes de enviar",
    all.filter(issue => issue.source !== "engine")
  );
  appendBlock(
    "Avisos do motor de cotação. Confira no GDS antes de enviar.",
    all.filter(issue => issue.source === "engine")
  );
}
