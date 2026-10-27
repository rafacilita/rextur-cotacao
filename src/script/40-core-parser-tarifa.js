// [40-core-parser-tarifa] NUCLEO: parsers de tarifa (Amadeus/Sabre), impostos, bagagem, separacao de mascaras (puro, sem DOM)
// Sem DOM/window/localStorage: roda em qualquer motor JS (ver tests/core-sem-dom.test.cjs).

function detectPaxCountsFromPricing(raw){
  const counts = { ADT: 0, CHD: 0, INF: 0 };
  const lines = String(raw || "").split(/\r?\n/);
  const commandLine = lines.find(line => {
    const up = line.toUpperCase();
    return !/\bBRL\b/.test(up)
      && /(?:^|\/|P)\s*\d+\s*(?:ADT|CNN|CHD|INF)(?:\b|\/)/.test(up);
  });
  if(!commandLine) return null;

  for(const match of commandLine.matchAll(/(\d+)\s*(ADT|CNN|CHD|INF)\b/gi)){
    const type = /CNN|CHD/i.test(match[2]) ? "CHD" : match[2].toUpperCase();
    counts[type] = parseInt(match[1], 10) || 0;
  }
  return counts.ADT + counts.CHD + counts.INF > 0 ? counts : null;
}

function classifySabrePricingBlock(block){
  const up = String(block || "").toUpperCase();
  if(/\b(?:INF-\d+|PINF)\b/.test(up) || /\bBRL\s*[0-9][0-9.,]*\s*INF\b/.test(up)) return "INF";
  if(/\b(?:CNN-\d+|CHD-\d+|PCNN|PCHD)\b/.test(up) || /\bBRL\s*[0-9][0-9.,]*\s*(?:CNN|CHD)\b/.test(up)) return "CHD";
  if(/\b(?:ADT-\d+|PADT)\b/.test(up) || /\bBRL\s*[0-9][0-9.,]*\s*ADT\b/.test(up)) return "ADT";
  return null;
}

function splitSabrePricingMasks(raw){
  const text = String(raw || "").replace(/\r/g, "");
  const lines = text.split("\n");
  const starts = [];
  lines.forEach((line, index) => {
    if(/^\s*PQ\s+\d+\s+\S+/i.test(line.replace(/[¥¤]/g, " "))) starts.push(index);
  });

  // Depois do ultimo PQ, o retorno pode trazer uma secao "WP«"/"WP*BAG«" com
  // franquia por passageiro numerado (ex.: ADT-02), estrutura diferente da do
  // PQ e que ainda nao sabemos atribuir ao tipo certo com confianca. Sem este
  // limite, essa secao vazava para dentro do ULTIMO PQ do retorno (em geral o
  // INF, por ser o ultimo bloco), misturando franquia de um passageiro com a
  // leitura de outro.
  const limiteWpIdx = lines.findIndex(line => /^\s*WP\s*«?\s*$|^\s*WP\*BAG\b/i.test(line));
  const limite = limiteWpIdx >= 0 ? limiteWpIdx : lines.length;

  const masks = { ADT: "", CHD: "", INF: "" };
  for(let i = 0; i < starts.length; i++){
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : limite;
    const block = lines.slice(start, end).join("\n").trim();
    const type = classifySabrePricingBlock(block);
    if(type) masks[type] = masks[type] ? `${masks[type]}\n\n${block}` : block;
  }

  // WP consolidado: usa a linha tarifária identificada quando não há PQ separado.
  for(const line of lines){
    const type = classifySabrePricingBlock(line);
    if(type && !masks[type] && /\b[A-Z]{3}\s*[0-9][0-9.,]*\s+BRL\s*[0-9]/i.test(line)){
      masks[type] = line.trim();
    }
  }

  const pricingStart = lines.findIndex(line => /^\s*(?:WPP|WPNC|WP\/|PQ[«\s])/i.test(line));
  const itinerary = pricingStart > 0 ? lines.slice(0, pricingStart).join("\n").trim() : "";
  return {
    masks,
    counts: detectPaxCountsFromPricing(text),
    itinerary
  };
}

function classifyAmadeusPricingBlock(block){
  const up = String(block || "").toUpperCase();
  const summaryLine = up.split(/\r?\n/).find(line => /^\s*\d{2}\s+\S+/.test(line)) || "";
  const header = summaryLine.match(/\*\s*(?:\*\s*)?(CH|IN)\s*\*/);
  if(header) return header[1] === "IN" ? "INF" : "CHD";
  if(/\/IN\d*\b/.test(up) || /\bIN\d*\+?\*\s*\*\s*IN\b/.test(up)) return "INF";
  if(/\/CH\d*\b/.test(up) || /\bCH\d*\+?\*\s*\*\s*CH\b/.test(up)) return "CHD";
  return /\bLAST TKT DTE\b/.test(up) && /\b[A-Z]{3}\s+[0-9]/.test(up) ? "ADT" : null;
}

function splitAmadeusPricingMasks(raw){
  const text = String(raw || "").replace(/\r/g, "");
  const lines = text.split("\n");
  const starts = [];

  lines.forEach((line, index) => {
    const command = line.trim().match(/^FQQ(\d+)\s*$/i);
    if(!command) return;
    let next = index + 1;
    while(next < lines.length && !lines[next].trim()) next++;
    if(new RegExp(`^\\s*${command[1]}\\s+`).test(lines[next] || "")) starts.push(index);
  });

  const masks = { ADT: "", CHD: "", INF: "" };
  for(let i = 0; i < starts.length; i++){
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
    const block = lines.slice(start, end).join("\n").trim();
    const type = classifyAmadeusPricingBlock(block);
    if(type) masks[type] = masks[type] ? `${masks[type]}\n\n${block}` : block;
  }

  const foundTypes = ["ADT", "CHD", "INF"].filter(type => masks[type]);
  const explicitCounts = detectPaxCountsFromPricing(text);
  const counts = explicitCounts || {
    ADT: masks.ADT ? 1 : 0,
    CHD: masks.CHD ? 1 : 0,
    INF: masks.INF ? 1 : 0
  };
  const itinerary = starts.length ? lines.slice(0, starts[0]).join("\n").trim() : "";
  return { masks, counts: foundTypes.length ? counts : null, itinerary };
}

function splitCombinedPricingMasks(raw){
  const text = String(raw || "");
  if(/^\s*FQQ\d+\s*$/im.test(text)) return splitAmadeusPricingMasks(text);
  return splitSabrePricingMasks(text);
}

/**
 * Resolve código IATA para nome legível.
 * Retorna só o nome (sem o código) — quem chama decide o formato de exibição.
 */
function iataToName(code) {
  if (!code) return null;
  return IATA_NAMES[String(code).trim().toUpperCase()] || null;
}

function buildRouteString(segs){
  // Somente trechos aereos entram na rota: ARNK nao tem org/dst e contaminaria a string.
  const air = (segs || []).filter(s => s && !s.surface && s.org && s.dst);
  if(!air.length) return "\u2014";
  let parts=[air[0].org];
  let lastDest=null;
  for(const s of air){
    if(lastDest && s.org!==lastDest){ parts.push("//", s.org); }
    parts.push(s.dst);
    lastDest=s.dst;
  }
  return parts.join("-").replace(/-\/\/-/g," // ");
}

// ─── PRICING PARSERS (inalterados) ────────────────────────────────────────────

function normalizeBagAllowance(v){
  if(v == null) return null;
  const s = String(v).replace(/\[CTRL\]/gi, " ").replace(/Â¥|¥|¤|Â¤/g, " ").trim().toUpperCase();
  if(!s || s === "—" || s === "-") return null;
  if(s === "NIL" || /^0+\s*(P|PC)$/.test(s)) return "Sem Bag";
  const m = s.match(/^0*(\d{1,2})\s*(P|PC)$/);
  if(m){
    const n = parseInt(m[1], 10);
    return n === 0 ? "Sem Bag" : `${n}PC`;
  }
  if(/SEM\s+BAG|NO\s+BAG/i.test(s)) return "Sem Bag";
  return s;
}

function extractFareFamilies(pricingRaw){
  const lines = trimLines(pricingRaw);
  const found = [];
  const add = (v) => {
    const s = String(v || "").replace(/\[CTRL\]/gi, " ").replace(/Â¥|¥|¤|Â¤/g, " ").trim();
    const parts = s.split("-");
    const normalized = parts.length === 2 && parts[0].toUpperCase() === parts[1].toUpperCase()
      ? parts[0]
      : s;
    if(normalized && !found.includes(normalized)) found.push(normalized);
  };

  for(const l0 of lines){
    const l = String(l0);
    const branded = l.match(/\bBRANDED\s+FARE\b\s*\/(.+)$/i);
    if(branded){
      branded[1].split("/").map(x => x.trim()).filter(Boolean).forEach(add);
    }

    const family = l.match(/\bFARE\s+FAMILY\s*:\s*(.+)$/i);
    if(family){
      const parts = family[1].split(":").map(x => x.trim()).filter(Boolean);
      if(parts.length) add(parts[parts.length - 1]);
    }
  }

  return found;
}

// Soma as taxas discriminadas da mascara, para conferir taxas obtidas por diferenca.
// Ha dois formatos de detalhamento no Amadeus e cada um exige uma regra propria,
// documentada dentro da funcao. Retorna { sum, found }; found em zero significa
// que nao havia taxa discriminada para cruzar.
function sumExplicitTaxLinesBRL(pricingRaw){
  const lines = trimLines(pricingRaw).map(l => String(l).replace(/[\u00a5\u00a4]/g, " ").trim());

  // Formato TSTnnn/FXP: cada taxa vem rotulada como TX001, TX002 e assim por
  // diante, varias por linha, sem linha consolidada. Aqui da para somar todas
  // as ocorrencias sem risco de contar duas vezes.
  if(lines.some(line => /\bTX\d{3}\b/i.test(line))){
    let sum = 0, found = 0;
    for(const line of lines){
      for(const m of line.matchAll(/\bTX\d{3}\b\s*(?:[A-Z]\s+)?BRL\s*([0-9][0-9.,]*)/gi)){
        const v = parseAmountAny(m[1]);
        if(v != null){ sum += v; found++; }
      }
    }
    return { sum: +sum.toFixed(2), found };
  }

  // Formato tradicional: considera apenas a PRIMEIRA coluna de taxas. Somar
  // todas as ocorrencias de "-XX" contaria duas vezes o detalhamento de XT,
  // que aparece discriminado a direita e consolidado a esquerda na mesma linha.
  let sum = 0, found = 0;
  for(const line of lines){
    let m = line.match(/^BRL\s*([0-9][0-9.,]*)\s*-\s*([A-Z]{1,3})\b/i);
    if(!m) m = line.match(/^TAX(?:ES)?\s+BRL\s*([0-9][0-9.,]*)/i);
    if(m){ const v = parseAmountAny(m[1]); if(v != null){ sum += v; found++; } }
  }
  return { sum: +sum.toFixed(2), found };
}

// Classifica taxas obtidas por diferenca (total - equivalente).
// Quando equivalente + linhas de taxa reconstroem o total, a conta esta conferida
// e NAO deve gerar aviso: esse e o caminho normal de toda mascara Amadeus.
function classifyDerivedTaxes(pricingRaw, equiv, total){
  const tl = sumExplicitTaxLinesBRL(pricingRaw);
  const derived = +(total - equiv).toFixed(2);

  // Taxa zero sem nenhuma linha de taxa na mascara e leitura coerente, nao suspeita:
  // e o caso comum de INF isento e de tarifa zero. Tudo concorda em zero.
  if(derived === 0 && tl.found === 0){
    return { taxesSource: "DERIVED_DIFF_CORROBORATED", taxLinesBRL: 0 };
  }

  // Total menor que o equivalente nunca confere: cai em DERIVED_DIFF e gera aviso.
  const reconciles = tl.found > 0 && Math.abs(+(equiv + tl.sum).toFixed(2) - total) <= 0.02;
  return {
    taxesSource: reconciles ? "DERIVED_DIFF_CORROBORATED" : "DERIVED_DIFF",
    taxLinesBRL: tl.found > 0 ? tl.sum : null
  };
}

function parsePricingAmadeus(pricingRaw){
  const lines = trimLines(pricingRaw);
  const flat = flatten(pricingRaw);
  let fareCur=null,fareAmt=null,equiv=null,taxes=null,total=null;
  // ── Bagagem por segmento ──────────────────────────────────────────────────
  // Manual Amadeus: franquia aparece como 1PC, 2PC, 0PC (=sem bag), NIL (=sem bag)
  const bagSegs = [];
  for (const l0 of lines) {
    const l = String(l0).trim();
    // NIL = sem bagagem (evita capturar "NIL" dentro de códigos de voo longos)
    if (/\bNIL\b/i.test(l) && !/^\d{3,}/.test(l.split(/\s+/)[0] || '')) {
      bagSegs.push(normalizeBagAllowance('NIL')); continue;
    }
    // Piece concept: 0PC/0P = sem bag; 1PC/2PC etc.
    const mPC = l.match(/\b(\d{1,2})\s*(PC|P)\b/i);
    if (mPC) {
      bagSegs.push(normalizeBagAllowance(`${mPC[1]}${mPC[2]}`));
      continue;
    }
    // Alguns FQQs exibem franquia em quilos apenas como 10/20/30 no fim da linha.
    const mKg = l.match(/\b\d{2}[A-Z]{3}\d{2}[A-Z]{3}\s+(\d{1,2})\s*$/i);
    if(mKg){
      bagSegs.push(`${parseInt(mKg[1], 10)}KG`);
    }
  }
  const bagUniq = [...new Set(bagSegs)];
  const bag = bagUniq.length===0 ? null : (bagUniq.length===1 ? bagUniq[0] : "VAR");
  const fareFamilies = extractFareFamilies(pricingRaw);
  // A moeda da tarifa e sempre o codigo ISO que o GDS imprime. Nao da para
  // deduzir pela origem: BKK sai em THB, mas o Brasil costuma sair em USD.
  // Entre FARE e o codigo pode vir um indicador de tipo de tarifa, como o
  // "F" de "FARE  F THB  42535", por isso ele e opcional aqui.
  const FARE_LINE_RE = /^\s*FARE\s+(?!BASIS\b)(?:[A-Z]\s+)?([A-Z]{3})\s*([0-9][0-9.,]*)/i;
  const fareLabelLine = lines.find(line => FARE_LINE_RE.test(line));
  const mFareLabel = fareLabelLine ? fareLabelLine.match(FARE_LINE_RE) : null;
  if(mFareLabel){
    fareCur=mFareLabel[1].toUpperCase();
    fareAmt=parseAmountAny(mFareLabel[2]);
  } else {
    const currencyRows = lines
      .map(line => String(line).trim().match(/^([A-Z]{3})\s+([0-9][0-9.,]*)\b/i))
      .filter(Boolean);
    const originalFareRow = currencyRows.find(match => match[1].toUpperCase() !== "BRL") || currencyRows[0];
    if(originalFareRow){
      fareCur=originalFareRow[1].toUpperCase();
      fareAmt=parseAmountAny(originalFareRow[2]);
    }
  }
  const mEq = flat.match(/\bEQUIV\b\s*BRL\s*([0-9][0-9.,]*)/i);
  if(mEq) equiv=parseAmountAny(mEq[1]);
  if(equiv==null){ const mEq2 = flat.match(/\bBRL\s*([0-9][0-9.,]*)\s+.{0,260}?(?:NUC|END|ROE)/i); if(mEq2) equiv=parseAmountAny(mEq2[1]); }
  if(equiv==null){ for(const l of lines){ const s = l.trim(); const mm = s.match(/^BRL\s*([0-9][0-9.,]*)\b/i); if(mm){ if(!/\-[A-Z]{1,3}\b/i.test(s)){ equiv=parseAmountAny(mm[1]); break; } } } }
  // Procedencia do total: EXPLICIT_TOTAL e leitura direta; os demais sao fallback.
  let totalSource = null;
  const mTot = flat.match(/\bGRAND\s+TOTAL\b\s*BRL\s*([0-9][0-9.,]*)/i) || flat.match(/\bTOTAL\b\s*BRL\s*([0-9][0-9.,]*)/i);
  if(mTot){ total=parseAmountAny(mTot[1]); totalSource = "EXPLICIT_TOTAL"; }
  if(total==null){ const brls=[]; for(const l of lines){ const mm=l.match(/^BRL\s*([0-9][0-9.,]*)\s*$/i); if(mm) brls.push(parseAmountAny(mm[1])); } if(brls.length) total=brls[brls.length-1]; }
  if(total!=null && totalSource==null) totalSource = "LAST_BRL_LINE";
  if(total==null){ const cand=[]; for(const l of lines){ const all=[...String(l).matchAll(/\bBRL\s*([0-9][0-9.,]*)\b(?!\s*-\w)/ig)]; for(const mm of all){ const v=parseAmountAny(mm[1]); if(v!=null && !isNaN(v)) cand.push(v); } } if(cand.length) total = Math.max(...cand); }
  if(total!=null && totalSource==null) totalSource = "MAX_BRL";
  // Amadeus nao tem linha de taxa consolidada: o valor sempre sai por diferenca.
  let taxesSource = null, taxLinesBRL = null;
  if(total!=null && equiv!=null){
    taxes=Math.max(0, +(total-equiv).toFixed(2));
    const classified = classifyDerivedTaxes(pricingRaw, equiv, total);
    taxesSource = classified.taxesSource;
    taxLinesBRL = classified.taxLinesBRL;
  }
  return {fareCur,fareAmt,equivBRL:equiv,taxesBRL:taxes,totalBRL:total, bag, bagSegs, fareFamily: fareFamilies[0] || null, fareFamilies, totalSource, taxesSource, taxLinesBRL};
}

// ─── BAGAGEM DIRECIONAL DO SABRE ──────────────────────────────────────────────
// O PQ do Sabre pode declarar a franquia por COMPONENTE TARIFARIO (ida/volta),
// nao por trecho fisico: "BAG ALLOWANCE -GRUJFK-01P/AA/..." cobre todo o trecho
// de GRU até JFK, mesmo que isso sejam dois voos com conexao em MIA.
//
// A leitura por linha de segmento numerada (usada em parsePricingSabre abaixo)
// so encontra franquia no ULTIMO trecho do componente, porque e so ali que a
// linha numerada carrega o codigo. Quando o PQ nao lista as linhas numeradas de
// TODOS os trechos (comum quando o PQ mostra so o componente de retorno), essa
// leitura por linha falha, e padronizar pelo ultimo valor encontrado repete a
// franquia errada nos trechos anteriores — foi exatamente o defeito relatado.
//
// Armadilhas que o regex abaixo precisa recusar, por semelhanca de texto:
//   CARRY ON ALLOWANCE ... -NNP/CIA         (bagagem de MAO, nao despachada)
//   nNDCHECKED BAG FEE-ORIGDEST-BRLvalor    (tarifa da bagagem extra, nao franquia)
// Nenhuma das duas comeca com "BAG ALLOWANCE", entao exigir esse rotulo exato
// no inicio da linha já as exclui.
function parseSabreDirectionalBagAllowances(pricingRaw){
  const out = [];
  for(const l0 of trimLines(pricingRaw)){
    const l = String(l0).replace(/[¥¤]/g, " ").trim();
    const m = l.match(/^BAG\s+ALLOWANCE\s*-\s*([A-Z]{3})([A-Z]{3})\s*-\s*(\d{1,2}P|NIL)\b/i);
    if(!m) continue;
    out.push({ from: m[1].toUpperCase(), to: m[2].toUpperCase(), bag: normalizeBagAllowance(m[3]) });
  }
  return out;
}

// Distribui as franquias direcionais pelos trechos AEREOS fisicos, na ordem do
// itinerario. Cada entrada direcional cobre do seu "from" até o primeiro trecho
// cuja chegada bate com o "to", podendo abranger mais de um trecho fisico.
//
// Se a cadeia nao bater em algum ponto — origem diferente do esperado, destino
// nunca alcançado, trecho sobrando sem direcional, ou so uma direcional para
// varios trechos — devolve null. O chamador deve manter a leitura anterior e
// avisar, nunca adivinhar qual trecho fica com qual franquia.
function assignDirectionalBagToSegments(direcionais, airSegs){
  if(!Array.isArray(direcionais) || direcionais.length < 2) return null; // caso simples, nao precisa
  if(!Array.isArray(airSegs) || !airSegs.length) return null;
  const resultado = new Array(airSegs.length).fill(null);
  let pos = 0;
  for(const dir of direcionais){
    if(pos >= airSegs.length) return null;                 // sobrou direcional sem trecho
    if(airSegs[pos].org !== dir.from) return null;          // cadeia nao bate, nao arrisca
    let achou = false;
    for(let i = pos; i < airSegs.length; i++){
      resultado[i] = dir.bag;
      if(airSegs[i].dst === dir.to){ pos = i + 1; achou = true; break; }
    }
    if(!achou) return null;                                 // nunca chegou ao destino esperado
  }
  if(pos !== airSegs.length) return null;                   // sobrou trecho sem direcional
  return resultado;
}

function parsePricingSabre(pricingRaw){
  const lines = trimLines(pricingRaw);
  const flat = flatten(pricingRaw).toUpperCase();
  const fareFamilies = extractFareFamilies(pricingRaw);
  const bagSegs = [];
  for(const l0 of lines){
    const l = String(l0).replace(/¥/g," ").trim();
    if(!/^\d{2}\b/.test(l)) continue;
    if(/\bVOID\b/i.test(l)) continue;
    const all = [...l.matchAll(/\b(\d{2}P|NIL)\b/gi)];
    if(all.length){ const last = all[all.length-1][1].toUpperCase(); bagSegs.push(normalizeBagAllowance(last)); }
  }
  const uniq = [...new Set(bagSegs)];
  const bag = uniq.length===0 ? null : (uniq.length===1 ? uniq[0] : "VAR");
  for(const line of lines){
    const normalized = String(line).replace(/[¥¤]/g, " ").trim();
    const m = normalized.match(/^([A-Z]{3})\s*([0-9][0-9.,]*)\s+BRL\s*([0-9][0-9.,]*)(?:\s+(?:BRL\s*)?([0-9][0-9.,]*)\s*[A-Z0-9]{2,3})?\s+BRL\s*([0-9][0-9.,]*)\s*(?:ADT|CNN|CHD|INF)?\b/i);
    if(m){
      const equivBRL = parseAmountAny(m[3]);
      const totalBRL = parseAmountAny(m[5]);
      const taxesRead = m[4] != null;
      const taxesBRL = taxesRead
        ? parseAmountAny(m[4])
        : (equivBRL != null && totalBRL != null ? Math.max(0, +(totalBRL - equivBRL).toFixed(2)) : null);
      let taxesSource = null, taxLinesBRL = null;
      if(taxesRead){ taxesSource = "READ"; }
      else if(equivBRL != null && totalBRL != null){
        const classified = classifyDerivedTaxes(pricingRaw, equivBRL, totalBRL);
        taxesSource = classified.taxesSource;
        taxLinesBRL = classified.taxLinesBRL;
      }
      return {
        totalSource: totalBRL != null ? "READ_LINE" : null,
        taxesSource,
        taxLinesBRL,
        fareCur: m[1].toUpperCase(),
        fareAmt: parseAmountAny(m[2]),
        equivBRL,
        taxesBRL,
        totalBRL,
        bag,
        bagSegs,
        fareFamily: fareFamilies[0] || null,
        fareFamilies
      };
    }
  }
  const patterns = [
    /\b([A-Z]{3})\s*([0-9][0-9.,]*)\s+BRL\s*([0-9][0-9.,]*)\s+BRL\s*([0-9][0-9.,]*)\s+XT\s+BRL\s*([0-9][0-9.,]*)/i,
    /\b([A-Z]{3})\s*([0-9][0-9.,]*)\s+BRL\s*([0-9][0-9.,]*)\s+([0-9][0-9.,]*)\s*XT\s+BRL\s*([0-9][0-9.,]*)/i
  ];
  for(const re of patterns){
    const m = flat.match(re);
    if(m){ return { fareCur:m[1].toUpperCase(), fareAmt:parseAmountAny(m[2]), equivBRL:parseAmountAny(m[3]), taxesBRL:parseAmountAny(m[4]), totalBRL:parseAmountAny(m[5]), bag, bagSegs, fareFamily: fareFamilies[0] || null, fareFamilies, totalSource: "READ_LINE", taxesSource: "READ", taxLinesBRL: null }; }
  }
  const currencyMatch = flat.match(/\b([A-Z]{3})\s*[0-9][0-9.,]*\s+BRL\s*[0-9]/);
  return {fareCur:currencyMatch ? currencyMatch[1] : null, fareAmt:null, equivBRL:null, taxesBRL:null, totalBRL:null, bag, bagSegs, fareFamily: fareFamilies[0] || null, fareFamilies, totalSource: null, taxesSource: null, taxLinesBRL: null};
}
