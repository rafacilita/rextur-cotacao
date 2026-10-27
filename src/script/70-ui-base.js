// [70-ui-base] UI: $, helpers de status/erro e estado de interface

const $ = (id) => document.getElementById(id);

// ─── UTILITÁRIOS (inalterados) ────────────────────────────────────────────────

(function initTheme(){
  const sel = document.getElementById("themeSel");
  const saved = localStorage.getItem("cotacao_theme_v2");
  const theme = (saved === "light" || saved === "dark") ? saved : "light";
  document.body.setAttribute("data-theme", theme);
  if(sel){
    sel.value = theme;
    sel.addEventListener("change", () => {
      const v = sel.value === "light" ? "light" : "dark";
      document.body.setAttribute("data-theme", v);
      localStorage.setItem("cotacao_theme_v2", v);
      setStatus("Tema: " + (v==="light" ? "Claro" : "Escuro"));
      setTimeout(()=>{ try{ setStatus("Pronto"); }catch(e){} }, 1500);
    });
  }
})();
function setStatus(msg, warn=false){
  const el = $("statusPill");
  el.textContent = msg;
  el.classList.toggle("warn", !!warn);
}
function clearError(){
  const det = document.getElementById("errDetails");
  const pre = document.getElementById("errText");
  if(pre) pre.textContent = "";
  if(det){ det.open = false; det.style.display = "none"; }
}
function showError(e){
  const det = document.getElementById("errDetails");
  const pre = document.getElementById("errText");
  const msg = (e && (e.stack || e.message)) ? (e.stack || e.message) : String(e);
  if(pre) pre.textContent = msg;
  if(det){ det.style.display = ""; det.open = true; }
}

const DRAFT_STORAGE_KEY = "cotacao_inter_draft_v1";
let draftSaveTimer = null;
let validationActivated = false;
let previewDirty = false;
let cabinConfirmState = null; // { itinText, cabins: [...] } | null
