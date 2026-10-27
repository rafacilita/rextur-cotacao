// [30-core-parser-itinerario] NUCLEO: deteccao de GDS e parser de itinerario/passageiros/cabine (puro, sem DOM)
// Sem DOM/window/localStorage: roda em qualquer motor JS (ver tests/core-sem-dom.test.cjs).

// ─── PARSING DE PAX ───────────────────────────────────────────────────────────
// Extrai passageiros ADT / CHD / INF do texto bruto do itinerário.
//
// Padrões suportados:
//   Amadeus com INF inline:  "1. SILVA/RICARDO(INF/PEDRO)"
//   Amadeus com INF externo: "1. SILVA/JOAO MR"
//   Sabre com marcador I/:   "1.I/1SILVA/PEDRO INF"
//
// Regras INF (Amadeus):
//   (INF/NOME)            → surname do ADT + NOME
//   (INF/SOBRENOME/NOME)  → SOBRENOME + NOME
//   (INF/NOME/DATA)       → surname do ADT + NOME  (data descartada)
//   (INF/SOBRENOME/NOME/DATA) → SOBRENOME + NOME   (data descartada)
//   O nome do ADT é sempre limpo — nada do bloco (INF/...) fica no ADT.

function parsePaxFromItin(raw) {
  const lines = trimLines(raw);
  const out   = [];
  const seen  = new Set();

  function push(type, name) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const key = type + '|' + clean.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type, name: clean });
  }

  // Remove prefixo numérico do sobrenome, marcadores (ADT/CHD/INF) e colapsa espaços
  function normalizeName(n) {
    let s = String(n || '').trim().replace(/\s+/g, ' ');
    s = s.replace(/\s*\((ADT|CHD|INF)\)\s*/ig, ' ').trim();
    const parts = s.split('/');
    if (parts.length >= 2) {
      parts[0] = parts[0].replace(/^\d+/, '').trim();
      s = parts[0] + '/' + parts.slice(1).join('/').trim();
    }
    return s.trim();
  }

  // Classifica tipo pelo marcador Sabre (I/), por marcador solto entre
  // parenteses ("(CHD)", sem bloco INF) ou pelo titulo do nome.
  function classify(infMarker, title, bareType) {
    if (infMarker) return 'INF';
    if (bareType) return String(bareType).toUpperCase();
    const t = (title || '').toUpperCase();
    if (t === 'MR' || t === 'MRS')    return 'ADT';
    if (t === 'MISS' || t === 'MSTR') return 'CHD';
    return 'ADT';
  }

  // ── extractInfBlock ────────────────────────────────────────────────────────
  // Interpreta o conteúdo de um bloco (INF...) de forma determinística.
  //
  // Dois formatos Amadeus (ambos válidos):
  //
  //   Formato A — com barra após INF (padrão moderno):
  //     INF/NOME             → surname do ADT   + NOME
  //     INF/SOBRENOME/NOME   → SOBRENOME        + NOME
  //     INF/NOME/DATA        → surname do ADT   + NOME  (data ignorada)
  //     INF/SOBRENOME/NOME/DATA → SOBRENOME     + NOME  (data ignorada)
  //
  //   Formato B — sobrenome concatenado (manual p.7: INFCOUTO/LIAMISS):
  //     INFSURNAME/NOME      → SURNAME          + NOME
  //     INFSURNAME/NOME/DATA → SURNAME          + NOME  (data ignorada)
  //
  // Retorna { surname, given } ou null se inválido.

  const IS_DATE = /^\d{2}[A-Z]{3}\d{2}$/i;

  function extractInfBlock(blockContent, adtSurname) {
    const raw = (blockContent || '').trim();
    if (!/^INF/i.test(raw)) return null;

    // ── Formato B: INFSURNAME/... (sobrenome concatenado ao INF, sem barra) ──
    // Detecta quando há letras imediatamente após INF antes da primeira barra.
    // Ex: "INFLINS/MARIA MISS" → surname=LINS, given=MARIA MISS
    //     "INFCOUTO/LIAMISS/21APR06" → surname=COUTO, given=LIAMISS
    const concatMatch = raw.match(/^INF([A-ZÀ-Ü][A-ZÀ-Ü0-9]*)\//i);
    if (concatMatch) {
      const surname = concatMatch[1].trim();
      // Tudo após INF+SURNAME+/ — filtra datas nos tokens restantes
      const rest  = raw.slice(concatMatch[0].length);
      const parts = rest.split('/').map(t => t.trim()).filter(t => t && !IS_DATE.test(t));
      if (parts.length === 0) return null;
      return { surname, given: parts[0] };
    }

    // ── Formato A: INF/... (padrão com barra) ─────────────────────────────────
    const tokens = raw.split('/').map(t => t.trim()).filter(Boolean);
    // tokens[0] === 'INF' — descarta; filtra datas nos restantes
    const parts = tokens.slice(1).filter(t => !IS_DATE.test(t));

    if (parts.length === 0) return null;
    if (parts.length === 1) return { surname: adtSurname, given: parts[0] };
    return { surname: parts[0], given: parts[1] };
  }

  // ── CASO 2 (compartilhado) ──────────────────────────────────────────────────
  // Captura padrões: "1. NOME/DADO TITULO", "1.I/1NOME/DADO" (INF Sabre) e
  // "2.NOME/DADO(CHD)" (marcador solto entre parenteses, sem bloco INF nem
  // titulo MISS/MSTR). Usado tanto para linhas sem bloco INF quanto para o
  // restante de uma linha apos o primeiro bloco (INF...) ja processado no
  // CASO 1 — uma linha pode trazer o ADT+INF e, na sequencia, outro
  // passageiro (ex.: um CHD) que o CASO 1 sozinho nao cobria.
  function scanSimplePassengers(text) {
    const re = /\b(\d+)\.\s*(I\/\d+)?\s*\d*\s*([A-ZÀ-Ü0-9 ]+\/[A-ZÀ-Ü0-9-]+)\s*(?:\((ADT|CHD|INF)\))?\s*(MISS|MSTR|MRS|MR)?/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const infMarker = m[2] || null;
      const bareType  = m[4] || null;
      const title     = m[5] || '';
      const name      = normalizeName(m[3] + (title ? ' ' + title : ''));
      const type      = classify(infMarker, title, bareType);
      push(type, name);
    }
  }

  // ── Loop principal ─────────────────────────────────────────────────────────

  for (const line of lines) {
    const L = line.trim();

    // ── CASO 1: linha com bloco (INF...) — padrão Amadeus ───────────────────
    // Detecta (INF/...) e (INFSURNAME/...) — ambos os formatos do manual.
    // Condição: linha contém '(INF' (com parêntese, evita falso positivo de IATA).
    if (/\(INF/i.test(L)) {

      // Tudo antes do primeiro '(' é o candidato ao nome do ADT
      const beforeParen = L.split('(')[0].trim();

      // Posicao do PRIMEIRO bloco (INF...): usada depois para isolar o
      // restante da linha, que pode trazer outros passageiros.
      const reBlock = /\(([^)]*)\)/g;
      let firstInfBlockEnd = -1;
      let bm;
      while ((bm = reBlock.exec(L)) !== null) {
        if (/^INF/i.test(bm[1].trim())) { firstInfBlockEnd = reBlock.lastIndex; break; }
      }

      // Identifica o nome do ADT na parte anterior ao parêntese
      // Títulos em ordem longa-primeiro para evitar MR engolir MRS
      const adtMatch = beforeParen.match(
        /\b\d+\.\s*\d*\s*([A-ZÀ-Ü0-9 ]+\/[A-ZÀ-Ü0-9-]+)\s*(MISS|MSTR|MRS|MR)?\s*$/i
      );

      if (adtMatch && firstInfBlockEnd >= 0) {
        // ADT: nome limpo, sem qualquer rastro do bloco INF
        const adtName  = normalizeName(adtMatch[1] + (adtMatch[2] ? ' ' + adtMatch[2] : ''));
        const adtTitle = (adtMatch[2] || '').toUpperCase();
        const adtType  = (adtTitle === 'MISS' || adtTitle === 'MSTR') ? 'CHD' : 'ADT';
        push(adtType, adtName);

        // Sobrenome limpo para herdar ao INF quando não informado no bloco
        const adtSurname = adtName.split('/')[0]
          .replace(/\s+(MISS|MSTR|MRS|MR)$/i, '').trim();

        const infBlockMatch = L.slice(0, firstInfBlockEnd).match(/\(([^)]*)\)\s*$/);
        const inf = infBlockMatch ? extractInfBlock(infBlockMatch[1], adtSurname) : null;
        if (inf && inf.surname && inf.given) {
          push('INF', normalizeName(`${inf.surname}/${inf.given}`));
        }

        // Resto da linha, depois do bloco INF ja processado: pode trazer
        // outro passageiro (ex.: "2.SILVA/MARIA(CHD)"), que o CASO 1 por si
        // so nao cobre porque so olha o texto ANTES do primeiro parêntese.
        scanSimplePassengers(L.slice(firstInfBlockEnd));

        continue; // linha totalmente processada
      }
    }

    scanSimplePassengers(L);
  }

  return out;
}

// ─── GDS DETECT (inalterado) ──────────────────────────────────────────────────

function detectGDSFromItin(itinRaw){
  const lines = trimLines(itinRaw);
  for(const l of lines){
    if(/^\d+\s+[A-Z0-9]{2}\d{2,4}\s+[A-Z]\s+\d{2}[A-Z]{3}\b/.test(l)) return "AMA";
    if(/^\d+\s+[A-Z0-9]{2}\s+\d{1,4}\s+[A-Z]\s+\d{2}[A-Z]{3}\b/.test(l)) return "AMA";
  }
  for(const l of lines){
    if(/^\d+\s+[A-Z0-9]{2}\d{1,4}[A-Z]?\s+\d{2}[A-Z]{3}\b/.test(l)) return "SAB";
    if(/^\d+\s+[A-Z0-9]{2}\s+\d{1,4}[A-Z]?\s+\d{2}[A-Z]{3}\b/.test(l)) return "SAB";
  }
  const f = flatten(itinRaw).toUpperCase();
  if(/\bDK\d\b/.test(f) || /\bFXP\b/.test(f)) return "AMA";
  if(/\bSS\d\b/.test(f) || /\bHK\d\b/.test(f) || /\bWP\b/.test(f)) return "SAB";
  return "—";
}

// ─── PARSERS DE ITINERÁRIO ────────────────────────────────────────────────────
// Melhorias baseadas no Manual Amadeus PNR (Junho 2007):
//   p.11-12  — campos do segmento (status, horários, equipamento)
//   p.23-24  — tabela de códigos de ação, estado e aviso
//   p.9      — segmento ARNK (chegada desconhecida / trecho terrestre)
//   p.12     — "1525+1 Horário estimado de chegada no dia seguinte"

function parseItinerary(itinRaw, gds, year){
  const lines = trimLines(itinRaw);
  const segs  = [];

  function normalizeSegmentYears(items){
    let currentYear = year;
    let previousMonth = null;
    const parseFmt = (value) => {
      const m = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      return m ? { day:+m[1], month:+m[2], year:+m[3] } : null;
    };
    const format = ({day,month,year: y}) =>
      `${String(day).padStart(2,"0")}/${String(month).padStart(2,"0")}/${y}`;

    for(const segment of items){
      if(segment.surface) continue;
      const dep = parseFmt(segment.depDateFmt);
      const arr = parseFmt(segment.arrDateFmt);
      if(!dep) continue;

      if(previousMonth != null && previousMonth >= 10 && dep.month <= 3){
        currentYear++;
      }
      dep.year = currentYear;
      segment.depDateFmt = format(dep);

      if(arr){
        arr.year = currentYear + (dep.month === 12 && arr.month === 1 ? 1 : 0);
        segment.arrDateFmt = format(arr);
      }
      previousMonth = dep.month;
    }
    return items;
  }

  // ── STATUS_CLASS ────────────────────────────────────────────────────────────
  // Classifica o código de estado IATA em categoria semântica.
  // Fonte: Manual Amadeus p.23-24 (tabela de códigos)
  function statusClass(code) {
    const c = (code || '').toUpperCase();
    if (c === 'FLWN') return 'flown';
    if (['HX','XK'].includes(c))                                    return 'cancelled';
    if (['HL','UU','KL','GL','PL','LL','PC','PD','PE'].includes(c)) return 'waitlisted';
    if (['HN','PN','TK','TL','TN'].includes(c))                     return 'pending';
    if (['UN','NO','UC','US'].includes(c))                           return 'problem';
    if (['HK','LK','NK','KK','RR','DK','PK','GK','SS'].includes(c)) return 'confirmed';
    return 'unknown';
  }

  // ── parseTimeToken ──────────────────────────────────────────────────────────
  // Manual p.12: "1525+1 Horário estimado de chegada (no dia seguinte, +1)"
  // Retorna { time, dayOffset } — dayOffset é 0 na maioria dos casos.
  function parseTimeToken(tok) {
    const m = String(tok || '').match(/^(\d{3,4})(?:\+(\d))?/);
    if (!m) return { time: tok || '', dayOffset: 0 };
    return { time: m[1], dayOffset: m[2] ? parseInt(m[2]) : 0 };
  }

  // ── parseAmadeusLine ────────────────────────────────────────────────────────
  function parseAmadeusLine(l) {
    const t = l.split(/\s+/).filter(Boolean);
    if (t.length < 8) return null;
    if (!/^\d+$/.test(t[0])) return null;

    let idx = 1, airline = '', flight = '';
    if (/^[A-Z0-9]{2}\d{1,4}$/.test(t[idx])) {
      airline = t[idx].slice(0, 2); flight = t[idx].slice(2); idx++;
    } else if (/^[A-Z0-9]{2}$/.test(t[idx]) && /^\d{1,4}$/.test(t[idx+1]||'')) {
      airline = t[idx]; flight = t[idx+1]; idx += 2;
    } else return null;

    const rbd     = t[idx]||''; idx++;
    const depDate = t[idx]||''; idx++;

    // City pair: DOW embutido ou separado
    let tok = t[idx]||'', cityPair = '';
    if (/^\d\*?[A-Z]{6}$/i.test(tok)) { cityPair = tok.replace(/^\d\*?/,'').toUpperCase(); idx++; }
    else { idx++; cityPair = (t[idx]||'').toUpperCase(); idx++; }
    if (cityPair.length !== 6) return null;
    const org = cityPair.slice(0,3), dst = cityPair.slice(3,6);

    // ── Status code: HK1, DK2, HL1, FLWN, etc. ─────────────────────────────
    // Manual p.23-24: códigos de ação e estado
    const statusRaw = t[idx]||''; idx++;
    const isFlown   = /^FLWN$/i.test(statusRaw);
    const sm        = statusRaw.match(/^([A-Z]{2,4})(\d*)$/i);
    const scode     = isFlown ? 'FLWN' : (sm ? sm[1].toUpperCase() : '');
    const paxCount  = (sm && sm[2]) ? parseInt(sm[2]) : null;
    const sclass    = isFlown ? 'flown' : statusClass(scode);

    // Departure time
    const depTime = t[idx]||''; idx++;

    // ── Arrival time com possível offset de dia ──────────────────────────────
    const { time: arrTimeClean, dayOffset: arrDayOffset } = parseTimeToken(t[idx]||'');
    idx++;

    // Arrival date (se explicitamente exibida)
    const arrDate = (t[idx] && /^\d{2}[A-Z]{3}/i.test(t[idx])) ? t[idx] : depDate;

    // ── Equipamento da aeronave ─────────────────────────────────────────────
    // Manual p.12: "744 Equipamento do vôo".
    // O codigo tem tres caracteres e NAO e so numerico: 32N, 77W, CR9 e E90 sao
    // todos validos. A versao anterior exigia digitos puros e por isso perdia
      // 12 dos 29 codigos da tabela, incluindo toda a familia neo e os Embraer.
    let equipment = null;
    for (let k = idx; k < Math.min(idx+6, t.length); k++) {
      if (pareceEquipamento(t[k])) { equipment = String(t[k]).toUpperCase(); break; }
    }

    return {
      org, dst, airline, flight, rbd,
      depDateFmt:  fmtDate(depDate, year),
      arrDateFmt:  fmtDate(arrDate, year),
      depTimeFmt:  fmtTime(depTime),
      arrTimeFmt:  fmtTime(arrTimeClean),
      arrDayOffset,
      statusCode: scode, statusClass: sclass, paxCount, equipment,
      opCarrier: null, opFlight: null, opName: null
    };
  }

  // ── parseSabreLine ──────────────────────────────────────────────────────────
  function parseSabreLine(l) {
    const t = l.split(/\s+/).filter(Boolean);
    if (t.length < 6) return null;
    if (!/^\d+$/.test(t[0])) return null;

    let airline='', flightClass='', date='', cityTok='', dep='', arr='', arrDate='', statusTok='';
    let idxAfterCity = 0;

    if (/^[A-Z0-9]{2}$/.test(t[1])) {
      airline=t[1]; flightClass=t[2]||''; date=t[3]||'';
      const cityIndex = [4,5].find(i => /^[A-Z]{6}(?:\*?[A-Z]{2}\d+)?$/i.test(t[i]||""));
      if(cityIndex == null) return null;
      cityTok=t[cityIndex]; idxAfterCity=cityIndex+1;
    } else if (/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(t[1])) {
      airline=t[1].slice(0,2); flightClass=t[1].slice(2); date=t[2]||'';
      const cityIndex = [3,4].find(i => /^[A-Z]{6}(?:\*?[A-Z]{2}\d+)?$/i.test(t[i]||""));
      if(cityIndex == null) return null;
      cityTok=t[cityIndex]; idxAfterCity=cityIndex+1;
    } else return null;

    const mfc    = String(flightClass).match(/^(\d{1,4})([A-Z])?$/);
    const flight = mfc ? mfc[1] : flightClass;
    const rbd    = mfc && mfc[2] ? mfc[2] : '';

    let cityPair = '';
    const mEmbed = cityTok.match(/^([A-Z]{6})\*?([A-Z]{2}\d+)$/i);
    if (mEmbed) {
      cityPair=mEmbed[1].toUpperCase(); dep=t[idxAfterCity]||''; arr=t[idxAfterCity+1]||'';
      const mAD=t[idxAfterCity+2]||'';
      arrDate = /^\d{2}[A-Z]{3}/i.test(mAD) ? mAD : date;
    } else if (/^[A-Z]{6}$/i.test(cityTok)) {
      cityPair=cityTok.toUpperCase();
      const maybeStatus=t[idxAfterCity]||'';
      const isStatus=/^[A-Z]{2}\d+$/.test(maybeStatus);
      if (isStatus) {
        statusTok=maybeStatus;
        dep=t[idxAfterCity+1]||''; arr=t[idxAfterCity+2]||'';
        const mAD=t[idxAfterCity+3]||'';
        arrDate = /^\d{2}[A-Z]{3}/i.test(mAD) ? mAD : date;
      } else {
        dep=maybeStatus; arr=t[idxAfterCity+1]||'';
        const mAD=t[idxAfterCity+2]||'';
        arrDate = /^\d{2}[A-Z]{3}/i.test(mAD) ? mAD : date;
      }
    } else {
      const mcity=cityTok.match(/([A-Z]{6})/i);
      if (mcity) cityPair=mcity[1].toUpperCase(); else return null;
      dep=t[idxAfterCity]||''; arr=t[idxAfterCity+1]||''; arrDate=date;
    }

    if (cityPair.length !== 6) return null;
    const org=cityPair.slice(0,3), dst=cityPair.slice(3,6);

    // Status embutido no city tok (ex: GRUJFKHK1) ou token separado
    const smatch     = String(cityTok + " " + statusTok).match(/([A-Z]{2})(\d+)\s*$/i);
    const scode      = smatch ? smatch[1].toUpperCase() : '';
    const sclass     = statusClass(scode);
    const { time: arrTimeClean, dayOffset: arrDayOffset } = parseTimeToken(arr);

    return {
      org, dst, airline, flight, rbd,
      depDateFmt:  fmtDate(date, year),
      arrDateFmt:  fmtDate(arrDate, year),
      depTimeFmt:  fmtTime(dep),
      arrTimeFmt:  fmtTime(arrTimeClean),
      arrDayOffset,
      statusCode: scode, statusClass: sclass, paxCount: null, equipment: null,
      opCarrier: null, opFlight: null, opName: null
    };
  }

  function parseSabreVisualPair(line, detailLine){
    const main = String(line || "").match(
      /^\s*\d+\s+([A-Z0-9]{2})\s+(\d{1,4})\s+([A-Z]{3})\s*-\s*.+?-->\s*([A-Z]{3})\s*-\s*.+?\s+([A-Z])\s+([A-Z]{2})(\d+)\s*$/i
    );
    if(!main) return null;
    const detail = String(detailLine || "").match(
      /\b(\d{2}[A-Z]{3}),?\s*(\d{1,2}:\d{2})\s+(\d{2}[A-Z]{3}),?\s*(\d{1,2}:\d{2})\b/i
    );
    if(!detail) return null;

    const depDate = detail[1].toUpperCase();
    const arrDate = detail[3].toUpperCase();
    const scode = main[6].toUpperCase();
    return {
      org: main[3].toUpperCase(),
      dst: main[4].toUpperCase(),
      airline: main[1].toUpperCase(),
      flight: main[2],
      rbd: main[5].toUpperCase(),
      depDateFmt: fmtDate(depDate, year),
      arrDateFmt: fmtDate(arrDate, year),
      depTimeFmt: detail[2].padStart(5, "0"),
      arrTimeFmt: detail[4].padStart(5, "0"),
      arrDayOffset: 0,
      statusCode: scode,
      statusClass: statusClass(scode),
      paxCount: parseInt(main[7], 10) || null,
      equipment: null,
      opCarrier: null,
      opFlight: null,
      opName: null
    };
  }

  if (gds === 'AMA') {
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];

      // ── ARNK: segmento de superfície (trecho terrestre) ──────────────────
      // Manual p.9: "SI ARNK — chegada desconhecida (surface segment)"
      if (/\bARNK\b/i.test(L) && /^\s*\d+/.test(L)) {
        segs.push({
          surface: true, org: null, dst: null,
          airline: '', flight: '', rbd: '',
          depDateFmt: '', arrDateFmt: '',
          depTimeFmt: '', arrTimeFmt: '',
          arrDayOffset: 0,
          statusCode: 'ARNK', statusClass: 'surface',
          paxCount: null, equipment: null,
          opCarrier: null, opFlight: null, opName: null
        });
        continue;
      }

      const seg = parseAmadeusLine(L);
      if (!seg) continue;

      for (let j = i+1; j < lines.length; j++) {
        const nxt = lines[j];
        if (parseAmadeusLine(nxt)) break;
        const cs = nxt.match(/\bOPERATED BY\s+(.+?)\s+AS\s+([A-Z0-9]{2})\s+FLT\s+(\d{1,4})/i);
        if (cs) { seg.opName=cs[1].trim(); seg.opCarrier=cs[2].toUpperCase(); seg.opFlight=cs[3]; continue; }
        const cs050 = nxt.match(/^\s*050\s+([A-Z0-9]{2})\s+(\d{1,4})\b/i);
        if (cs050) { seg.opCarrier=seg.opCarrier||cs050[1].toUpperCase(); seg.opFlight=seg.opFlight||cs050[2]; continue; }
        const op127 = nxt.match(/^\s*127\s+(.+?)\s+FOR\b/i);
        if (op127) { const opn=op127[1].trim(); if(opn&&!/SUBSIDIARY\/FRANCHISE/i.test(opn)) seg.opName=seg.opName||opn; continue; }
        const op1 = nxt.match(/^\s*OPERATED BY\s+(.+)$/i);
        if (op1) { const v=op1[1].trim(); if(!/SUBSIDIARY\/FRANCHISE/i.test(v)&&!/SEE RTSVC/i.test(v)) seg.opName=seg.opName||v; continue; }
        if (!seg.opName) {
          if (/LATAM AIRLINES GROUP/i.test(nxt)) seg.opName='LATAM AIRLINES GROUP';
          if (/LATAM AIRLINES BRASIL/i.test(nxt)) seg.opName='LATAM AIRLINES BRASIL';
          if (/\bIBERIA\b/i.test(nxt)) seg.opName='IBERIA';
        }
      }
      segs.push(seg);
    }
    return normalizeSegmentYears(segs);
  }

  if (gds === 'SAB') {
    for (let i = 0; i < lines.length; i++) {
      let seg = parseSabreVisualPair(lines[i], lines[i + 1]);
      if(seg) i++;
      else seg = parseSabreLine(lines[i]);
      if (!seg) continue;
      for (let j = i+1; j < lines.length; j++) {
        const nxt = lines[j];
        if (parseSabreLine(nxt)) break;
        const op1 = nxt.match(/^OPERATED BY\s*\/?\s*(.+)$/i);
        if (op1) seg.opName = op1[1].trim();
        const op2 = nxt.match(/\bAS\s+([A-Z0-9]{2})\s+FLT\s+(\d{1,4})/i);
        if (op2) { seg.opCarrier=op2[1].toUpperCase(); seg.opFlight=op2[2]; }
      }
      segs.push(seg);
    }
    return normalizeSegmentYears(segs);
  }

  return segs;
}

// Decide se um token e codigo de equipamento.
// Padroes com digito sao inequivocos nessa posicao da linha. Codigo so com
// letras e aceito apenas se conhecido, senao confundiria com codigo de
// refeicao, de servico e outros tokens de tres letras.
function pareceEquipamento(token){
  const t = String(token || "").toUpperCase();
  if(!/^[0-9A-Z]{3}$/.test(t)) return false;
  if(/^\d{3}$/.test(t)) return true;                 // 319, 737, 359
  if(/^\d{2}[A-Z]$/.test(t)) return true;            // 32N, 73M, 77W, 32B
  if(/^[A-Z]\d{2}$/.test(t)) return true;            // E90, E95, E29
  if(/^[A-Z]{2}\d$/.test(t)) return !ESTADOS_DE_SEGMENTO.has(t.slice(0, 2)); // CR9 sim, HK1 nao
  if(/^\d[A-Z]\d$/.test(t)) return true;             // 7M8, 7M9 (variante do 737 MAX)
  return Object.prototype.hasOwnProperty.call(EQUIPAMENTO, t);
}

// Nome legivel do equipamento, ou null quando o codigo nao esta na tabela.
function equipmentName(code){
  const t = String(code || "").toUpperCase().trim();
  return EQUIPAMENTO[t] || null;
}
function cabinePorRBD(rbd){
  const t = String(rbd || "").toUpperCase().trim();
  return CABINE_POR_RBD[t] || null;
}

// Olha so os trechos aereos (ignora ARNK/superficie e RBD vazio ou fora da
// tabela). Se todos os trechos com RBD confiavel concordam, devolve a
// cabine. Se ha RBDs confiaveis discordando entre si (ida e volta em cabines
// diferentes), devolve mista:true e cabine:null -- o campo so aceita um
// valor, nao da pra escolher por ele.
function inferirCabineItinerario(segments){
  const cabines = new Set();
  (segments || []).forEach(s => {
    if (!s || s.surface) return;
    const c = cabinePorRBD(s.rbd);
    if (c) cabines.add(c);
  });
  if (cabines.size === 0) return { cabine: null, mista: false };
  if (cabines.size > 1) return { cabine: null, mista: true };
  return { cabine: Array.from(cabines)[0], mista: false };
}

// Mesma logica de inferirCabineItinerario, mas usando a cabine CONFIRMADA no
// popup (s.cabinConfirmed) quando houver, em vez de so a RBD crua -- usado no
// e-mail para decidir se mostra a coluna "Classe" por trecho (so quando os
// trechos realmente divergem) e se mostra o campo unico "Cabine" em
// CONDICOES (so quando NAO divergem, senao um unico valor seria enganoso).
function effectiveCabinMista(segments){
  const cabines = new Set();
  (segments || []).forEach(s => {
    if (!s || s.surface) return;
    const c = s.cabinConfirmed || cabinePorRBD(s.rbd);
    if (c) cabines.add(c);
  });
  return cabines.size > 1;
}
