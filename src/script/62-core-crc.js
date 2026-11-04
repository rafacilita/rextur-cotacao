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
// Formato: "CRC1-" + LZString.compressToEncodedURIComponent(JSON.stringify(payload)).
// Prefixo proprio (e nao CRR) para a Reemissao e a Cotacao nunca lerem o codigo uma da outra.

// ----- LZ-String (copiado da Calculadora de Reemissao, que usa o mesmo formato no CRR4) -----
// Implementacao baseada em lz-string (pieroxy, MIT). So compressToEncodedURIComponent /
// decompressFromEncodedURIComponent sao usados.
const LZString = (function(){
  const f = String.fromCharCode;
  const keyStrUriSafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";
  const baseReverseDic = {};

  function getBaseValue(alphabet, character) {
    if(!baseReverseDic[alphabet]) {
      baseReverseDic[alphabet] = {};
      for (let i=0; i<alphabet.length; i++) baseReverseDic[alphabet][alphabet.charAt(i)] = i;
    }
    return baseReverseDic[alphabet][character];
  }

  function _compress(uncompressed, bitsPerChar, getCharFromInt) {
    if (uncompressed == null) return "";
    let i, value;
    const context_dictionary = {};
    const context_dictionaryToCreate = {};
    let context_c = "";
    let context_wc = "";
    let context_w = "";
    let context_enlargeIn = 2;
    let context_dictSize = 3;
    let context_numBits = 2;
    const context_data = [];
    let context_data_val = 0;
    let context_data_position = 0;

    function writeBit(bit){
      context_data_val = (context_data_val << 1) | bit;
      if (context_data_position === bitsPerChar - 1) {
        context_data_position = 0;
        context_data.push(getCharFromInt(context_data_val));
        context_data_val = 0;
      } else {
        context_data_position++;
      }
    }
    function writeBits(numBits, val){
      for (i=0;i<numBits;i++){
        writeBit(val & 1);
        val >>= 1;
      }
    }

    for (let ii=0; ii<uncompressed.length; ii++){
      context_c = uncompressed.charAt(ii);
      if (!Object.prototype.hasOwnProperty.call(context_dictionary, context_c)) {
        context_dictionary[context_c] = context_dictSize++;
        context_dictionaryToCreate[context_c] = true;
      }

      context_wc = context_w + context_c;
      if (Object.prototype.hasOwnProperty.call(context_dictionary, context_wc)) {
        context_w = context_wc;
      } else {
        if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
          if (context_w.charCodeAt(0) < 256) {
            writeBits(context_numBits, 0);
            value = context_w.charCodeAt(0);
            writeBits(8, value);
          } else {
            writeBits(context_numBits, 1);
            value = context_w.charCodeAt(0);
            writeBits(16, value);
          }
          context_enlargeIn--;
          if (context_enlargeIn === 0) {
            context_enlargeIn = Math.pow(2, context_numBits);
            context_numBits++;
          }
          delete context_dictionaryToCreate[context_w];
        } else {
          value = context_dictionary[context_w];
          writeBits(context_numBits, value);
        }

        context_enlargeIn--;
        if (context_enlargeIn === 0) {
          context_enlargeIn = Math.pow(2, context_numBits);
          context_numBits++;
        }

        context_dictionary[context_wc] = context_dictSize++;
        context_w = String(context_c);
      }
    }

    if (context_w !== "") {
      if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
        if (context_w.charCodeAt(0) < 256) {
          writeBits(context_numBits, 0);
          value = context_w.charCodeAt(0);
          writeBits(8, value);
        } else {
          writeBits(context_numBits, 1);
          value = context_w.charCodeAt(0);
          writeBits(16, value);
        }
        context_enlargeIn--;
        if (context_enlargeIn === 0) {
          context_enlargeIn = Math.pow(2, context_numBits);
          context_numBits++;
        }
        delete context_dictionaryToCreate[context_w];
      } else {
        value = context_dictionary[context_w];
        writeBits(context_numBits, value);
      }

      context_enlargeIn--;
      if (context_enlargeIn === 0) {
        context_enlargeIn = Math.pow(2, context_numBits);
        context_numBits++;
      }
    }

    writeBits(context_numBits, 2);

    while (true) {
      context_data_val = (context_data_val << 1);
      if (context_data_position === bitsPerChar - 1) {
        context_data.push(getCharFromInt(context_data_val));
        break;
      } else context_data_position++;
    }

    return context_data.join("");
  }

  function _decompress(length, resetValue, getNextValue) {
    const dictionary = [];
    let next;
    let enlargeIn = 4;
    let dictSize = 4;
    let numBits = 3;
    let entry = "";
    const result = [];
    let i;
    let w;
    let bits, resb, maxpower, power;
    const data = { val: getNextValue(0), position: resetValue, index: 1 };

    for (i=0; i<3; i++) dictionary[i] = i;

    function readBits(nbits){
      bits = 0;
      maxpower = Math.pow(2, nbits);
      power = 1;
      while (power !== maxpower) {
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position === 0) {
          data.position = resetValue;
          data.val = getNextValue(data.index++);
        }
        bits |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
      }
      return bits;
    }

    next = readBits(2);
    switch (next) {
      case 0:
        w = f(readBits(8));
        break;
      case 1:
        w = f(readBits(16));
        break;
      case 2:
        return "";
      default:
        return null;
    }

    dictionary[3] = w;
    result.push(w);

    while (true) {
      if (data.index > length) return null;

      const c = readBits(numBits);

      switch (c) {
        case 0:
          dictionary[dictSize++] = f(readBits(8));
          next = dictSize - 1;
          enlargeIn--;
          break;
        case 1:
          dictionary[dictSize++] = f(readBits(16));
          next = dictSize - 1;
          enlargeIn--;
          break;
        case 2:
          return result.join("");
        default:
          next = c;
      }

      if (enlargeIn === 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }

      if (dictionary[next]) {
        entry = dictionary[next];
      } else {
        if (next === dictSize) entry = w + w.charAt(0);
        else return null;
      }
      result.push(entry);

      dictionary[dictSize++] = w + entry.charAt(0);
      enlargeIn--;

      w = entry;

      if (enlargeIn === 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }
    }
  }

  return {
    compressToEncodedURIComponent: function(input){
      if (input == null) return "";
      return _compress(input, 6, function(a){ return keyStrUriSafe.charAt(a); });
    },
    decompressFromEncodedURIComponent: function(input){
      if (input == null) return "";
      if (input === "") return null;
      input = input.replace(/ /g, "+");
      return _decompress(input.length, 32, function(index){ return getBaseValue(keyStrUriSafe, input.charAt(index)); });
    }
  };
})();

// ----- CRC -----
const CRC_PREFIX = "CRC1-";
const CRC_VERSION = 1;

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
  return CRC_PREFIX + LZString.compressToEncodedURIComponent(JSON.stringify(payload));
}

// Aceita o codigo puro ou o e-mail inteiro (resposta da agencia, encaminhamento), com
// quebras de linha no meio e o ">" que alguns clientes poem no inicio da linha citada.
function extractCRC(text){
  const compact = String(text || "").replace(/\r?\n[ \t]*(?:>[ \t]*)*/g, "").replace(/\s+/g, "");
  const m = compact.match(/CRC1-[A-Za-z0-9+\-$]+/i);
  return m ? CRC_PREFIX + m[0].slice(CRC_PREFIX.length) : null;
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
  let payload = null;
  try {
    const json = LZString.decompressFromEncodedURIComponent(code.slice(CRC_PREFIX.length));
    payload = json ? JSON.parse(json) : null;
  } catch (e) { payload = null; }
  if (!payload || typeof payload !== "object" || !payload.c || typeof payload.c !== "object") {
    throw new Error("CRC incompleto ou danificado. Copie o código inteiro do rodapé do e-mail.");
  }
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
