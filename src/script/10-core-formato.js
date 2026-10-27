// [10-core-formato] NUCLEO: formatacao, numeros, datas (puro, sem DOM)
// Sem DOM/window/localStorage: roda em qualquer motor JS (ver tests/core-sem-dom.test.cjs).

function normalizeSpaces(s){ return String(s||"").replace(/\r/g,"").replace(/[ \t]+/g," ").trim(); }
function flatten(s){ return normalizeSpaces(String(s||"").replace(/\n+/g," ")); }
function trimLines(raw){ return String(raw||"").split(/\n/).map(l=>l.trim()).filter(Boolean); }
function escapeHtml(s){ return String(s||"").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function parseAmountAny(raw){
  if(raw==null) return null;
  let s = String(raw).replace(/[^0-9,.-]/g,"");
  if(!s) return null;
  const hasComma = s.includes(","), hasDot = s.includes(".");
  if(hasComma && hasDot){
    if(s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g,"").replace(",",".");
    else s = s.replace(/,/g,"");
  } else if(hasComma && !hasDot) s = s.replace(",",".");
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}
// Percentual digitado ("7", "7,5", "7%"): numero > 0 ou null. Vazio/zero/invalido = null ("sem percentual").
function parsePercent(raw){
  const v = parseAmountAny(String(raw == null ? "" : raw).replace(/%/g, ""));
  return (v != null && v > 0) ? v : null;
}
function moneyBRL(v){ if(v==null||!Number.isFinite(v)) return "—"; return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v); }
function moneyCurrency(v, currency){
  if(v==null || !Number.isFinite(v)) return "—";
  const cur = String(currency || "").toUpperCase();
  if(!/^[A-Z]{3}$/.test(cur)) return `${cur} ${v}`.trim();
  return new Intl.NumberFormat("en-US", {style:"currency", currency:cur, currencyDisplay:"code"}).format(v);
}
function moneyUSD(v){ return moneyCurrency(v, "USD"); }
function fmtTime(hhmm){
  const s = String(hhmm||"");
  if(s.length===4) return s.slice(0,2)+":"+s.slice(2);
  if(s.length===3) return "0"+s[0]+":"+s.slice(1);
  return s;
}
function inferYearFromText(all){
  const m = String(all||"").match(/\b(\d{2}[A-Z]{3})(\d{2})\b/);
  if(m){
    const yy = parseInt(m[2],10);
    if(yy>=0 && yy<=99) return 2000+yy;
  }
  return new Date().getFullYear();
}
function fmtDate(ddMMM, year){
  const map={JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};
  const dd=parseInt(ddMMM.slice(0,2),10);
  const mmm=ddMMM.slice(2,5).toUpperCase();
  const mm=map[mmm]||null;
  if(!dd||!mm) return ddMMM;
  return `${String(dd).padStart(2,"0")}/${String(mm).padStart(2,"0")}/${year}`;
}

function getSaoPauloUsageDate(now = new Date()){
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(Date.UTC(+values.year, +values.month - 1, +values.day));
}

function formatDateForBcb(date){
  return [
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    date.getUTCFullYear()
  ].join("-");
}

function formatDateBR(date){
  return [
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    date.getUTCFullYear()
  ].join("/");
}
