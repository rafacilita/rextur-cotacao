# Analise critica de confiabilidade para leitura GDS

## Proposito

Este documento consolida a analise tecnica para evoluir a calculadora interna da RexturAdvance com leitura automatica de dados vindos de Sabre e Amadeus.

O objetivo operacional e acelerar o envio de calculos de cotacao aos clientes sem comprometer a confiabilidade dos dados. A meta de "100% confiavel" deve ser entendida como: o sistema nunca deve inventar, ocultar incerteza ou enviar um dado critico sem validacao quando a leitura automatica nao for segura.

Em GDS, 100% de leitura automatica silenciosa nao e uma premissa segura, porque ha variacoes de formato, idioma, companhia, PCC, tipo de retorno, status, moeda, impostos e passageiros. A confiabilidade real vem de uma combinacao de parser robusto, modelo estruturado, validacoes, avisos e revisao humana assistida.

## Fontes consideradas

Arquivos locais analisados:

- `Basico_Reservas SABRE APOSTILA (1).pdf`
- `Apostila Basico Reservas 2026.pdf`
- `Apostila do aluno - Tarifas e tarifamento avancado (Criptico).ptBR_7605 (4).pdf`
- `index.html` oficial sincronizado com `rafacilita/rextur-cotacao`

Observacao tecnica: os PDFs tem extracao textual irregular por causa de fontes, imagens e streams compactados. A apostila basica Amadeus permitiu extrair conteudo util com mais clareza; a apostila de tarifamento avancado deve ser complementada com exemplos reais de tela antes de virar regra automatica definitiva.

## Principio central de confiabilidade

O sistema deve ser conservador.

Se um dado nao puder ser extraido com alta confianca, ele deve:

- Ficar em branco.
- Ser marcado como pendente.
- Exibir aviso claro ao usuario.
- Permitir preenchimento manual.

Nunca deve:

- Assumir uma moeda sem evidencias.
- Somar valores ambíguos.
- Tratar tarifa de um passageiro como tarifa de grupo sem validacao.
- Confundir total por passageiro com total geral.
- Inferir bagagem sem linha ou indicador confiavel.
- Enviar status de voo problemático como se fosse confirmado.

## Classificacao de confianca

Cada campo extraido deve receber nivel de confianca:

- Alta: extraido por padrao conhecido e validado por consistencia.
- Media: extraido por padrao conhecido, mas sem todos os elementos de confirmacao.
- Baixa: inferido por proximidade textual, formato parcial ou retorno incompleto.
- Manual: campo preenchido ou confirmado pelo usuario.

Campos de baixa confianca nao devem entrar automaticamente no e-mail final sem destaque visual.

## Estrutura recomendada

### Camada 1: Normalizacao do texto

Antes de qualquer parser:

- Remover espacos duplicados.
- Preservar quebras de linha originais.
- Normalizar caracteres corrompidos comuns.
- Manter uma copia do texto bruto.
- Separar blocos provaveis: PNR, itinerario, tarifamento, remarks, contatos.

### Camada 2: Deteccao de GDS

Detectar Sabre ou Amadeus por sinais combinados, nao por uma unica palavra.

Sinais Amadeus:

- Comandos e referencias como `AN`, `SS`, `NM`, `AP`, `TK`, `RT`, `SR`, `RM`, `RC`, `RIR`, `XE`, `SB`, `IEP`.
- Segmentos com estrutura Amadeus e status de reserva.
- Presenca de elementos como `ARNK`, `OPERATED BY`, `TST`, `FXP`, `FXX`, `FXA`, `FXB`, `FQD`, `TQT`.

Sinais Sabre:

- Padroes de exibicao Sabre de itinerario e tarifa.
- Passageiro infantil com marcador `I/`.
- Linhas de tarifa com `XT`, `USD`, `BRL`, `RATE USED`, `BSR`.
- Status e estrutura tipica de PNR Sabre.

Se houver sinais mistos, exigir confirmacao do usuario.

### Camada 3: Parser especifico por GDS

Cada GDS deve ter parser proprio, com contrato unico de saida.

O parser nao deve montar HTML. Ele deve apenas retornar dados estruturados.

Campos minimos:

- `source.gds`
- `source.confidence`
- `recordLocator`
- `passengers`
- `segments`
- `pricing`
- `baggage`
- `paymentHints`
- `warnings`
- `rawBlocks`

### Camada 4: Modelo unico de cotacao

Depois do parser, tudo deve convergir para um modelo comum:

- Passageiros por tipo.
- Segmentos normalizados.
- Tarifas por tipo de passageiro.
- Totais por passageiro e por grupo.
- Cambio.
- Bagagem.
- Condicoes comerciais.
- Avisos de qualidade.

O `QuoteModel` atual no `index.html` ja e um bom ponto de partida.

## Analise Amadeus para aplicacao

### Disponibilidade e venda

A apostila basica Amadeus referencia disponibilidade com `AN` e venda com `SS`.

Impacto no sistema:

- `AN` e `SS` sao comandos de criacao/consulta, mas o sistema normalmente recebera a exibicao ja criada ou o PNR.
- Nao basta ler uma tela de disponibilidade como se fosse itinerario confirmado.
- Segmentos vendidos devem ter status interpretado.

Regra critica:

- Tela de disponibilidade nao e cotacao confirmada.
- Segmento com status nao confirmado deve gerar aviso.

### Passageiros

Formatos relevantes extraidos da apostila:

- Adulto: `NM1 SMITH/JOHN PAUL MR`
- Crianca: `NM1 LEE/MIA MISS (CHD/09FEB16)`
- Adulto e bebe mesmo sobrenome: `NM1 BELL/PIA MS(INF/BEN/01JUL21)`
- Adulto e bebe sobrenome diferente: `NM1 BELL/JIM MR(INFBOND/KIM/01JUN21)`

Impacto no sistema:

- O parser atual ja cobre parte desses casos.
- Deve reforcar `MS` como adulto, alem de `MR` e `MRS`.
- Deve aceitar `CHD/data`, `INF/nome/data` e `INFSOBRENOME/nome/data`.
- Deve separar nome do adulto e nome do bebe sem contaminar o ADT.
- Deve preservar data de nascimento em metadado, mesmo que nao apareca no e-mail.

Risco:

- `MISS` pode ser crianca ou adulta dependendo do contexto. Se houver `(CHD/...)`, classificar como CHD. Sem marcador, classificar por regra configuravel ou pedir confirmacao.

### Contatos e associacao de passageiro

Formatos relevantes:

- `AP...`
- `APM-.../P2`
- `APB-.../P2`
- `APE-EMAIL/P2`
- `SR CTCM`
- `SR CTCE`
- `SR CTCR`

Impacto no sistema:

- Contatos nao devem entrar automaticamente no e-mail de cotacao, salvo se houver finalidade clara.
- Podem ajudar a validar PNR e associacao de passageiro.
- O e-mail do cliente deve ser tratado com cautela, pois pode ser dado pessoal.

Regra critica:

- Nao expor telefone/e-mail de passageiro no e-mail de cotacao sem necessidade operacional.

### Prazo de emissao

Formatos relevantes:

- `TKTL 30MAR`
- `TKTL 30MAR/1500`
- `TKTL 30MAR/S4-5`
- `TKXL 19NOV/1800`
- `TKOK`

Impacto no sistema:

- O prazo de emissao pode alimentar `Prazo / Validade`.
- Se houver prazo por segmento, o sistema deve avisar que a validade nao e unica.

Regra critica:

- Prazo deve ser exibido somente se a linha for inequivoca. Caso contrario, manter "Imediato" ou campo manual.

### Recuperacao e exibicao de PNR

Formatos relevantes:

- `RTxxxxxx`
- `RT/SOBRENOME`
- `RT/SOBRENOME/NOME*A`
- `RT1`
- `RT0`

Impacto no sistema:

- O localizador Amadeus pode ser capturado quando aparecer na exibicao do PNR.
- Listas de PNR nao devem ser confundidas com PNR individual.

Regra critica:

- Se a tela for lista de PNR, bloquear autopreenchimento de cotacao.

### Servicos especiais e remarks

Formatos relevantes:

- `SR VGML/S4-7`
- `SR BSCT/P2`
- `RM`
- `RC`
- `RIR`
- `RII`
- `OS`

Impacto no sistema:

- SSR e remarks podem conter informacao comercial, mas tambem dados sensiveis.
- Para cotacao, devem ser usados apenas quando houver regra explicita.

Regra critica:

- Remarks e SSR nao devem ser renderizados automaticamente no e-mail final por padrao.

### Modificacoes e status

Formatos relevantes:

- `XE3`
- `XE3-5,9`
- `3/HK`
- `XI`
- `SB25AUG5`
- `SBK`
- `ERK`
- `ETK`

Impacto no sistema:

- Status pode mudar apos `ERK/ETK`.
- O sistema deve interpretar status atual da exibicao, nao o comando digitado.

Regra critica:

- Status `HK` e forte indicador de confirmado.
- Status de solicitacao, lista de espera, cancelado, nao confirmado ou alterado deve gerar alerta.

### Itinerario

Campos necessarios:

- Numero do segmento.
- Companhia.
- Voo.
- Classe/RBD.
- Data.
- Origem.
- Destino.
- Status.
- Quantidade.
- Horario de saida.
- Horario de chegada.
- Data de chegada ou offset de dia.
- Operado por.
- ARNK/superficie.

Riscos:

- Conexoes e married segments.
- Chegada no dia seguinte.
- Codeshare.
- Segmento informativo.
- ARNK.
- Segmento cancelado ainda visivel no historico.

Regra critica:

- Somente segmentos aereos ativos devem formar a tabela principal.
- Segmentos surface/ARNK devem aparecer como observacao ou separador de rota, nao como voo.

## Analise Amadeus de tarifas e tarifamento

A apostila de tarifamento avancado deve orientar a evolucao, mas precisa de exemplos reais de tela para fixar regexes finais.

Comandos e conceitos relevantes para considerar:

- `FXP`: precificacao do itinerario.
- `FXX`: precificacao informativa.
- `FXA`: alternativas de menor tarifa.
- `FXB`: melhor tarifa aplicavel.
- `FQD`: exibicao de tarifas.
- `FQP`: precificacao por par de cidades sem PNR.
- `TQT`: exibicao de TST.
- `TST`: mascara/registro de tarifa armazenada.
- `FQN` ou notas/regras tarifarias, quando usadas.
- `FQK` ou detalhamento de taxas, quando disponivel.

Impacto no sistema:

- Nem todo retorno de tarifa deve alimentar a cotacao final.
- Retorno de disponibilidade tarifaria, fare display ou alternativas nao e a mesma coisa que TST/itinerario precificado.
- O parser deve distinguir: tarifa informativa, tarifa armazenada, tarifa selecionada e tarifa por passageiro.

Regra critica:

- Para e-mail de cotacao, priorizar retorno de precificacao final ou mascara/TST validada.
- Fare display (`FQD`) nao deve ser usado como preco final.
- Alternativas (`FXA/FXB`) devem ser tratadas como candidatas, nao como cotacao final, salvo confirmacao do usuario.

Campos tarifarios a extrair:

- Passageiro/tipo: ADT, CHD, INF.
- Base tarifaria/fare basis quando disponivel.
- Moeda da tarifa.
- Tarifa base.
- Equivalente em BRL.
- Taxas discriminadas ou total de taxas.
- Total por passageiro.
- Total geral.
- Cambio/ROE/BSR/IATA quando exibido.
- Bagagem.
- Validadores de emissao ou prazo, quando exibidos.

## Analise Sabre para aplicacao

O Sabre permanece como base principal junto com Amadeus.

Pontos criticos:

- Identificar corretamente PNR versus disponibilidade.
- Ler passageiros ADT/CHD/INF, incluindo `I/`.
- Ler segmentos ativos e status.
- Interpretar tarifas com `USD`, `BRL`, `XT`, total e cambio.
- Normalizar bagagem `02P`, `01P`, `0P`, `NIL`.
- Capturar `OPERATED BY` e codeshare.
- Evitar somar linhas duplicadas de tarifa ou historico.
- Distinguir informacoes disponiveis em `PQ` e em `WP`.

Risco maior:

- Retornos Sabre podem variar bastante conforme comando e tela. O parser deve ser testado com exemplos reais da operacao RexturAdvance.

### Sabre: diferenca pratica entre PQ e WP

Exemplo real analisado com IB mostrou uma diferenca importante:

- O `PQ` trouxe valores por tipo de passageiro, taxas, total, prazo de compra, fare basis por tipo e bagagem textual `01P`.
- O `WP` trouxe a visao consolidada com `P1ADT/1CNN/1INF`, total geral, `RATE USED` e `BRANDED FARE /OPTIMA-OPTIMA/OPTIMA-OPTIMA`.
- A familia tarifaria `OPTIMA` apareceu no `WP`, nao no `PQ`.
- No `WP`, a bagagem apareceu como icone de mala acesa, sem texto `01P`.

Regras para o sistema:

- Nao exigir familia tarifaria quando o usuario colar apenas `PQ`.
- Buscar `BRANDED FARE` quando houver retorno `WP`.
- Tratar `BRANDED FARE /OPTIMA-OPTIMA/OPTIMA-OPTIMA` como familia tarifaria `OPTIMA`, eliminando repeticoes.
- Nao converter icone visual de mala em quantidade de bagagem sem dado textual confiavel.
- Se a mala aparecer apenas como simbolo/OCR, marcar como "bagagem sinalizada, quantidade nao confirmada".
- Preferir bagagem textual dos blocos `PQ` quando existir (`01P`, `02P`, `NIL`, `0P`).
- Usar `WP` para validar totais consolidados e cambio quando o retorno estiver completo.

Recomendacao de coleta para fixtures e operacao:

- Para Sabre, solicitar que o usuario envie `WP` e `PQ` em campos/blocos separados.
- `WP` deve alimentar: total consolidado, cambio, branded fare/familia tarifaria e validacao geral.
- `PQ` deve alimentar: fare basis, bagagem textual, prazo, detalhes por passageiro e regras associadas.
- Se apenas um bloco for enviado, o sistema deve trabalhar com ele, mas registrar aviso de informacao potencialmente incompleta.

## Validacoes obrigatorias antes de gerar e-mail

O botao de gerar previa deve validar:

- GDS detectado.
- Pelo menos um segmento aereo ativo.
- Pelo menos um passageiro ou quantidade manual.
- Para cada tipo de passageiro com quantidade maior que zero, tarifa correspondente ou aviso.
- Moeda e total coerentes.
- Total do grupo coerente com total por passageiro multiplicado pela quantidade.
- Cambio informado quando houver RC em USD.
- Bagagem ausente ou variavel sinalizada.
- Status problemático sinalizado.

## Regras de bloqueio e aviso

Bloquear geracao automatica ou exigir confirmacao quando:

- Texto parece disponibilidade, nao PNR.
- Texto parece lista de PNR, nao PNR unico.
- Ha mais de um localizador conflitante.
- Ha totais conflitantes.
- Ha moeda sem valor ou valor sem moeda.
- Ha passageiro sem tipo claro.
- Ha segmento cancelado ou nao confirmado sendo lido como ativo.

Permitir geracao com aviso quando:

- Bagagem nao encontrada.
- Operated by ausente.
- Taxas inferidas por diferenca.
- Prazo de emissao nao encontrado.
- INF sem data de nascimento.
- Fare basis nao encontrada.

## Plano de testes rigoroso

Criar uma pasta futura `tests/fixtures` ou `exemplos_gds` com textos reais anonimizados.

Casos minimos:

- Amadeus PNR simples ADT.
- Amadeus ADT + CHD + INF mesmo sobrenome.
- Amadeus INF com sobrenome diferente.
- Amadeus com ARNK.
- Amadeus com operated by.
- Amadeus tarifa FXP/TST ADT.
- Amadeus tarifa ADT/CHD/INF.
- Amadeus fare display que nao deve virar cotacao.
- Sabre PNR simples ADT.
- Sabre ADT + CHD + INF.
- Sabre com codeshare.
- Sabre tarifa com `XT`.
- Sabre tarifa com bagagem `NIL`.
- Sabre status nao confirmado.

Cada fixture deve ter saida esperada:

- GDS.
- Passageiros.
- Segmentos.
- Status.
- Bagagem.
- Valores.
- Warnings esperados.

## Criterio de aceite para "100% confiavel"

O sistema pode ser considerado confiavel quando:

- Todos os campos criticos extraidos automaticamente passam em testes com exemplos reais.
- Todo campo ambíguo gera aviso.
- Nenhum exemplo conhecido gera total incorreto sem alerta.
- Disponibilidade/fare display/lista de PNR nao sao confundidos com cotacao final.
- A revisao humana fica focada em excecoes, nao em conferir tudo do zero.

## Recomendacao de implementacao

1. Criar fixtures reais anonimizadas.
2. Criar uma funcao `analyzeRawInput(raw)` que separe blocos e detecte GDS.
3. Criar `parseAmadeus(raw)` e `parseSabre(raw)` com contrato unico.
4. Adicionar `confidence` e `warnings` por campo.
5. Reforcar `parsePaxFromItin` para `MS`, `CHD`, `INF`, `INFSURNAME`.
6. Reforcar parser Amadeus para prazos `TK`, status, localizador e ARNK.
7. Separar retornos de tarifa final de retornos informativos.
8. Impedir que dado de baixa confianca entre no e-mail sem destaque.

## Referencia comparativa: EasyPNR

O EasyPNR foi observado como referencia publica de fluxo de produto, nao como fonte de codigo ou regra proprietaria.

Ele se posiciona como decodificador e formatador de PNR para Amadeus, Sabre e Travelport Galileo. O HTML publico mostra alguns pontos uteis para nossa evolucao:

- Campo unico para colar texto bruto de Amadeus, Sabre ou Galileo.
- Decodificacao automatica durante a digitacao/colagem, com pequeno atraso.
- Suporte de idioma na saida.
- Area separada para resultado decodificado.
- Acoes simples depois da decodificacao: selecionar tudo, enviar por e-mail e exportar para Word.
- Possibilidade futura de integracao via API/webservice.
- Inclusao de Galileo/Travelport como GDS futuro.
- Foco em leitura e formatacao de PNR, sem camada comercial de cotacao.

### O que e util absorver

1. Entrada unica inteligente.
   - Em vez de exigir que o usuario escolha manualmente Sabre ou Amadeus, permitir colar qualquer bloco e detectar origem automaticamente.
   - Manter selecao manual como fallback quando a deteccao for ambigua.

2. Decodificacao incremental.
   - Apos colar ou digitar, o sistema pode analisar em tempo quase real.
   - Para evitar instabilidade, usar atraso curto e previsivel antes de reprocessar.

3. Resultado intermediario legivel.
   - Antes de gerar o e-mail comercial, exibir uma camada "dados lidos do GDS".
   - Isso ajuda o usuario a conferir passageiros, trechos, status, bagagem e tarifas.

4. Acoes de saida.
   - Manter copiar HTML para Outlook.
   - Considerar exportacao para Word em fase futura, se isso tiver uso operacional.
   - Considerar envio por e-mail apenas se houver seguranca, controle e auditoria.

5. Multi-GDS por contrato.
   - EasyPNR declara suporte a Galileo alem de Sabre e Amadeus.
   - Nosso sistema deve ficar preparado para incluir Galileo/Travelport no futuro, mas sem comprometer a confiabilidade inicial.

6. Idioma.
   - O EasyPNR permite escolher idioma da decodificacao.
   - Para a RexturAdvance, o padrao deve ser portugues comercial, mas pode ser util separar labels do motor de dados para permitir saidas futuras em outros idiomas.

### O que nao resolve nosso problema

O EasyPNR atua como decodificador de itinerario/PNR. Isso e diferente da nossa calculadora.

Lacunas relevantes para nosso uso:

- Nao ha indicio, pelo HTML publico, de tratamento comercial de cotacao.
- Nao ha evidencia de calculo de RC.
- Nao ha evidencia de validacao rigorosa de totais por passageiro e grupo.
- Nao ha evidencia de leitura de tarifas complexas com regras comerciais internas.
- Nao ha evidencia de classificacao de confianca por campo.
- Nao ha evidencia de alerta especifico para code-share/operated by.
- Nao ha evidencia de bloqueio quando uma tela de disponibilidade e confundida com PNR.

### Melhorias concretas para a calculadora

Adicionar uma etapa visual antes da previa do e-mail:

- `GDS detectado`
- `Tipo de bloco detectado`: PNR, disponibilidade, tarifa, TST/mascara, lista de PNR, indefinido.
- `Passageiros lidos`
- `Segmentos lidos`
- `Status dos segmentos`
- `Operado por / code-share`
- `Tarifas lidas`
- `Bagagem lida`
- `Warnings`

Adicionar uma logica explicita de code-share:

- Companhia comercial: carrier/voo exibido no segmento principal.
- Companhia operadora: dados vindos de `OPERATED BY`, `AS XX FLT 123`, linhas 050/127 em Amadeus ou equivalentes Sabre.
- Exibir no e-mail quando operadora for diferente da companhia comercial.
- Gerar aviso quando houver sinal de code-share mas a operadora nao for identificada.

Adicionar classificacao do texto colado:

- `pnr_active`: PNR individual ativo.
- `availability`: tela de disponibilidade, nao usar como cotacao final.
- `pricing_final`: precificacao final ou mascara/TST.
- `pricing_candidate`: alternativa de tarifa, menor tarifa ou fare display.
- `pnr_list`: lista de PNR, nao usar como cotacao.
- `unknown`: exigir revisao.

Adicionar acoes similares, mas alinhadas ao nosso objetivo:

- Copiar e-mail HTML.
- Copiar resumo de dados lidos.
- Exportar diagnostico do parser para teste.
- Futuramente exportar Word/PDF, se houver demanda.

### Conclusao da comparacao

O EasyPNR reforca que a experiencia ideal com GDS comeca em um campo unico de texto bruto e uma resposta imediata de decodificacao.

Para a RexturAdvance, o diferencial nao deve ser apenas decodificar PNR. O diferencial deve ser transformar PNR e tarifamento em uma cotacao comercial confiavel, com validacoes, avisos, code-share, bagagem, RC, cambio e totais coerentes.

Portanto, a melhor implementacao e aproveitar o conceito de "decodificador intermediario", mas evoluir para um fluxo de cotacao auditavel e conservador.

## Conclusao

O caminho correto nao e tentar adivinhar todos os formatos possiveis de uma vez. O caminho robusto e construir um pipeline que leia com confianca o que conhece, sinalize o que nao conhece e evolua com exemplos reais.

Para uso interno da RexturAdvance, isso entrega produtividade sem sacrificar seguranca operacional. A leitura automatica deve ser assistente, nao autoridade cega.
