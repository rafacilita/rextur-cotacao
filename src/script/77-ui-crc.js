// [77-ui-crc] UI: CRC no rodape do e-mail e caixa "Abrir cotacao enviada (CRC)"
// Montagem e leitura do codigo ficam no nucleo (62-core-crc); aqui so se le/escreve a tela.

// Retrato da tela em branco, tirado ANTES do rascunho ser restaurado (o 78 chama
// restoreDraft no fim). O CRC guarda so o que difere deste retrato.
const CRC_DEFAULTS = collectDraftControls();

function currentCRC(){
  const itin = $("itin").value;
  return encodeCRC(buildCRCPayload({
    controls: collectDraftControls(),
    defaults: CRC_DEFAULTS,
    fxMeta: readFxMeta(),
    cabineSource: $("fldCabine") ? ($("fldCabine").dataset.source || "") : "",
    // cabines confirmadas no popup: sem elas, reabrir pediria a confirmacao de novo
    cabins: (cabinConfirmState && cabinConfirmState.itinText === itin) ? cabinConfirmState.cabins : null
  }));
}

// Mesmo estilo do rodape do CRR4 na Reemissao (8px, cinza claro), mas numa tabela de largura
// fixa e com o codigo quebrado em linhas de CRC_LINHA caracteres: o codigo e uma palavra so, e o
// Outlook nao quebra palavra (word-break e ignorado) -- sem isso ele alargaria o e-mail.
// A leitura (extractCRC) ja ignora as quebras de linha e o ">" de citacao.
const CRC_LINHA = 110;
function crcFooterHtml(code){
  const linhas = code.match(new RegExp(".{1," + CRC_LINHA + "}", "g")) || [code];
  return `<table role="presentation" width="${EMAIL_W}" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:${EMAIL_W}px; max-width:${EMAIL_W}px; mso-table-lspace:0pt; mso-table-rspace:0pt;"><tr><td style="padding:6px 0 0 0; border:0; font-size:8px; line-height:11px; color:#bbb;">${linhas.map(escapeHtml).join("<br>")}</td></tr></table>`;
}

function setCRCMsg(text, warn = false){
  const el = $("crcMsg");
  el.textContent = text;
  el.classList.toggle("warn", !!warn);
}

// Reabre a cotacao do CRC: a tela inteira passa a ser a do codigo (o que nao veio nele
// volta ao padrao) e a previa e gerada de novo.
function loadCRC(text){
  const payload = decodeCRC(text);                              // lanca Error com mensagem
  const st = expandCRCPayload(payload, CRC_DEFAULTS);

  // O cambio do CRC e o da cotacao original: cancela a consulta ao BCB que a abertura
  // da pagina pode ter deixado em andamento (ela sobrescreveria um cambio de origem BCB).
  fxAutofillSeq++;
  clearTimeout(draftSaveTimer);

  applyDraftPayload({ controls: st.controls, fxMeta: st.fxMeta, cabineSource: st.cabineSource });
  // nomes que estavam na tela e nao vieram no codigo
  document.querySelectorAll('main input[id^="name_"]').forEach(el => {
    if(!(el.id in st.controls)) el.value = "";
  });
  const perdidos = crcCamposNaoAplicados(payload, st.controls);
  $("maskSplitStatus").textContent = "Aguardando conteúdo";
  $("maskSplitStatus").classList.remove("warn");

  cabinConfirmState = st.cabins ? { itinText: $("itin").value, cabins: st.cabins } : null;

  // A previa da cotacao anterior sai da tela: se a geracao abaixo parar na validacao,
  // nao pode sobrar um e-mail de outra cotacao pronto para copiar.
  $("preview").innerHTML = "";
  $("preview").dataset.html = "";
  document.body.classList.remove("has-preview");
  $("subjectPill").textContent = "Assunto: —";
  window._lastQuote = null;
  renderConfidence(null);
  previewDirty = false;

  // Mesmo caminho do botao: valida, (so se faltar cabine) pergunta, gera e salva o rascunho.
  $("btnBuild").click();

  const mk = $("fldMarkup").value.trim();
  const g = (window._lastQuote && window._lastQuote.totals && window._lastQuote.totals.group) || {};
  const loc = $("fldLOC").value.trim().toUpperCase();
  const mkTxt = mk
    ? `Markup: ${mk}%${g.markupTotal > 0 ? " (" + moneyBRL(g.markupTotal) + " no grupo)" : ""}.`
    : "Sem markup.";
  const avisoPerdidos = perdidos.length
    ? ` Atenção: ${perdidos.length === 1 ? "1 campo do código não existe" : perdidos.length + " campos do código não existem"} nesta versão da calculadora (${perdidos.join(", ")}). Confira a cotação antes de usar.`
    : "";
  setCRCMsg(`Cotação reaberta${loc ? " (LOC " + loc + ")" : ""}. ${mkTxt}${avisoPerdidos}`, perdidos.length > 0);
  return st;
}

// Campos que vieram no codigo (c ou r) e nao ficaram na tela: id que nao existe mais, ou valor que a
// lista nao aceita (o select fica em outra opcao). So acontece com CRC de uma versao com tela diferente.
function crcCamposNaoAplicados(payload, controls){
  const ids = Object.keys(payload.c || {}).concat(Object.keys(payload.r || {}));
  const norm = (s) => String(s == null ? "" : s).replace(/\r\n?/g, "\n");
  return ids.filter((id, i) => ids.indexOf(id) === i && !CRC_SKIP_FIELDS.includes(id)).filter(id => {
    const el = $(id), st = controls[id];
    if(!el) return true;
    if(!st) return false;
    if("checked" in st) return !!el.checked !== !!st.checked;
    return norm(el.value) !== norm(st.value);
  });
}

$("btnLoadCRC").addEventListener("click", ()=>{
  const text = $("crcInput").value;
  if(!text.trim()){ setCRCMsg("Cole o e-mail ou o código CRC antes de carregar.", true); return; }
  try{
    loadCRC(text);
  }catch(e){
    console.warn(e);
    setCRCMsg(e && e.message ? e.message : "Não foi possível ler o CRC.", true);
  }
});
