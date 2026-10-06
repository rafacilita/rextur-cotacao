# Base de raciocinio do sistema de cotacao RexturAdvance

## Objetivo

Este sistema sera utilizado internamente pela RexturAdvance para facilitar a leitura, organizacao e envio de calculos de cotacao aos clientes.

A proposta e reduzir trabalho manual, padronizar o e-mail enviado e diminuir erros na transcricao de dados extraidos dos GDS. O foco inicial e gerar uma cotacao clara, completa e pronta para copiar no Outlook, usando os dados colados pelo usuario a partir do Sabre ou Amadeus.

## Contexto de uso

O usuario interno recebe ou consulta informacoes de reserva, itinerario e tarifamento no GDS. Em vez de montar manualmente o e-mail de cotacao, ele cola os blocos relevantes no sistema.

O sistema deve interpretar automaticamente os dados possiveis, preencher a cotacao e permitir ajustes manuais quando a leitura automatica nao for suficiente.

O resultado final deve ser um e-mail comercial padronizado para o cliente, contendo itinerario, passageiros quando aplicavel, valores por tipo de passageiro, taxas, RC, cambio, bagagem, condicoes e formas de pagamento.

## Escopo inicial

Os GDS iniciais sao:

- Sabre
- Amadeus

O sistema deve nascer preparado para ampliar futuramente a outros GDS, sem misturar regras especificas de cada fonte diretamente na renderizacao final.

## Principio de arquitetura

Separar o sistema em camadas:

1. Entrada bruta
   - Texto colado do GDS.
   - Pode conter itinerario, nomes, tarifas, bagagem, localizador e observacoes.

2. Deteccao de origem
   - Identificar se o bloco veio de Sabre, Amadeus ou outro GDS futuro.
   - Quando a origem nao for confiavel, sinalizar para o usuario.

3. Parser por GDS
   - Cada GDS deve ter sua propria logica de leitura.
   - O parser deve transformar texto bruto em dados estruturados.

4. Modelo unico de cotacao
   - Depois do parser, todos os dados devem convergir para um modelo comum.
   - O modelo deve representar passageiros, itinerario, precos, impostos, bagagem, cambio e condicoes comerciais.

5. Regras comerciais
   - Regras como RC por passageiro, cambio, total do grupo, avisos e validacoes devem ficar em uma camada propria.

6. Renderizacao
   - A geracao do HTML/e-mail deve depender do modelo final, nao do texto bruto do GDS.

## Dados principais a extrair

### Passageiros

Extrair nomes e tipos:

- ADT
- CHD
- INF

Considerar formatos de nomes com titulo, marcadores de infantil e variacoes de exibicao entre Sabre e Amadeus.

### Itinerario

Extrair:

- Companhia aerea
- Numero do voo
- Classe/RBD
- Origem e destino
- Data de saida
- Hora de saida
- Data de chegada
- Hora de chegada
- Status do segmento
- Quantidade de passageiros quando disponivel
- Operado por/codeshare quando disponivel
- Equipamento quando disponivel

### Tarifamento

Extrair:

- Moeda da tarifa
- Valor da tarifa
- Equivalente em BRL
- Taxas
- Total
- Cambio IATA quando informado
- Bagagem por passageiro ou por trecho

### Condicoes comerciais

Manter campos editaveis para:

- Cabine
- Condicao
- RC
- Multa de reembolso
- Multa de remarcacao
- Assentos
- Open ticket
- LOC
- Formas de pagamento
- Link de pagamento quando aplicavel

## Base Sabre

O Sabre deve ser tratado como uma das bases principais do sistema.

A leitura deve considerar:

- Exibicao de PNR.
- Linhas de nomes e marcadores de passageiro.
- Segmentos com companhia, voo, classe, data, cidades, status e horarios.
- Status como HK, SS, NN, HL, TK, UC e similares.
- Tarifamento com comandos e retornos de cotacao.
- Valores em USD/BRL, taxas XT e totais.
- Bagagem em formatos como 02P, 01P, 0P e NIL.
- Informacoes complementares como operated by, record locator e remarks quando aparecerem.

## Base Amadeus

O Amadeus tambem deve ser tratado como base principal.

A leitura deve considerar:

- Exibicao de itinerario.
- Passageiros com INF inline ou em bloco separado.
- Segmentos com companhia, voo, classe, datas, cidades, status e horarios.
- ARNK/surface segment quando existir.
- Informacoes de operated by/codeshare.
- Tarifamento com FARE, EQUIV, TOTAL, GRAND TOTAL e cambio.
- Bagagem em PC/P/NIL.

## Expansao futura

O sistema deve permitir entrada futura de outros GDS ou fontes sem reescrever a calculadora inteira.

Para isso, novos GDS devem seguir o mesmo contrato:

- Detectar origem.
- Parsear texto bruto.
- Gerar dados estruturados.
- Alimentar o modelo unico de cotacao.
- Reaproveitar as mesmas regras comerciais e renderizacao final.

## Diretrizes de produto

- O sistema e interno, operacional e orientado a produtividade.
- A interface deve ser direta, clara e rapida para uso repetitivo.
- O usuario deve conseguir colar os dados, gerar previa, revisar e copiar o e-mail com poucos cliques.
- Campos vazios nao devem aparecer no e-mail final.
- O sistema deve mostrar avisos quando identificar dados incompletos ou inconsistentes.
- A leitura automatica deve ajudar, mas nunca impedir ajuste manual.

## Diretrizes de confiabilidade

- Nao assumir dados ausentes.
- Preservar valores originais sempre que houver duvida.
- Preferir sinalizar incerteza a calcular algo errado.
- Tratar cada tipo de passageiro separadamente.
- Separar total por passageiro de total do grupo.
- Manter rastreabilidade minima: GDS detectado, dados lidos e campos inferidos.

## Versao oficial inicial

A base oficial inicial do projeto local e o arquivo `index.html` sincronizado com o site publicado:

- Repositorio: `rafacilita/rextur-cotacao`
- Site oficial: `https://rafacilita.github.io/rextur-cotacao/`
- Uso: base para evolucao e futuro merge com a calculadora de reemissao estavel.

## Proximo foco recomendado

1. Criar uma suite de exemplos reais de Sabre e Amadeus.
2. Validar parser de passageiros, itinerario e tarifas contra esses exemplos.
3. Evoluir o parser Sabre para mais variacoes de PNR e tarifamento.
4. Evoluir o parser Amadeus sem quebrar os formatos ja suportados.
5. Separar testes e dados de exemplo para facilitar manutencao.

## Referencia critica de confiabilidade

Para evolucao do parser e das regras de leitura automatica, usar tambem o documento:

- `ANALISE_CRITICA_CONFIABILIDADE_GDS.md`

Esse documento define o criterio pratico de confiabilidade: o sistema deve automatizar tudo o que puder ler com seguranca, mas nunca deve inventar ou enviar dados ambiguos sem aviso e validacao do usuario.
