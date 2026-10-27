// [76-ui-formulario] UI: confianca, acessibilidade, passageiros e entrada combinada

const CONFIDENCE_LABEL = { HIGH: "alta", MEDIUM: "média", LOW: "baixa" };

// Exibe o nível de confiabilidade da leitura automática.
// Chamar com null esconde a tarja (prévia inexistente ou obsoleta).
function renderConfidence(quote){
  const el = $("confidencePill");
  if(!el) return;
  const level = (quote && quote.meta) ? quote.meta.confidence : null;
  if(!level){
    el.hidden = true;
    el.className = "confidencePill";
    el.textContent = "";
    return;
  }
  const count = (quote.meta.warnings || []).length;
  el.className = "confidencePill show conf-" + String(level).toLowerCase();
  el.hidden = false;
  const plural = count === 1 ? "1 aviso" : count + " avisos";
  el.textContent = level === "HIGH"
    ? "Confiabilidade da leitura: alta. Nenhum aviso do motor."
    : `Confiabilidade da leitura: ${CONFIDENCE_LABEL[level] || level}. ${plural} para revisar antes de enviar.`;
}

function enhanceAccessibility(){
  document.querySelectorAll(".field").forEach(field => {
    const label = field.querySelector(":scope > label:not([for])");
    const control = field.querySelector(":scope > input[id], :scope > select[id], :scope > textarea[id]");
    if(label && control && label.textContent.trim()) label.htmlFor = control.id;
  });
  ["itin","maskAll","maskADT","maskCHD","maskINF"].forEach(id => {
    const el = $(id);
    if(el) el.setAttribute("spellcheck", "false");
  });
}

// ─── UI (inalterada) ──────────────────────────────────────────────────────────

function refreshOptionalUI(){
  const c = $("fldCondicao").value;
  $("fldCondOutroWrap").style.display = (c==="Outro") ? "" : "none";
  const cc = $("payCartao").checked;
  $("payLinkWrap").style.display = cc ? "" : "none";
  $("payParcelWrap").style.display = cc ? "" : "none";
  const am = $("fldAssentosMode").value;
  $("fldAssentosCustomWrap").style.display = (am==="custom") ? "" : "none";
}
function refreshPaxUI(){
  const qADT = +$("qADT").value || 0;
  const qCHD = +$("qCHD").value || 0;
  const qINF = +$("qINF").value || 0;
  $("maskCHDWrap").style.display = qCHD>0 ? "" : "none";
  $("maskINFWrap").style.display = qINF>0 ? "" : "none";
  const wantNames = $("chkNomes").checked;
  $("paxCard").style.display = wantNames ? "" : "none";
  $("paxAdultosWrap").style.display = (wantNames && qADT>0) ? "" : "none";
  $("paxCriancasWrap").style.display = (wantNames && qCHD>0) ? "" : "none";
  $("paxInfantsWrap").style.display = (wantNames && qINF>0) ? "" : "none";
  $("divChdSep").style.display = (wantNames && qCHD>0) ? "" : "none";
  $("divInfSep").style.display = (wantNames && qINF>0) ? "" : "none";
  $("paxTotalPill").textContent = (qADT+qCHD+qINF) + " no total";
  renderPaxInputs("ADT", qADT, "paxAdultosList");
  renderPaxInputs("CHD", qCHD, "paxCriancasList");
  renderPaxInputs("INF", qINF, "paxInfantsList");
}

function renderPaxInputs(type, qty, containerId){
  const box = $(containerId);
  if(!box) return;
  const current = [];
  box.querySelectorAll("input[data-pax]").forEach(inp => current.push(inp.value));
  box.innerHTML = "";
  for(let i=1;i<=qty;i++){
    const wrap = document.createElement("div");
    wrap.className = "field";
    const lab = document.createElement("label");
    lab.textContent = `Nome ${type}${i}`;
    const inp = document.createElement("input");
    inp.setAttribute("data-pax","1");
    inp.id = `name_${type}_${i}`;
    lab.htmlFor = inp.id;
    inp.placeholder = (type==="INF") ? "Ex.: SILVA/JOAO INF" : (type==="CHD" ? "Ex.: SILVA/JOAO MSTR" : "Ex.: SILVA/JOAO MR");
    inp.value = current[i-1] || "";
    wrap.appendChild(lab);
    wrap.appendChild(inp);
    box.appendChild(wrap);
  }
}

function applyAutoPax(paxList){
  const adt = paxList.filter(p=>p.type==="ADT").map(p=>p.name);
  const chd = paxList.filter(p=>p.type==="CHD").map(p=>p.name);
  const inf = paxList.filter(p=>p.type==="INF").map(p=>p.name);
  $("qADT").value = String(adt.length || 0);
  $("qCHD").value = String(chd.length || 0);
  $("qINF").value = String(inf.length || 0);
  $("chkNomes").checked = true;
  refreshPaxUI();
  for(let i=0;i<adt.length;i++){ const el = document.getElementById(`name_ADT_${i+1}`); if(el) el.value = adt[i]; }
  for(let i=0;i<chd.length;i++){ const el = document.getElementById(`name_CHD_${i+1}`); if(el) el.value = chd[i]; }
  for(let i=0;i<inf.length;i++){ const el = document.getElementById(`name_INF_${i+1}`); if(el) el.value = inf[i]; }
  $("autoPaxSuggest").style.display = "none";
  setStatus("Passageiros preenchidos pelo itinerário");
  scheduleDraftSave();
}

function collectPaxNames(){
  const out = { ADT: [], CHD: [], INF: [] };
  const qADT = +$("qADT").value || 0;
  const qCHD = +$("qCHD").value || 0;
  const qINF = +$("qINF").value || 0;
  function grab(type, qty){
    for(let i=1;i<=qty;i++){
      const el = document.getElementById(`name_${type}_${i}`);
      const v = (el && el.value) ? el.value.trim() : "";
      if(v) out[type].push(v);
    }
  }
  grab("ADT", qADT); grab("CHD", qCHD); grab("INF", qINF);
  return out;
}

function applyCombinedPricingInput({ overwrite = false, announce = true } = {}){
  const raw = $("maskAll").value.trim();
  if(!raw) return { masks: { ADT: "", CHD: "", INF: "" }, counts: null, itinerary: "" };

  const result = splitCombinedPricingMasks(raw);
  const found = [];
  for(const type of ["ADT", "CHD", "INF"]){
    const field = $(`mask${type}`);
    if(result.masks[type] && (overwrite || !field.value.trim())){
      field.value = result.masks[type];
    }
    if(result.masks[type]) found.push(type);
  }

  if(result.counts){
    $("qADT").value = String(result.counts.ADT);
    $("qCHD").value = String(result.counts.CHD);
    $("qINF").value = String(result.counts.INF);
  }
  if(result.itinerary && !$("itin").value.trim()) $("itin").value = result.itinerary;
  refreshPaxUI();

  const expected = result.counts
    ? ["ADT", "CHD", "INF"].filter(type => result.counts[type] > 0)
    : found;
  const missing = expected.filter(type => !result.masks[type]);
  const status = $("maskSplitStatus");
  if(status){
    status.textContent = found.length
      ? `Identificados: ${found.join(", ")}${missing.length ? `. Faltando: ${missing.join(", ")}` : ""}`
      : "Nenhuma máscara por passageiro foi identificada";
    status.classList.toggle("warn", !found.length || missing.length > 0);
  }
  if(found.length) $("maskReview").open = missing.length > 0;

  if(announce){
    setStatus(found.length ? "Máscaras distribuídas para revisão" : "Não foi possível separar as máscaras", !found.length);
    scheduleDraftSave();
    markPreviewDirty();
  }
  return result;
}

$("fldCondicao").addEventListener("change", refreshOptionalUI);
["payFaturado","payCartao","payDeposito"].forEach(id => $(id).addEventListener("change", refreshOptionalUI));
$("fldAssentosMode").addEventListener("change", refreshOptionalUI);
["qADT","qCHD","qINF","chkNomes"].forEach(id => $(id).addEventListener("input", refreshPaxUI));
$("fldLOC").addEventListener("input", (e)=>{ e.target.value = e.target.value.toUpperCase(); });
refreshOptionalUI();
refreshPaxUI();
