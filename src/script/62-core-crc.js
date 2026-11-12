// [62-core-crc] Nucleo: CRC (Codigo de Registro da Cotacao) -- montar e ler, sem DOM e sem rede
//
// O CRC e o "CRR da Cotacao": o estado da tela vai compactado no rodape do e-mail da agencia,
// e qualquer colega cola o codigo de volta para reabrir a cotacao (conferencia, rentabilizacao).
// Tudo acontece no navegador: nada e enviado a servidor nenhum.
//
// O CRC CARREGA O MARKUP de proposito (decisao de 04/11/2026): o objetivo principal e saber se
// o colaborador anterior rentabilizou a emissao. O codigo e so compactado (reversivel), nao
// criptografado.
//
// Formato "CRC1-": base64url( 2 bytes de verificacao + deflate(JSON utf-8, com o dicionario CRC_DICT_V1) ).
// O CRC ainda nao tinha circulado quando o formato foi fechado, por isso o formato definitivo e o CRC1.
// Prefixo proprio (e nao CRR) para a Reemissao e a Cotacao nunca lerem o codigo uma da outra.

// ----- Deflate minimo (RFC 1951), sincrono, sem dependencia -----
// Por que existe: o LZString (LZW) comprime mal texto repetido, e o texto colado do GDS se repete
// (itinerario completo + mascaras, linhas de regras, cabecalhos). O deflate (o mesmo metodo do ZIP)
// deixa o codigo cerca de metade do tamanho, e o dicionario de vocabulario do GDS (61-core-crc-dicionario)
// tira mais ~25-30%. CompressionStream existe nos navegadores, mas e assincrono e nao existe em
// jsdom/vm -- aqui precisa ser sincrono.
// Compressor: LZ77 com cadeia de hash + Huffman (escolhe o menor entre bloco fixo e dinamico).
// Descompressor: completo (armazenado, fixo e dinamico). Validado contra o zlib em tests/crc.test.cjs.

const CRC_LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const CRC_LEN_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const CRC_DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const CRC_DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
const CRC_CL_ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

// Comprimentos de codigo de Huffman (limitados a maxBits) a partir das frequencias.
function crcHuffLengths(freq, maxBits){
  let f = freq.slice();
  for(;;){
    const n = f.length, len = new Array(n).fill(0);
    let nodes = [];
    for(let s = 0; s < n; s++) if(f[s] > 0) nodes.push({ w: f[s], m: [s] });
    if(nodes.length === 0) return len;
    if(nodes.length === 1){ len[nodes[0].m[0]] = 1; return len; }
    while(nodes.length > 1){
      nodes.sort((a, b) => a.w - b.w);
      const a = nodes.shift(), b = nodes.shift();
      a.m.forEach(s => len[s]++); b.m.forEach(s => len[s]++);
      nodes.push({ w: a.w + b.w, m: a.m.concat(b.m) });
    }
    if(Math.max.apply(null, len) <= maxBits) return len;
    f = f.map(x => x > 0 ? (x + 1) >> 1 : 0);   // achata e tenta de novo (nunca zera um simbolo usado)
  }
}

// Codigos canonicos (RFC 1951 3.2.2).
function crcCanonCodes(len){
  const cnt = new Array(16).fill(0);
  len.forEach(l => { if(l) cnt[l]++; });
  const next = new Array(16).fill(0);
  let code = 0;
  for(let b = 1; b <= 15; b++){ code = (code + cnt[b - 1]) << 1; next[b] = code; }
  return len.map(l => l ? next[l]++ : 0);
}

function crcSymFor(base, v){ let i = base.length - 1; while(base[i] > v) i--; return i; }

// bytes (array de 0..255) -> bytes deflate (raw, sem cabecalho zlib)
// dict (opcional): bytes que o descompressor tambem conhece; o LZ77 pode referenciar o dicionario como se
// fosse texto ja visto, o que encurta muito texto padronizado de GDS.
function crcDeflate(payload, dict){
  const pre = dict ? dict.length : 0;
  const data = pre ? dict.concat(payload) : payload;
  const n = data.length;
  if(payload.length === 0) return [3, 0];
  // 1) LZ77
  const head = new Int32Array(1 << 15).fill(-1), prev = new Int32Array(n);
  const hash = (p) => ((data[p] << 10) ^ (data[p + 1] << 5) ^ data[p + 2]) & 0x7fff;
  const insert = (p) => { if(p + 2 < n){ const h = hash(p); prev[p] = head[h]; head[h] = p; } };
  const L = [], D = [];   // literal: L=byte, D=0 | par: L=comprimento, D=distancia
  for(let k = 0; k < pre; k++) insert(k);
  let i = pre;
  while(i < n){
    let bestLen = 0, bestDist = 0;
    if(i + 2 < n){
      const maxLen = Math.min(258, n - i);
      let p = head[hash(i)], chain = 128;
      while(p >= 0 && i - p <= 32768 && chain-- > 0){
        if(data[p + bestLen] === data[i + bestLen]){
          let l = 0;
          while(l < maxLen && data[p + l] === data[i + l]) l++;
          if(l > bestLen){ bestLen = l; bestDist = i - p; if(l === maxLen) break; }
        }
        p = prev[p];
      }
    }
    if(bestLen >= 3){
      L.push(bestLen); D.push(bestDist);
      for(let k = 0; k < bestLen; k++) insert(i + k);
      i += bestLen;
    } else {
      L.push(data[i]); D.push(0);
      insert(i); i++;
    }
  }

  // 2) um bloco (fixo ou dinamico, o que sair menor)
  function emit(dynamic){
    const out = []; let bb = 0, bc = 0;
    const put = (v, nb) => { bb |= v << bc; bc += nb; while(bc >= 8){ out.push(bb & 255); bb >>>= 8; bc -= 8; } };
    const putCode = (code, l) => { let r = 0; for(let k = 0; k < l; k++) r = (r << 1) | ((code >> k) & 1); put(r, l); };

    let litLens, distLens;
    if(dynamic){
      const lf = new Array(286).fill(0), df = new Array(30).fill(0);
      for(let t = 0; t < L.length; t++){
        if(D[t] === 0) lf[L[t]]++;
        else { lf[257 + crcSymFor(CRC_LEN_BASE, L[t])]++; df[crcSymFor(CRC_DIST_BASE, D[t])]++; }
      }
      lf[256] = 1;
      litLens = crcHuffLengths(lf, 15);
      distLens = crcHuffLengths(df, 15);
    } else {
      litLens = []; for(let s = 0; s < 288; s++) litLens.push(s < 144 ? 8 : s < 256 ? 9 : s < 280 ? 7 : 8);
      distLens = new Array(30).fill(5);
    }
    const litCodes = crcCanonCodes(litLens), distCodes = crcCanonCodes(distLens);

    put(1, 1); put(dynamic ? 2 : 1, 2);
    if(dynamic){
      let hlit = 286; while(hlit > 257 && !litLens[hlit - 1]) hlit--;
      let hdist = 30; while(hdist > 1 && !distLens[hdist - 1]) hdist--;
      const lens = litLens.slice(0, hlit).concat(distLens.slice(0, hdist));
      const rle = [];   // [simbolo, bits extras, valor extra]
      for(let a = 0; a < lens.length;){
        const v = lens[a]; let run = 1;
        while(a + run < lens.length && lens[a + run] === v) run++;
        let r = run;
        if(v === 0){
          while(r >= 3){
            if(r >= 11){ const t = Math.min(r, 138); rle.push([18, 7, t - 11]); r -= t; }
            else { rle.push([17, 3, r - 3]); r = 0; }
          }
          while(r-- > 0) rle.push([0, 0, 0]);
        } else {
          rle.push([v, 0, 0]); r--;
          while(r >= 3){ const t = Math.min(r, 6); rle.push([16, 2, t - 3]); r -= t; }
          while(r-- > 0) rle.push([v, 0, 0]);
        }
        a += run;
      }
      const cf = new Array(19).fill(0);
      rle.forEach(e => cf[e[0]]++);
      const clLens = crcHuffLengths(cf, 7), clCodes = crcCanonCodes(clLens);
      let hclen = 19; while(hclen > 4 && !clLens[CRC_CL_ORDER[hclen - 1]]) hclen--;
      put(hlit - 257, 5); put(hdist - 1, 5); put(hclen - 4, 4);
      for(let k = 0; k < hclen; k++) put(clLens[CRC_CL_ORDER[k]], 3);
      rle.forEach(e => { putCode(clCodes[e[0]], clLens[e[0]]); if(e[1]) put(e[2], e[1]); });
    }
    for(let t = 0; t < L.length; t++){
      if(D[t] === 0){ putCode(litCodes[L[t]], litLens[L[t]]); continue; }
      const ls = crcSymFor(CRC_LEN_BASE, L[t]);
      putCode(litCodes[257 + ls], litLens[257 + ls]);
      if(CRC_LEN_EXTRA[ls]) put(L[t] - CRC_LEN_BASE[ls], CRC_LEN_EXTRA[ls]);
      const ds = crcSymFor(CRC_DIST_BASE, D[t]);
      putCode(distCodes[ds], distLens[ds]);
      if(CRC_DIST_EXTRA[ds]) put(D[t] - CRC_DIST_BASE[ds], CRC_DIST_EXTRA[ds]);
    }
    putCode(litCodes[256], litLens[256]);
    if(bc > 0) out.push(bb & 255);
    return out;
  }
  const fixo = emit(false), dinamico = emit(true);
  return dinamico.length < fixo.length ? dinamico : fixo;
}

// bytes deflate (raw) -> array de bytes. Lanca Error se o fluxo estiver cortado ou invalido.
function crcInflate(src, dict){
  let pos = 0, bb = 0, bc = 0;
  const pre = dict ? dict.length : 0;
  const out = pre ? dict.slice() : [];
  const bits = (nb) => {
    while(bc < nb){
      if(pos >= src.length) throw new Error("fim inesperado");
      bb |= src[pos++] << bc; bc += 8;
    }
    const v = bb & ((1 << nb) - 1); bb >>>= nb; bc -= nb;
    return v;
  };
  const mk = (len) => {
    const count = new Array(16).fill(0);
    len.forEach(l => count[l]++);
    count[0] = 0;
    const offs = [0, 0];
    for(let k = 1; k < 15; k++) offs[k + 1] = offs[k] + count[k];
    const sym = new Array(len.length);
    for(let s = 0; s < len.length; s++) if(len[s]) sym[offs[len[s]]++] = s;
    return { count, sym };
  };
  const dec = (h) => {
    let code = 0, first = 0, index = 0;
    for(let l = 1; l <= 15; l++){
      code |= bits(1);
      const c = h.count[l];
      if(code - c < first) return h.sym[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new Error("codigo invalido");
  };
  let fixedLit = null, fixedDist = null;
  let final;
  do {
    final = bits(1);
    const type = bits(2);
    if(type === 0){
      bb = 0; bc = 0;
      if(pos + 4 > src.length) throw new Error("fim inesperado");
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      if(pos + len > src.length) throw new Error("fim inesperado");
      for(let k = 0; k < len; k++) out.push(src[pos++]);
      continue;
    }
    if(type === 3) throw new Error("bloco invalido");
    let lit, dist;
    if(type === 1){
      if(!fixedLit){
        const ll = []; for(let s = 0; s < 288; s++) ll.push(s < 144 ? 8 : s < 256 ? 9 : s < 280 ? 7 : 8);
        fixedLit = mk(ll); fixedDist = mk(new Array(30).fill(5));
      }
      lit = fixedLit; dist = fixedDist;
    } else {
      const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
      const cl = new Array(19).fill(0);
      for(let k = 0; k < hclen; k++) cl[CRC_CL_ORDER[k]] = bits(3);
      const clh = mk(cl);
      const lens = [];
      while(lens.length < hlit + hdist){
        const s = dec(clh);
        if(s < 16) lens.push(s);
        else {
          let rep, val = 0;
          if(s === 16){ if(!lens.length) throw new Error("repeticao invalida"); val = lens[lens.length - 1]; rep = 3 + bits(2); }
          else if(s === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          while(rep-- > 0) lens.push(val);
        }
      }
      if(lens.length > hlit + hdist) throw new Error("tabela invalida");
      lit = mk(lens.slice(0, hlit)); dist = mk(lens.slice(hlit));
    }
    for(;;){
      const s = dec(lit);
      if(s < 256){ out.push(s); }
      else if(s === 256) break;
      else {
        const li = s - 257;
        if(li >= 29) throw new Error("comprimento invalido");
        const len = CRC_LEN_BASE[li] + bits(CRC_LEN_EXTRA[li]);
        const di = dec(dist);
        if(di >= 30) throw new Error("distancia invalida");
        const d = CRC_DIST_BASE[di] + bits(CRC_DIST_EXTRA[di]);
        if(d > out.length) throw new Error("distancia invalida");
        for(let k = 0; k < len; k++) out.push(out[out.length - d]);
      }
      if(out.length > 4000000) throw new Error("tamanho absurdo");
    }
  } while(!final);
  return pre ? out.slice(pre) : out;
}

// ----- texto <-> bytes (UTF-8 manual: TextEncoder nao existe em jsdom/vm) e base64 url-safe -----
function crcUtf8Bytes(s){
  const o = [];
  for(let i = 0; i < s.length; i++){
    let c = s.charCodeAt(i);
    if(c >= 0xd800 && c <= 0xdbff && i + 1 < s.length){
      const d = s.charCodeAt(i + 1);
      if(d >= 0xdc00 && d <= 0xdfff){ c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
    }
    if(c < 0x80) o.push(c);
    else if(c < 0x800) o.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if(c < 0x10000) o.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else o.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return o;
}
function crcUtf8Str(b){
  let s = "";
  for(let i = 0; i < b.length;){
    const c = b[i++];
    let cp;
    if(c < 0x80) cp = c;
    else if(c < 0xe0) cp = ((c & 31) << 6) | (b[i++] & 63);
    else if(c < 0xf0){ cp = ((c & 15) << 12) | ((b[i++] & 63) << 6); cp |= b[i++] & 63; }
    else { cp = ((c & 7) << 18) | ((b[i++] & 63) << 12); cp |= (b[i++] & 63) << 6; cp |= b[i++] & 63; }
    s += cp > 0xffff
      ? String.fromCharCode(0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 1023))
      : String.fromCharCode(cp);
  }
  return s;
}

const CRC_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function crcB64Encode(bytes){
  let s = "", acc = 0, nb = 0;
  for(const b of bytes){
    acc = (acc << 8) | b; nb += 8;
    while(nb >= 6){ nb -= 6; s += CRC_B64[(acc >> nb) & 63]; }
    acc &= (1 << nb) - 1;
  }
  if(nb > 0) s += CRC_B64[(acc << (6 - nb)) & 63];
  return s;
}
function crcB64Decode(str){
  const out = []; let acc = 0, nb = 0;
  for(const ch of str){
    const v = CRC_B64.indexOf(ch);
    if(v < 0) throw new Error("caractere invalido");
    acc = (acc << 6) | v; nb += 6;
    if(nb >= 8){ nb -= 8; out.push((acc >> nb) & 255); acc &= (1 << nb) - 1; }
  }
  return out;
}

// Soma de verificacao de 2 bytes (Fletcher-16) do JSON: pega um caractere trocado ou perdido pelo
// cliente de e-mail que, mesmo assim, ainda descomprimiria.
function crcCheck(bytes){
  let a = 0, b = 0;
  for(const x of bytes){ a = (a + x) % 255; b = (b + a) % 255; }
  return [b, a];
}

// ----- CRC -----
const CRC_PREFIX = "CRC1-";
const CRC_VERSION = 1;
// O dicionario (61-core-crc-dicionario.js) e congelado; os bytes sao calculados na primeira vez que precisam.
let _crcDictBytes = null;
function crcDict(){ return _crcDictBytes || (_crcDictBytes = crcUtf8Bytes(CRC_DICT_V1)); }

// Textos colados do GDS: quando dois campos tem o MESMO texto (ex.: PNR + tarifa colados
// juntos no itinerario e na mascara), o segundo vira so uma referencia ao primeiro.
const CRC_TEXT_FIELDS = ["itin", "maskADT", "maskCHD", "maskINF"];
// maskAll e so a caixa de entrada que e repartida em maskADT/CHD/INF; o rascunho tambem
// nao a restaura. Guardar duplicaria o maior texto do codigo.
const CRC_SKIP_FIELDS = ["maskAll"];

// state = { controls, defaults, fxMeta, cabineSource, cabins }
//   controls/defaults: { id: {value} | {checked} } (formato de collectDraftControls)
// So entra o que difere da tela em branco; texto so com espacos conta como vazio.
function buildCRCPayload(state){
  const controls = (state && state.controls) || {};
  const defaults = (state && state.defaults) || {};
  const c = {}, r = {}, seen = {};
  for (const [id, st] of Object.entries(controls)) {
    if (CRC_SKIP_FIELDS.includes(id) || !st) continue;
    const def = defaults[id] || {};
    if ("checked" in st) {
      if (!!st.checked !== !!def.checked) c[id] = st.checked ? 1 : 0;
      continue;
    }
    const v = st.value == null ? "" : String(st.value);
    const dflt = def.value == null ? "" : String(def.value);
    if (v === dflt) continue;
    if (!v.trim() && !dflt.trim()) continue;
    if (CRC_TEXT_FIELDS.includes(id) && v.trim()) {
      const igual = CRC_TEXT_FIELDS.find((o) => seen[o] === v);
      if (igual) { r[id] = igual; continue; }
      seen[id] = v;
    }
    c[id] = v;
  }
  const payload = { v: CRC_VERSION, c };
  if (Object.keys(r).length) payload.r = r;
  const fx = (state && state.fxMeta) || {};
  if (fx.source || fx.baseDate || fx.usageDate) payload.fx = [fx.source || "", fx.baseDate || "", fx.usageDate || ""];
  if (state && state.cabineSource) payload.cs = state.cabineSource;
  if (state && Array.isArray(state.cabins) && state.cabins.length) payload.cab = state.cabins.map(String);
  return payload;
}

function encodeCRC(payload){
  const json = crcUtf8Bytes(JSON.stringify(payload));
  return CRC_PREFIX + crcB64Encode(crcCheck(json).concat(crcDeflate(json, crcDict())));
}

// Aceita o codigo puro ou o e-mail inteiro (resposta da agencia, encaminhamento), com
// quebras de linha no meio e o ">" que alguns clientes poem no inicio da linha citada.
function extractCRC(text){
  // Caracteres invisiveis (largura zero, BOM, hifen opcional) que alguns clientes de e-mail inserem no meio do codigo.
  const compact = String(text || "").replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "")
    .replace(/\r?\n[ \t]*(?:>[ \t]*)*/g, "").replace(/\s+/g, "");
  // Alfabeto do CRC1 = base64url (A-Z a-z 0-9 - _). "+" e "$" NAO fazem parte dele: se entrassem na busca, uma assinatura
  // logo apos o codigo (ex.: "+55 11 ...") seria lida como se fosse o codigo e o CRC "falharia".
  const m = compact.match(/CRC1-[A-Za-z0-9\-_]+/i);
  return m ? m[0].slice(0, 5).toUpperCase() + m[0].slice(5) : null;
}

// Devolve o payload ou lanca Error com mensagem para o operador.
function decodeCRC(text){
  const code = extractCRC(text);
  if (!code) {
    if (/CRR[1-5]-|RA1-/i.test(String(text || "").replace(/\s+/g, ""))) {
      throw new Error("Este código é um CRR da Reemissão. Abra-o na Calculadora de Reemissão.");
    }
    throw new Error("Nenhum código CRC encontrado no texto colado.");
  }
  const danificado = new Error("CRC incompleto ou danificado. Copie o código inteiro do rodapé do e-mail.");
  let payload = null;
  try {
    const bytes = crcB64Decode(code.slice(5));
    const raw = crcInflate(bytes.slice(2), crcDict());
    const chk = crcCheck(raw);
    if (chk[0] !== bytes[0] || chk[1] !== bytes[1]) throw danificado;
    payload = JSON.parse(crcUtf8Str(raw));
  } catch (e) { payload = null; }
  if (!payload || typeof payload !== "object" || !payload.c || typeof payload.c !== "object") throw danificado;
  if (payload.v !== CRC_VERSION) throw new Error("Versão de CRC não suportada por esta calculadora.");
  return payload;
}

// Do payload para o estado completo da tela: parte da tela em branco (defaults) e aplica
// o que veio no codigo. Campo que nao existe na tela em branco (nomes dos passageiros,
// criados conforme a quantidade) entra como esta.
function expandCRCPayload(payload, defaults){
  const controls = {};
  for (const [id, st] of Object.entries(defaults || {})) controls[id] = Object.assign({}, st);
  for (const [id, v] of Object.entries(payload.c || {})) {
    const def = (defaults || {})[id];
    const isCheck = def ? ("checked" in def) : (typeof v === "number");
    controls[id] = isCheck ? { checked: !!v } : { value: v == null ? "" : String(v) };
  }
  for (const [id, ref] of Object.entries(payload.r || {})) {
    const src = controls[ref];
    if (src && "value" in src) controls[id] = { value: src.value };
  }
  for (const id of CRC_SKIP_FIELDS) if (controls[id]) controls[id] = { value: "" };
  const fx = Array.isArray(payload.fx) ? payload.fx : [];
  return {
    controls,
    fxMeta: { source: fx[0] || "", baseDate: fx[1] || "", usageDate: fx[2] || "" },
    cabineSource: payload.cs || "",
    cabins: Array.isArray(payload.cab) ? payload.cab.map(String) : null
  };
}
