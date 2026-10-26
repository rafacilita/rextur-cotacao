// [50-core-modelo] NUCLEO: QuoteModel e pipeline de regras (moeda, totais, validacoes, confianca) (puro, sem DOM)
// Sem DOM/window/localStorage: roda em qualquer motor JS (ver tests/core-sem-dom.test.cjs).

// Converte os warnings do motor de regras em itens do painel.
// São strings simples, sem campo associado, por isso id fica null.
function engineIssuesFromQuote(quote){
  const list = (quote && quote.meta && Array.isArray(quote.meta.warnings)) ? quote.meta.warnings : [];
  return list.map(warning => ({ id: null, message: String(warning), level: "warning", source: "engine" }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUOTEMODEL — FASE 1
// Camada intermediária entre parser e renderer.
// Não altera parsing nem renderização — só organiza os dados.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Recebe os dados já parseados e monta o modelo de dados central.
 * Output: objeto imutável que representa uma cotação completa.
 *
 * Campos:
 *   meta        — GDS detectado, ano, warnings, timestamp
 *   passengers  — contagens (counts) + nomes (names) por tipo
 *   itinerary   — array de segmentos (mesmo formato do parser)
 *   pricing     — ADT / CHD / INF (mesmo formato dos parsers, sem alteração)
 *   commercial  — campos de configuração da UI
 *   iataRate    — câmbio do RC com origem (BCB, GDS ou MANUAL)
 *   totals      — totais calculados do grupo
 */
function createQuoteModel({ gds, year, segs, prices, pax, paxNames, commercial, iataRate }) {

  // 1. Passageiros: contagens + nomes separados
  const passengers = {
    counts: { adt: pax.adt, chd: pax.chd, inf: pax.inf },
    names: {
      ADT: (paxNames && paxNames.ADT) ? paxNames.ADT : [],
      CHD: (paxNames && paxNames.CHD) ? paxNames.CHD : [],
      INF: (paxNames && paxNames.INF) ? paxNames.INF : []
    }
  };

  // 2. Pricing — cópia direta dos parsers (estrutura preservada)
  const pricing = {
    ADT: prices.ADT || null,
    CHD: prices.CHD || null,
    INF: prices.INF || null
  };

  // 3. fareDisplay e o UNICO campo de totals produzido aqui: applyTotalsByPax
  //    sobrescreve q.totals inteiro e preserva somente ele.
  // fareDisplay para KPI — usa ADT como referência
  let fareDisplay = '—';
  const adtPr = pricing.ADT;
  if (adtPr && adtPr.fareAmt != null) {
    fareDisplay = moneyCurrency(adtPr.fareAmt, adtPr.fareCur) + ' (ADT)';
  }

  const totals = { fareDisplay };

  // Os warnings sao produzidos pelo motor de regras (applyCurrency / applyValidations).
  // Gerar aqui seria inutil: cloneQuote zera meta.warnings antes do pipeline rodar.
  return {
    meta: {
      gds,
      year,
      parsedAt: new Date().toISOString(),
      warnings: []
    },
    passengers,
    itinerary: segs,
    pricing,
    commercial,
    iataRate,
    totals
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RULES ENGINE — FASE 3 (pipeline declarativo)
//
// Arquitetura:
//   cloneQuote        → deep clone + inicialização de meta._engine
//   applyCurrency     → RC USD→BRL (escreve em meta._engine.rcBRL)
//   applyTotalsByPax  → totais por tipo e grupo (lê meta._engine.rcBRL)
//   applyEnrichments  → enriquecimentos opcionais (stub, pronto para crescer)
//   applyValidations  → warnings de negócio
//   applyConfidence   → meta.confidence
//
// Contratos:
//   • Cada etapa é (q) → q, sem efeitos externos
//   • Dados internos do engine ficam EXCLUSIVAMENTE em q.meta._engine
//   • q.commercial e q.pricing são lidos, nunca escritos pelo engine
//   • Aliases de compat (equivBRL, taxesBRL, totalBRL, fareDisplay)
//     são mantidos em q.totals para buildEmail e KPIs
//   • A ORDEM de RULE_PIPELINE é obrigatória (ver dependências abaixo)
//
// Dependências de ordem:
//   applyCurrency     → deve rodar antes de applyTotalsByPax (produz _engine.rcBRL)
//   applyTotalsByPax  → deve rodar antes de applyConfidence  (preenche q.totals)
//   applyValidations  → deve rodar antes de applyConfidence  (conta warnings)
//   applyEnrichments  → roda após totais, antes de validações (pode ler totais)
// ═══════════════════════════════════════════════════════════════════════════════

// ── cloneQuote ────────────────────────────────────────────────────────────────
// Deep clone do QuoteModel original + inicialização defensiva de meta._engine.
// meta._engine é o namespace exclusivo para dados temporários do engine.
// Nunca aparece na saída de negócio (buildEmail não o lê).

function cloneQuote(q) {
  const clone = JSON.parse(JSON.stringify(q));

  // Garante que meta existe (fail-safe: etapas nunca quebram por campo ausente)
  clone.meta = clone.meta || {};
  clone.meta.warnings = [];

  // Namespace interno: dados entre etapas ficam aqui, nunca em commercial
  clone.meta._engine = {
    rcBRL: 0   // preenchido por applyCurrency, consumido por applyTotalsByPax
  };

  return clone;
}

// ── applyCurrency ─────────────────────────────────────────────────────────────
// Responsabilidade única: resolver RC USD → BRL.
// Resultado persiste em q.meta._engine.rcBRL (namespace interno do engine).
// Não toca em q.commercial nem q.pricing.

function applyCurrency(q) {
  // Fail-safe: garante namespace mesmo se chamada fora de ordem
  if (!q.meta._engine) q.meta._engine = { rcBRL: 0 };

  const rcUSDnum = parseAmountAny(q.commercial.rcUSD);
  const fxRate   = q.iataRate ? q.iataRate.rate : null;

  if (rcUSDnum != null && rcUSDnum > 0) {
    if (!fxRate || fxRate <= 0) {
      // Warning gerado aqui; rcBRL permanece 0 (totais não incluem RC)
      q.meta.warnings.push(
        `RC de USD ${rcUSDnum.toFixed(2)} por passageiro informado, mas câmbio não encontrado. O total do grupo pode estar incorreto.`
      );
    } else {
      q.meta._engine.rcBRL = +(rcUSDnum * fxRate).toFixed(2);
    }
  }

  return q;
}

// ── applyTotalsByPax ──────────────────────────────────────────────────────────
// Responsabilidade única: calcular totais por tipo de pax e totais de grupo.
// Lê q.meta._engine.rcBRL (produzido por applyCurrency).
// Preserva q.totals.fareDisplay gerado por createQuoteModel.

function applyTotalsByPax(q) {
  // Fail-safe: rcBRL = 0 se applyCurrency não rodou antes
  const rcBRL       = (q.meta._engine && q.meta._engine.rcBRL) || 0;
  const fareDisplay = (q.totals && q.totals.fareDisplay) ? q.totals.fareDisplay : '—';

  const byType = {};
  let groupFareTotal  = 0;
  let groupTaxesTotal = 0;
  let groupRCTotal    = 0;
  let groupGrandTotal = 0;

  const paxOrder = [
    { type: 'ADT', qty: q.passengers.counts.adt },
    { type: 'CHD', qty: q.passengers.counts.chd },
    { type: 'INF', qty: q.passengers.counts.inf }
  ];

  for (const { type, qty } of paxOrder) {
    if (qty <= 0) continue;

    const pr = q.pricing[type];

    if (!pr) {
      // Máscara não colada: preenche estrutura com nulls para applyValidations detectar
      byType[type] = {
        quantity: qty,
        farePerPax: null, fareCurrency: null,
        equivPerPax: null, taxesPerPax: null,
        rcPerPax: rcBRL, totalPerPax: null,
        fareTotal: null, taxesTotal: null,
        rcTotal: +(rcBRL * qty).toFixed(2),
        grandTotal: null,
        _needsReview: true
      };
      continue;
    }

    const fareTotal  = pr.equivBRL != null ? +(pr.equivBRL * qty).toFixed(2) : null;
    const taxesTotal = pr.taxesBRL != null ? +(pr.taxesBRL * qty).toFixed(2) : null;
    const rcTotal    = +(rcBRL * qty).toFixed(2);
    const grandTotal = pr.totalBRL != null ? +((pr.totalBRL + rcBRL) * qty).toFixed(2) : null;

    byType[type] = {
      quantity:     qty,
      farePerPax:   pr.fareAmt  ?? null,
      fareCurrency: pr.fareCur  ?? null,
      equivPerPax:  pr.equivBRL ?? null,
      taxesPerPax:  pr.taxesBRL ?? null,
      rcPerPax:     rcBRL,
      totalPerPax:  pr.totalBRL != null ? +(pr.totalBRL + rcBRL).toFixed(2) : null,
      fareTotal,
      taxesTotal,
      rcTotal,
      grandTotal,
      _needsReview: (pr.fareAmt == null || pr.totalBRL == null)
    };

    if (fareTotal  != null) groupFareTotal  += fareTotal;
    if (taxesTotal != null) groupTaxesTotal += taxesTotal;
    groupRCTotal    += rcTotal;
    if (grandTotal != null) groupGrandTotal += grandTotal;
  }

  q.totals = {
    byType,
    group: {
      fareTotal:  +groupFareTotal.toFixed(2),
      taxesTotal: +groupTaxesTotal.toFixed(2),
      rcTotal:    +groupRCTotal.toFixed(2),
      grandTotal: +groupGrandTotal.toFixed(2),
      currency:   'BRL'
    },
    // Aliases de compat — buildEmail e KPIs leem esses nomes diretamente
    equivBRL:    +groupFareTotal.toFixed(2),
    taxesBRL:    +groupTaxesTotal.toFixed(2),
    totalBRL:    +groupGrandTotal.toFixed(2),
    fareDisplay
  };

  return q;
}

// ── applyEnrichments ──────────────────────────────────────────────────────────
// Estágio para enriquecimentos opcionais que dependem de totais calculados.
// Posição no pipeline: após applyTotalsByPax, antes de applyValidations.
//
// Exemplos futuros (não implementados):
//   • applyRouteLabel(q)    — constrói rota legível para o e-mail
//   • applyFareSummary(q)   — agrega fare basis por tipo de pax
//   • applySeasonFlags(q)   — marca high season / low season
//
// Para adicionar: criar função (q) => q e incluir no RULE_PIPELINE abaixo.
// Dados temporários → sempre em q.meta._engine.

function applyEnrichments(q) {
  // Estágio vazio — pronto para receber funções sem alterar o pipeline
  return q;
}

// ── applyValidations ──────────────────────────────────────────────────────────
// Responsabilidade única: todas as validações de negócio.
// Lê q.pricing e q.passengers. Escreve apenas em q.meta.warnings[].
// Não depende de q.totals (pode rodar antes ou depois sem diferença).
//
// Para adicionar uma nova validação: criar função interna e chamar aqui.
// Cada validação deve ser independente das demais.

function applyValidations(q) {
  const paxOrder = [
    { type: 'ADT', qty: q.passengers.counts.adt },
    { type: 'CHD', qty: q.passengers.counts.chd },
    { type: 'INF', qty: q.passengers.counts.inf }
  ];

  for (const { type, qty } of paxOrder) {
    if (qty <= 0) continue;

    const pr = q.pricing[type];

    if (!pr) {
      q.meta.warnings.push(`${type}: máscara não informada ou não reconhecida, então os valores ficaram vazios.`);
      continue;
    }

    if (pr.fareAmt == null && pr.equivBRL == null) {
      q.meta.warnings.push(`${type}: tarifa não identificada. Confira a máscara colada.`);
    } else if (pr.fareAmt == null || pr.fareCur == null) {
      // Os valores em BRL foram lidos, mas a moeda da tarifa não. Sem este aviso
      // a cotação seguia para a agência com a coluna de tarifa em branco, sem
      // ninguém perceber. Vale para qualquer moeda e qualquer formato novo.
      q.meta.warnings.push(`${type}: moeda da tarifa não identificada na máscara. Os valores em BRL foram lidos, mas a tarifa na moeda original ficou em branco.`);
    }

    if (!pr.bag) {
      q.meta.warnings.push(`${type}: franquia de bagagem não detectada. Preencha à mão se precisar.`);
    }

    // Consistência: equiv + taxas deve bater com total (tolerância R$ 1,00)
    if (pr.bag === 'VAR') {
      q.meta.warnings.push(`${type}: a franquia muda durante o itinerário. Confira trecho por trecho.`);
    }

    if (Array.isArray(pr.bagSegs) && pr.bagSegs.some(b => normalizeBagAllowance(b) === 'Sem Bag')) {
      // bagSegs e indexado por trecho aereo: indexar q.itinerary direto reportaria o ARNK.
      const airItin = (Array.isArray(q.itinerary) ? q.itinerary : []).filter(seg => seg && !seg.surface);
      const noBagRoutes = [];
      pr.bagSegs.forEach((b, idx) => {
        if (normalizeBagAllowance(b) !== 'Sem Bag') return;
        const seg = airItin[idx] || null;
        noBagRoutes.push(seg && seg.org && seg.dst ? `${seg.org}-${seg.dst}` : `trecho ${idx + 1}`);
      });
      q.meta.warnings.push(`${type}: trecho sem bagagem em ${noBagRoutes.join(', ')}.`);
    }

    // Procedencia dos valores. LAST_BRL_LINE e DERIVED_DIFF_CORROBORATED ficam
    // DE PROPOSITO silenciosos: sao o caminho normal e conferido do Amadeus, e
    // avisar neles dispararia aviso em toda cotacao, treinando o operador a ignorar o painel.
    if (pr.totalSource === 'MAX_BRL') {
      q.meta.warnings.push(`${type}: o total não veio de uma linha TOTAL do GDS. Foi inferido pelo maior valor em BRL da máscara, então confirme o total.`);
    }
    if (pr.taxesSource === 'DERIVED_DIFF') {
      const det = (pr.taxLinesBRL != null) ? ` (linhas de taxa somam BRL ${pr.taxLinesBRL.toFixed(2)})` : '';
      q.meta.warnings.push(`${type}: taxas inferidas por diferença entre total e equivalente, e não conferem com as linhas de taxa${det}. Confira as taxas no GDS.`);
    }

    if (pr.equivBRL != null && pr.taxesBRL != null && pr.totalBRL != null) {
      const expected = +(pr.equivBRL + pr.taxesBRL).toFixed(2);
      const diff     = Math.abs(expected - pr.totalBRL);
      if (diff > 1.00) {
        q.meta.warnings.push(
          `${type}: o total da máscara (BRL ${pr.totalBRL.toFixed(2)}) não fecha com tarifa mais taxas (BRL ${expected.toFixed(2)}). Diferença de BRL ${diff.toFixed(2)}.`
        );
      }
    }
  }

  // Status do segmento: o aviso vai para o operador, nunca para o e-mail do cliente.
  // Precisa rodar aqui dentro para que o aviso conte em warnCount e derrube a confianca.
  const segments = Array.isArray(q.itinerary) ? q.itinerary : [];
  segments.forEach((seg, idx) => {
    if (!seg || seg.surface) return;
    const alert = SEGMENT_STATUS_ALERTS[seg.statusClass];
    if (!alert) return;
    const voo  = `${seg.airline || ''}${seg.flight || ''}`.trim() || `trecho ${idx + 1}`;
    const rota = (seg.org && seg.dst) ? `${seg.org}-${seg.dst}` : `trecho ${idx + 1}`;
    const code = seg.statusCode ? ` [${seg.statusCode}]` : '';
    q.meta.warnings.push(`Segmento ${voo} ${rota}${code} ${alert.label}. ${alert.hint}`);
  });

  // Cabine inferida pela RBD: nunca vai pro e-mail, so avisa o operador para confirmar.
  if (q.commercial && q.commercial.cabineSource === 'RBD') {
    q.meta.warnings.push(`Cabine (${q.commercial.cabine}) inferida automaticamente pela classe de reserva (RBD) do GDS. Confirme antes de enviar.`);
  }
  if (q.commercial && q.commercial.cabineMista) {
    q.meta.warnings.push('Itinerário com cabines diferentes por trecho (RBD distintos entre ida e volta). O campo Cabine aceita só um valor — confira e preencha manualmente.');
  }

  // INF sem ADT ou mais INF do que ADT
  const cntINF = q.passengers.counts.inf;
  const cntADT = q.passengers.counts.adt;
  if (cntINF > 0 && cntADT === 0) {
    q.meta.warnings.push('Bebê informado sem adulto. Cada bebê precisa estar vinculado a um adulto.');
  } else if (cntINF > cntADT) {
    q.meta.warnings.push(`${cntINF} bebês para ${cntADT} adultos. Cada bebê precisa estar vinculado a um adulto.`);
  }

  return q;
}

// ── applyConfidence ───────────────────────────────────────────────────────────
// Responsabilidade única: definir q.meta.confidence.
// DEVE rodar após applyValidations (conta warnings) e applyTotalsByPax (lê pricing).

function applyConfidence(q) {
  let filledFields = 0;
  let totalFields  = 0;

  const paxOrder = [
    { type: 'ADT', qty: q.passengers.counts.adt },
    { type: 'CHD', qty: q.passengers.counts.chd },
    { type: 'INF', qty: q.passengers.counts.inf }
  ];

  for (const { type, qty } of paxOrder) {
    if (qty <= 0) continue;
    totalFields += 3; // fareAmt + equivBRL + totalBRL

    const pr = q.pricing[type];
    if (!pr) continue;
    if (pr.fareAmt  != null) filledFields++;
    if (pr.equivBRL != null) filledFields++;
    if (pr.totalBRL != null) filledFields++;
  }

  const activePaxTypes = paxOrder.filter(p => p.qty > 0).length;
  const fillRatio      = (activePaxTypes > 0 && totalFields > 0) ? filledFields / totalFields : 0;
  const warnCount      = q.meta.warnings.length;

  if      (fillRatio >= 0.85 && warnCount === 0) q.meta.confidence = 'HIGH';
  else if (fillRatio >= 0.50 && warnCount <= 2)  q.meta.confidence = 'MEDIUM';
  else                                            q.meta.confidence = 'LOW';

  return q;
}

// ── applyRules (orquestrador) ─────────────────────────────────────────────────
// Executa RULE_PIPELINE sequencialmente sobre o clone do QuoteModel.
// Não conhece o que cada etapa faz — só garante a ordem e o isolamento.

function applyRules(quote) {
  let q = cloneQuote(quote); // clone + inicializa meta._engine

  for (const step of RULE_PIPELINE) {
    q = step(q);
  }

  // Log consolidado para depuração. Não altera a interface nem o modelo.
  console.groupCollapsed(
    `[cotacao] confianca=${q.meta.confidence} gds=${q.meta.gds || 'indefinido'} avisos=${q.meta.warnings.length}`
  );
  if (q.meta.warnings.length > 0) {
    console.warn('[cotacao] avisos:\n' + q.meta.warnings.map((w, i) => `  ${i+1}. ${w}`).join('\n'));
  }
  console.log('[cotacao] totais do grupo:', q.totals.group);
  console.log('[cotacao] totais por tipo:', q.totals.byType);
  console.log('[cotacao] interno do motor:', q.meta._engine);
  console.groupEnd();

  return q;
}
