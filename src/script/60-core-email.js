// [60-core-email] NUCLEO: montagem do e-mail/HTML de saida (puro, sem DOM)
// Sem DOM/window/localStorage: roda em qualquer motor JS (ver tests/core-sem-dom.test.cjs).

// ═══════════════════════════════════════════════════════════════════════════════
// buildEmail — agora recebe QuoteModel
// Compat layer no topo mapeia quote → variáveis internas.
// TODO: corpo abaixo permanece inalterado.
// ═══════════════════════════════════════════════════════════════════════════════

function buildEmail(quote) {
  // ── Compat layer: QuoteModel → variáveis internas ───────────────────────────
  const cabine          = quote.commercial.cabine;
  const condicao        = quote.commercial.condicao;
  const rcUSD           = quote.commercial.rcUSD;
  const fxRate          = quote.iataRate ? quote.iataRate.rate : null;
  const fxCur           = quote.iataRate ? quote.iataRate.from : 'USD';
  const assentosText    = quote.commercial.assentosText;
  const multaReembolso  = (quote.commercial.penalties && quote.commercial.penalties.refund)  ? quote.commercial.penalties.refund  : '';
  const multaRemarcacao = (quote.commercial.penalties && quote.commercial.penalties.reissue) ? quote.commercial.penalties.reissue : '';
  const openTicket      = quote.commercial.openTicket;
  const loc             = quote.commercial.loc;
  const pax             = quote.passengers.counts;
  const paxNames        = quote.passengers.names;
  const itinSegs        = quote.itinerary;
  const prices          = quote.pricing;
  // ─────────────────────────────────────────────────────────────────────────────

  // Cabines divergem entre trechos (pos-confirmacao do popup, com fallback na
  // RBD crua): mostra a coluna "Classe" por trecho so quando ha divergencia;
  // caso contrario a coluna e redundante com o campo unico "Cabine" em
  // CONDICOES. Quando divergem, o campo unico de CONDICOES vira enganoso (so
  // aceita um valor) e e omitido em favor da coluna por trecho.
  const cabineMista = effectiveCabinMista(itinSegs);

  // Paleta do documento, igual a do app (ver :root em <style>), para a cotação
  // na tela e o e-mail enviado lerem como o mesmo produto.
  //
  // BRAND é o navy do logo RexturAdvance; as quatro cores do laço aparecem
  // apenas no filete sob o cabeçalho. Alerta e atenção seguem em vermelho e
  // âmbar de propósito: são sinais de estado e não podem virar cor de marca,
  // senão a agência perde a leitura de risco.
  const BRAND   = "#002554";
  const SWIRL   = ["#ed458f", "#8c4593", "#04a8db", "#f2a75e"];
  const LINE    = "#d7dee7";
  const SECTION = "#f3f5f8";
  const INK     = "#1a2433";
  const MUTED   = "#5a6a7d";
  const ACCENT  = BRAND;
  const ALERT_BG  = "#fdf4f2";
  const ALERT_INK = "#a8321f";
  const WARN_INK  = "#8a5a06";
  // Filete da marca em celulas solidas: gradiente CSS nao sobrevive ao Outlook.
  const brandRule = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:100%; margin:0; mso-table-lspace:0pt; mso-table-rspace:0pt;"><tr>`
    + SWIRL.map(c => `<td width="25%" style="width:25%; height:3px; line-height:3px; font-size:0; background-color:${c};">&nbsp;</td>`).join("")
    + `</tr></table>`;
  const cell = `border:1px solid ${LINE}; padding:8px 10px;`;
  const sectionBar = (text) =>
    `<div style="margin-top:16px; padding:8px 16px; background:${SECTION}; border:1px solid ${LINE}; border-left:3px solid ${ACCENT}; font-weight:700; font-size:12px; letter-spacing:.03em; color:${INK}; text-transform:uppercase;">${text}</div>`;

  // bagSegs vem indexado por trecho AEREO precificado, mas itinSegs inclui
  // linhas de superficie (ARNK). Sem essa projecao a coluna BAG desalinha.
  const airSegs = itinSegs.filter(s => s && !s.surface);
  const airIndexOf = [];
  { let n = 0; itinSegs.forEach((s, i) => { airIndexOf[i] = (s && s.surface) ? -1 : n++; }); }

  const route = buildRouteString(itinSegs);
  const carrier = airSegs[0] ? airSegs[0].airline : "—";

  const segCount = airSegs.length;
  const typesPresent = [];
  if(pax.adt>0) typesPresent.push("ADT");
  if(pax.chd>0) typesPresent.push("CHD");
  if(pax.inf>0) typesPresent.push("INF");

  const bagByType = {};
  for(const t of typesPresent){
    const pr = prices ? prices[t] : null;
    let arr = (pr && Array.isArray(pr.bagSegs)) ? pr.bagSegs.slice() : [];
    if((!arr || !arr.length) && pr && pr.bag){ arr = Array(segCount).fill(pr.bag); }
    if(!arr) arr = [];
    if(arr.length && arr.length < segCount){ const last = arr[arr.length-1]; while(arr.length < segCount) arr.push(last); }
    if(arr.length > segCount) arr = arr.slice(0, segCount);
    bagByType[t] = arr;
  }

  const bagSameAcrossTypes = (() => {
    if(!typesPresent.length) return true;
    for(let i=0;i<segCount;i++){
      let v=null;
      for(const t of typesPresent){
        const b = (bagByType[t] && bagByType[t][i]) ? bagByType[t][i] : null;
        if(b==null) continue;
        if(v==null) v=b;
        else if(b!==v) return false;
      }
    }
    return true;
  })();

  const itinHeadExtra = (!typesPresent.length) ? "" : (
    bagSameAcrossTypes
      ? `<th style="${cell} background:${SECTION}; color:${INK}; text-align:left;">Bagagem</th>`
      : typesPresent.map(t => `<th style="${cell} background:${SECTION}; color:${INK}; text-align:left;">Bagagem ${t}</th>`).join("")
  );

  const itinColspan = (cabineMista ? 5 : 4) + (!typesPresent.length ? 0 : (bagSameAcrossTypes ? 1 : typesPresent.length));

  const itinRows = itinSegs.map((s, idx) => {
    // Trecho terrestre (ARNK): o cliente troca de aeroporto por terra, sem voo.
    if (s.surface) {
      return `
      <tr>
        <td colspan="${itinColspan}" style="${cell} font-size:12px; color:${MUTED}; font-style:italic; text-align:center; background:${SECTION};">
          Trecho terrestre, sem voo associado
        </td>
      </tr>`;
    }

    const vooLabel = `${escapeHtml(s.airline)} ${escapeHtml(s.flight)}`.trim();
    const op = (s.opCarrier && s.opFlight)
      ? `${escapeHtml(s.opCarrier)}${escapeHtml(s.opFlight)}`
      : (s.opName ? escapeHtml(s.opName) : '');
    const subLines = [];
    if (op) subLines.push(`Operado por ${op}`);
    if (s.equipment) {
      // Nome legivel quando conhecido. Codigo desconhecido aparece cru, mas
      // rotulado, para a agencia saber que e codigo e nao nome de aviao.
      const nomeEquip = equipmentName(s.equipment);
      subLines.push(nomeEquip ? escapeHtml(nomeEquip) : `Equip. ${escapeHtml(s.equipment)}`);
    }
    let vooCell = `<div style="font-weight:600;">${vooLabel}</div>`;
    vooCell += subLines.map(t => `<div style="font-size:11px; color:${MUTED}; margin-top:2px;">${t}</div>`).join("");

    // Manual Amadeus p.12: "1525+1" é horário estimado de chegada no dia seguinte.
    const chegadaDisplay = `${escapeHtml(s.arrDateFmt)} ${escapeHtml(s.arrTimeFmt)}`
      + (s.arrDayOffset ? `<span style="color:${WARN_INK}; font-weight:600;"> (+${s.arrDayOffset} dia)</span>` : '');

    // Ordinal do trecho aereo: e por ele que bagSegs deve ser consultado, nunca por idx.
    const bagIdx = airIndexOf[idx];
    const renderBagTd = (v) => {
      const txt = v || "—";
      const noBag = normalizeBagAllowance(txt) === "Sem Bag";
      const extra = noBag ? `font-weight:700; color:${ALERT_INK}; background:${ALERT_BG};` : "";
      return `<td style="${cell} ${extra}">${escapeHtml(txt)}</td>`;
    };
    let bagCells = "";
    if (typesPresent.length) {
      if (bagSameAcrossTypes) {
        let b = null;
        for (const t of typesPresent) {
          const v = (bagByType[t] && bagByType[t][bagIdx]) ? bagByType[t][bagIdx] : null;
          if(v != null){ b = v; break; }
        }
        bagCells = renderBagTd(b);
      } else {
        bagCells = typesPresent.map(t => {
          const v = (bagByType[t] && bagByType[t][bagIdx]) ? bagByType[t][bagIdx] : null;
          return renderBagTd(v);
        }).join("");
      }
    }

    const orgName = iataToName(s.org);
    const dstName = iataToName(s.dst);
    const orgDisplay = orgName ? escapeHtml(orgName) : escapeHtml(s.org||'—');
    const dstDisplay = dstName ? escapeHtml(dstName) : escapeHtml(s.dst||'—');
    const codesSub = (orgName || dstName)
      ? `<div style="font-size:11px; color:${MUTED}; margin-top:1px;">${escapeHtml(s.org||'')} → ${escapeHtml(s.dst||'')}</div>`
      : '';
    const trechoCell = `<div style="font-weight:600;">${orgDisplay} → ${dstDisplay}</div>${codesSub}`;

    return `
    <tr>
      <td style="${cell}">${vooCell}</td>
      ${cabineMista ? `<td style="${cell}">${escapeHtml(s.cabinConfirmed || s.rbd || "—")}</td>` : ""}
      <td style="${cell}">${trechoCell}</td>
      <td style="${cell}">${escapeHtml(s.depDateFmt)} ${escapeHtml(s.depTimeFmt)}</td>
      <td style="${cell}">${chegadaDisplay}</td>
      ${bagCells}
    </tr>
  `;
  }).join("");

  const pay = (quote.commercial && quote.commercial.payment) || { methods: [], link: "" };

  // Totais vem prontos de applyTotalsByPax. Recalcular aqui era a origem da
  // divergencia de centavos entre o e-mail e o KPI: o motor arredonda o RC por
  // passageiro antes de multiplicar, que e a ordem correta para cobranca.
  const modelTotals = quote.totals || {};
  const byType = modelTotals.byType || {};
  const rows = [{t:"ADT", q:pax.adt},{t:"CHD", q:pax.chd},{t:"INF", q:pax.inf}]
    .filter(o => o.q > 0)
    .map(o => Object.assign({ type:o.t, qty:o.q }, byType[o.t] || {}));
  const groupTotal = (modelTotals.group && modelTotals.group.grandTotal != null)
    ? modelTotals.group.grandTotal
    : null;

  // Descrição legível da composição do grupo, para quem lê o e-mail sem
  // precisar conhecer os códigos ADT/CHD/INF do GDS.
  const pluralize = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;
  const noteParts = [];
  if (pax.adt) noteParts.push(pluralize(pax.adt, "adulto", "adultos"));
  if (pax.chd) noteParts.push(pluralize(pax.chd, "criança", "crianças"));
  if (pax.inf) noteParts.push(pluralize(pax.inf, "bebê", "bebês"));

  const optItems = [];
  const fareFamilies = [];
  for(const t of typesPresent){
    const pr = prices ? prices[t] : null;
    const arr = pr && Array.isArray(pr.fareFamilies) && pr.fareFamilies.length ? pr.fareFamilies : (pr && pr.fareFamily ? [pr.fareFamily] : []);
    arr.forEach(f => {
      const label = `${t}: ${f}`;
      if(f && !fareFamilies.includes(label)) fareFamilies.push(label);
    });
  }
  if(fareFamilies.length) optItems.push(["Família tarifária", escapeHtml(fareFamilies.join(" | "))]);
  if(cabine && !cabineMista) optItems.push(["Cabine", escapeHtml(cabine)]);
  if(pay.methods.length) optItems.push(["Forma de pagamento", escapeHtml(pay.methods.join(", ")) + (pay.link ? ` — link: ${escapeHtml(pay.link)}` : "")]);
  if(condicao) optItems.push(["Condição", escapeHtml(condicao)]);
  if(assentosText) optItems.push(["Assentos", escapeHtml(assentosText)]);
  if(multaReembolso) optItems.push(["Multa de reembolso", escapeHtml(multaReembolso)]);
  if(multaRemarcacao) optItems.push(["Multa de remarcação", escapeHtml(multaRemarcacao)]);
  if(openTicket) optItems.push(["Permite bilhete em aberto", escapeHtml(openTicket)]);

  const subject = `Cotação INTER – ${route} – ${carrier}${loc ? " – LOC "+loc : ""}`;

  const includeRC = (parseAmountAny(rcUSD)!=null && parseAmountAny(rcUSD)>0 && fxRate!=null && fxRate>0);
  // RAV = comissao da agencia: coluna propria, somada ao total. So aparece com percentual definido
  // (vazio = "A definir": o e-mail sai como sempre saiu). O markup NAO aparece em lugar nenhum: ja esta na tarifa.
  const includeRAV = rows.some(r => r.ravPerPax != null && r.ravPerPax > 0);
  const valuesColspan = 5 + (includeRC ? 1 : 0) + (includeRAV ? 1 : 0);

  const valuesHead = `
      <tr>
        <th style="${cell} background:${SECTION}; color:${INK}; text-align:left;">Tipo</th>
        <th style="${cell} background:${SECTION}; color:${INK}; text-align:left;">Tarifa (moeda)</th>
        <th style="${cell} background:${SECTION}; color:${INK}; text-align:left;">Tarifa (BRL)</th>
        <th style="${cell} background:${SECTION}; color:${INK}; text-align:left;">Taxas (BRL)</th>
        ${includeRC ? `<th style="${cell} background:${SECTION}; color:${INK}; text-align:left;">RC (BRL)</th>` : ``}${includeRAV ? `<th style="${cell} background:${SECTION}; color:${INK}; text-align:left;">RAV (BRL)</th>` : ``}
        <th style="${cell} background:${SECTION}; color:${INK}; text-align:left;">Total (BRL)</th>
      </tr>`;

  const PAX_LABEL = { ADT: "Adulto", CHD: "Criança", INF: "Bebê" };

  const valuesRows = rows.map(r => {
    // totalPerPax ja inclui o RC arredondado por passageiro.
    const finalTotal = includeRC
      ? (r.totalPerPax != null ? r.totalPerPax : null)
      : (r.equivPerPax != null && r.taxesPerPax != null ? +(r.equivPerPax + r.taxesPerPax + (includeRAV ? (r.ravPerPax || 0) : 0)).toFixed(2) : r.totalPerPax);
    return `
    <tr>
      <td style="${cell} font-weight:600;">${PAX_LABEL[r.type] || r.type} × ${r.qty}</td>
      <td style="${cell}">${(r.fareCurrency && r.farePerPax!=null) ? escapeHtml(moneyCurrency(r.farePerPax, r.fareCurrency)) : "—"}</td>
      <td style="${cell}">${r.equivPerPax!=null ? moneyBRL(r.equivPerPax) : "—"}</td>
      <td style="${cell}">${r.taxesPerPax!=null ? moneyBRL(r.taxesPerPax) : "—"}</td>
      ${includeRC ? `<td style="${cell}">${moneyBRL(r.rcPerPax||0)}</td>` : ``}${includeRAV ? `<td style="${cell}">${r.ravPerPax!=null ? moneyBRL(r.ravPerPax) : "—"}</td>` : ``}
      <td style="${cell} font-weight:700;">${finalTotal!=null ? moneyBRL(finalTotal) : "—"}</td>
    </tr>
  `;
  }).join("");

  const fxRateDisplay = fxRate!=null ? String(+fxRate.toFixed(4)).replace(".", ",") : null;

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color:${INK};">
  <div style="width:680px; max-width:680px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:100%; font-size:14px; mso-table-lspace:0pt; mso-table-rspace:0pt;">
      <tr>
        <td colspan="2" style="padding:0; border:0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:100%; mso-table-lspace:0pt; mso-table-rspace:0pt;">
            <tr>
              <td bgcolor="${BRAND}" style="background-color:${BRAND}; padding:14px 16px 2px 16px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:100%; mso-table-lspace:0pt; mso-table-rspace:0pt;">
                  <tr><td style="font-family:Arial, Helvetica, sans-serif; font-size:11px; font-weight:bold; color:#c9d6e8;">RexturAdvance</td></tr>
                  <tr><td style="font-family:Arial, Helvetica, sans-serif; font-size:17px; font-weight:bold; color:#ffffff; padding-top:3px; padding-bottom:12px;">Cotação INTER &mdash; Nova emissão</td></tr>
                </table>
              </td>
            </tr>
          </table>
          ${brandRule}
        </td>
      </tr>
      <tr>
        <td colspan="2" style="${cell} font-size:12px; color:${MUTED};">
          Valores sujeitos a disponibilidade e a alteração tarifária até a emissão do bilhete.
        </td>
      </tr>
      <tr>
        <td style="${cell} width:30%;"><b>Cia aérea</b></td>
        <td style="${cell}">${escapeHtml(carrier||"—")}</td>
      </tr>
      <tr>
        <td style="${cell}"><b>Prazo / validade</b></td>
        <td style="${cell}">${escapeHtml("Imediato")}</td>
      </tr>
      ${fxRateDisplay ? `
      <tr>
        <td style="${cell}"><b>Câmbio (BRL/${escapeHtml(fxCur||"USD")})</b></td>
        <td style="${cell}">${escapeHtml(fxRateDisplay)}</td>
      </tr>` : ``}
      ${loc ? `
      <tr>
        <td style="${cell}"><b>Localizador</b></td>
        <td style="${cell}">${escapeHtml(loc)}</td>
      </tr>` : ``}
    </table>

    ${optItems.length ? `
      ${sectionBar("Condições")}
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:100%; font-size:13px; border-top:none; mso-table-lspace:0pt; mso-table-rspace:0pt;">
        ${optItems.map(([label, val]) => `<tr><td style="${cell} width:30%;"><b>${label}</b></td><td style="${cell}">${val}</td></tr>`).join("")}
      </table>
    ` : ""}

    ${(paxNames && (paxNames.ADT.length || paxNames.CHD.length || paxNames.INF.length)) ? `
      ${sectionBar("Passageiros")}
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:100%; font-size:13px; border-top:none; mso-table-lspace:0pt; mso-table-rspace:0pt;">
        ${(paxNames.ADT||[]).map(n=>`<tr><td style="${cell} width:14%;"><b>Adulto</b></td><td style="${cell}">${escapeHtml(n)}</td></tr>`).join("")}
        ${(paxNames.CHD||[]).map(n=>`<tr><td style="${cell} width:14%;"><b>Criança</b></td><td style="${cell}">${escapeHtml(n)}</td></tr>`).join("")}
        ${(paxNames.INF||[]).map(n=>`<tr><td style="${cell} width:14%;"><b>Bebê</b></td><td style="${cell}">${escapeHtml(n)}</td></tr>`).join("")}
      </table>
    ` : ""}

    ${sectionBar("Itinerário")}
    ${(!typesPresent.length) ? "" : `<div style="${cell} border-top:none; font-size:12px; color:${MUTED};">${bagSameAcrossTypes ? "Franquia de bagagem por trecho de voo." : "Franquia de bagagem por trecho de voo, podendo variar entre os tipos de passageiro."}</div>`}
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:100%; font-size:13px; margin-bottom:4px; border-top:none; mso-table-lspace:0pt; mso-table-rspace:0pt;">
      <tr>
        <th style="${cell} background:${SECTION}; color:${INK}; text-align:left;">Voo</th>
        ${cabineMista ? `<th style="${cell} background:${SECTION}; color:${INK}; text-align:left;">Classe</th>` : ""}
        <th style="${cell} background:${SECTION}; color:${INK}; text-align:left;">Trecho</th>
        <th style="${cell} background:${SECTION}; color:${INK}; text-align:left;">Saída</th>
        <th style="${cell} background:${SECTION}; color:${INK}; text-align:left;">Chegada</th>
        ${itinHeadExtra}
      </tr>
      ${itinRows || `<tr><td colspan="${itinColspan}" style="${cell}">Cole o itinerário para exibir os trechos.</td></tr>`}
    </table>

    ${sectionBar("Valores por passageiro")}
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:100%; font-size:13px; border-top:none; mso-table-lspace:0pt; mso-table-rspace:0pt;">
      ${valuesHead}
      ${valuesRows || `<tr><td colspan="${valuesColspan}" style="${cell}">Cole as máscaras para exibir os valores.</td></tr>`}
    </table>
    ${includeRC ? `<div style="margin-top:8px; font-size:12px; color:${MUTED};">O RC é cobrado <b>por passageiro</b>, em USD, e somado ao total em BRL.</div>` : ``}${includeRAV ? `<div style="margin-top:8px; font-size:12px; color:${MUTED};">A RAV (comissão da agência) é de <b>${escapeHtml(String(+parsePercent(quote.commercial.ravPct).toFixed(2)).replace(".", ","))}%</b> sobre a tarifa, por passageiro, e já está somada ao total.</div>` : ``}

    <div style="margin-top:14px; font-size:13px;">
      <b>Total estimado do grupo:</b> ${groupTotal != null ? moneyBRL(groupTotal) : "—"}${noteParts.length ? ` (${escapeHtml(noteParts.join(", "))})` : ""}
    </div>
  </div>
  </div>`.trim();

  return { html, subject };
}
