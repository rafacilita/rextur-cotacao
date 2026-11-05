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

// Mesmo estilo do rodape do CRR4 na Reemissao (8px, cinza claro). break-all: o codigo
// e uma palavra so e, sem isso, alargaria o e-mail.
function crcFooterHtml(code){
  return `<p style="margin:6px 0 0; font-size:8px; color:#bbb; word-break:break-all; width:680px; max-width:680px;">${escapeHtml(code)}</p>`;
}

function setCRCMsg(text, warn = false){
  const el = $("crcMsg");
  el.textContent = text;
  el.classList.toggle("warn", !!warn);
}

// Reabre a cotacao do CRC: a tela inteira passa a ser a do codigo (o que nao veio nele
// volta ao padrao) e a previa e gerada de novo.
function loadCRC(text){
  const st = expandCRCPayload(decodeCRC(text), CRC_DEFAULTS);   // lanca Error com mensagem

  // O cambio do CRC e o da cotacao original: cancela a consulta ao BCB que a abertura
  // da pagina pode ter deixado em andamento (ela sobrescreveria um cambio de origem BCB).
  fxAutofillSeq++;
  clearTimeout(draftSaveTimer);

  applyDraftPayload({ controls: st.controls, fxMeta: st.fxMeta, cabineSource: st.cabineSource });
  // nomes que estavam na tela e nao vieram no codigo
  document.querySelectorAll('main input[id^="name_"]').forEach(el => {
    if(!(el.id in st.controls)) el.value = "";
  });
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
  setCRCMsg(`Cotação reaberta${loc ? " (LOC " + loc + ")" : ""}. ${mkTxt}`);
  return st;
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
