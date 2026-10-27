// [72-ui-cambio-bcb] UI: cambio automatico (BCB) e dica de cambio

// Somente USD e automatizado. O cambio IATA/BSR de EUR e GBP segue a metodologia
// ROE da IATA, que NAO coincide com o fechamento PTAX do BCB: conferido, bate exato
// apenas para USD. Para as demais moedas o campo permanece manual de proposito.
const BCB_FX_SUPPORTED = ["USD"];
const BCB_FX_TIMEOUT_MS = 6000;
const BCB_FX_CACHE_KEY = "bcb_fx_cache_v1";

function readBcbFxCache(){
  try{ return JSON.parse(localStorage.getItem(BCB_FX_CACHE_KEY) || "{}") || {}; }
  catch(e){ return {}; }
}

function writeBcbFxCache(cache){
  try{ localStorage.setItem(BCB_FX_CACHE_KEY, JSON.stringify(cache)); }
  catch(e){ /* cota de storage cheia nao deve impedir a cotacao */ }
}

// Assinatura preservada: (usageDate, fetchFn) + options opcional para o AbortSignal.
// O default de fetchFn e resolvido com guarda porque jsdom nao expoe window.fetch.
async function fetchBcbUsdRateForUsageDate(
  usageDate = getSaoPauloUsageDate(),
  fetchFn = (typeof window !== "undefined" && typeof window.fetch === "function") ? window.fetch.bind(window) : null,
  options = {}
){
  if(typeof fetchFn !== "function"){
    throw new Error("Este ambiente nao expoe fetch para consultar o BCB.");
  }
  const endpoint = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)";
  for(let daysBack = 1; daysBack <= 10; daysBack++){
    const baseDate = new Date(usageDate.getTime());
    baseDate.setUTCDate(baseDate.getUTCDate() - daysBack);
    const queryDate = formatDateForBcb(baseDate);
    const url = `${endpoint}?@dataCotacao='${queryDate}'&$format=json`;
    const response = await fetchFn(url, { headers: { Accept: "application/json" }, signal: options.signal });
    if(!response.ok) throw new Error(`BCB respondeu com status ${response.status}`);
    const data = await response.json();
    // A resposta pode trazer boletins intermediarios (Abertura, Intermediario).
    // O cambio de referencia e o de Fechamento PTAX; o ultimo item e so fallback.
    const list = Array.isArray(data.value) ? data.value : [];
    const quote = list.find(entry => entry && entry.tipoBoletim === "Fechamento PTAX")
      || list[list.length - 1]
      || null;
    const rate = quote ? Number(quote.cotacaoVenda) : NaN;
    if(Number.isFinite(rate) && rate > 0){
      return { rate, source: "BCB", baseDate, usageDate };
    }
  }
  throw new Error("Nenhuma cotação de fechamento foi encontrada nos 10 dias anteriores.");
}

// Consulta com cache diario e tempo limite. Degrada para null em qualquer falha:
// o operador deve poder digitar o cambio a mao sem ver caixa de erro.
async function fetchBcbUsdRateCached({ force = false } = {}){
  if(!BCB_FX_SUPPORTED.includes("USD")) return null;

  const usageDate = getSaoPauloUsageDate();
  const dayKey = formatDateForBcb(usageDate);
  const cache = readBcbFxCache();
  // Cache primeiro: com a cotacao do dia em maos nao ha motivo para tocar a rede.
  if(!force && cache.USD && cache.USD.dayKey === dayKey) return cache.USD;

  if(typeof window === "undefined" || typeof window.fetch !== "function") return null;

  const controller = (typeof AbortController === "function") ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), BCB_FX_TIMEOUT_MS) : null;
  try{
    const quote = await fetchBcbUsdRateForUsageDate(usageDate, undefined, {
      signal: controller ? controller.signal : undefined
    });
    const entry = {
      rate: quote.rate,
      source: "BCB",
      baseDate: formatDateBR(quote.baseDate),
      usageDate: formatDateBR(quote.usageDate),
      dayKey
    };
    cache.USD = entry;
    writeBcbFxCache(cache);
    return entry;
  }catch(e){
    console.warn("Consulta de cambio BCB indisponivel.", e);
    return null;
  }finally{
    if(timer) clearTimeout(timer);
  }
}

// Guarda de sequencia: resposta atrasada nunca sobrescreve uma consulta mais recente.
let fxAutofillSeq = 0;

// Preenche o cambio sem atropelar valor digitado a mao nem valor vindo da mascara GDS.
// force=true (botao) ignora essa protecao e sempre atualiza.
async function maybeAutofillFx({ force = false } = {}){
  const input = $("fldFX");
  if(!input) return null;
  const canFill = () => force || !input.value.trim() || input.dataset.source === "BCB";
  if(!canFill()) return null;

  const mySeq = ++fxAutofillSeq;
  const entry = await fetchBcbUsdRateCached({ force });
  if(mySeq !== fxAutofillSeq) return null;   // outra consulta comecou depois desta
  if(!entry || !canFill()) return null;

  setFxRate(entry.rate, { source: "BCB", baseDate: entry.baseDate, usageDate: entry.usageDate }, false);
  return entry;
}

function readFxMeta(){
  const input = $("fldFX");
  return {
    source: input.dataset.source || "",
    baseDate: input.dataset.baseDate || "",
    usageDate: input.dataset.usageDate || ""
  };
}

function renderFxHint(){
  const input = $("fldFX");
  const hint = $("fxHint");
  if(!input || !hint) return;
  const rate = parseAmountAny(input.value);
  const meta = readFxMeta();

  if(rate != null && meta.source === "BCB" && meta.baseDate && meta.usageDate){
    hint.textContent = `Venda BCB de ${rate.toFixed(4).replace(".", ",")}, fechamento de ${meta.baseDate}, aplicado em ${meta.usageDate}. Vale só para o RC. A tarifa em BRL continua a do GDS.`;
  } else if(rate != null && meta.source === "GDS"){
    hint.textContent = "Câmbio lido da máscara do GDS. Vale só para o RC. A tarifa em BRL continua a do GDS.";
  } else if(rate != null){
    hint.textContent = "Câmbio preenchido à mão. Vale só para o RC. A tarifa em BRL continua a do GDS.";
  } else {
    hint.textContent = "Aplicado somente ao RC. A tarifa em BRL é a informada pelo GDS.";
  }
}

function setFxRate(rate, meta = {}, trackChange = true){
  const input = $("fldFX");
  // Vírgula decimal: o resto da interface (incluindo a dica abaixo deste campo)
  // já mostra o câmbio dessa forma. Um campo com ponto ao lado de outro com
  // vírgula para o mesmo número é o tipo de detalhe que denuncia um sistema
  // remendado em partes.
  input.value = Number(rate).toFixed(4).replace(".", ",");
  input.dataset.source = meta.source || "";
  input.dataset.baseDate = meta.baseDate || "";
  input.dataset.usageDate = meta.usageDate || "";
  renderFxHint();
  if(trackChange){
    scheduleDraftSave();
    markPreviewDirty();
  }
}
