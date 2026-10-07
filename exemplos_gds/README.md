# Exemplos GDS para testes da calculadora

Use esta pasta para salvar exemplos reais anonimizados de Sabre e Amadeus.

Esses exemplos servirao como base para evoluir o parser com seguranca. A ideia e comparar o que o sistema le automaticamente com o que deveria ler.

## Moedas tarifarias

O parser deve preservar o codigo ISO de tres letras informado pelo GDS. Exemplos ja cobertos:

- USD, EUR, CNY e THB
- GBP, JPY, AUD, CAD, CHF e AED

O equivalente, as taxas e o total continuam em BRL quando assim informados pelo GDS. O `RATE USED` de outra moeda, como CNY ou JPY, nao deve ser usado como cambio do RC, que e sempre informado em USD. O mesmo vale para o `BSR` de uma mascara em THB.

### A moeda nao se deduz da origem

Nao existe regra de origem que determine a moeda da tarifa, e tentar inferir
seria errado. Dois casos reais que se contradizem:

- saindo de BKK, a tarifa sai em THB, acompanhando o pais de emissao;
- saindo do Brasil, as tarifas internacionais costumam sair em USD, e nao em BRL.

Entao a unica fonte confiavel e o codigo ISO que o proprio GDS imprime na
mascara. O parser nao mantem lista de moedas aceitas: qualquer codigo de tres
letras e lido e formatado, inclusive moedas sem centavos como JPY.

O que o sistema garante no lugar de adivinhar: quando os valores em BRL sao
lidos mas a moeda da tarifa nao, isso gera aviso na tela. Antes a cotacao seguia
para a agencia com a coluna de tarifa em branco, sem ninguem perceber. Se uma
mascara nova chegar num formato desconhecido, a falha aparece em vez de passar.

Formatos de linha de tarifa ja suportados no Amadeus:

```text
FARE     USD     500.00      <- classico
FARE  F THB      42535       <- com indicador de tipo entre FARE e a moeda
```

## Sabre: colagem combinada

O campo principal aceita itinerario, comando WPP e varios PQs no mesmo texto. O sistema:

- le quantidades como `1ADT/1CNN/1INF`;
- separa blocos `ADT`, `CNN/CHD` e `INF`;
- preenche os campos individuais para revisao;
- avisa quando um tipo foi declarado no comando, mas seu PQ nao aparece no conteudo;
- aceita tarifa zero, como `JPY0 BRL0.00 BRL0.00INF`.

Tambem sao aceitos:

- itinerario visual em duas linhas, com cidades e horarios;
- outros codigos de taxa no resumo do PQ, como `YQ`;
- paginacao que deixa o cabecalho do PQ em uma tela e a linha de valores apos `MD`.

## Amadeus: colagem combinada

O mesmo campo aceita itinerario seguido de varios retornos `FQQ`. O sistema usa o cabecalho de cada bloco para separar:

- ADT quando nao ha marcador de desconto;
- CHD quando o cabecalho informa `CH`;
- INF quando o cabecalho informa `IN`.

Linhas de navegacao como `PAGE`, `fqq02` e `fqq03` podem permanecer no texto colado.

O marcador pode aparecer em cabecalho longo (`* * CH`) ou curto (`* CH`). Franquias numericas na coluna BG, como `20` e `10`, sao tratadas como `20KG` e `10KG`.

## Amadeus: ARNK e alinhamento da bagagem

`amadeus_arnk_surface_bio.txt` existe para fixar um ponto que ja causou erro no e-mail.

A coluna BG da mascara traz uma franquia por trecho **aereo**. O itinerario, porem, pode
ter uma linha `ARNK` de trecho terrestre, que ocupa posicao mas nao e voo. Se a leitura
indexar a bagagem pela posicao do itinerario, todos os trechos depois do `ARNK` recebem a
franquia do trecho anterior.

Nesse exemplo o trecho `BIO-MAD` e `NIL` no GDS. Com o desalinhamento, o e-mail exibia
`1PC` e prometia a agencia uma bagagem que a companhia nao concedeu, alem de perder o
destaque vermelho de "Sem Bag".

O mesmo desalinhamento afetava a rota (`GRU-MAD-VLC // --MAD-GRU`, com o `ARNK` virando
`--`) e o aviso de trecho sem bagagem, que citava "trecho 3" em vez de `BIO-MAD`.

Ao mexer em bagagem, rota ou itinerario, rode este exemplo.

## Sabre: franquia direcional, por componente tarifario

`sabre_bag_allowance_direcional_aa.txt` existe por causa de um defeito real relatado
por um usuario: a franquia saia `2PC` nos tres trechos de uma rota GRU-MIA-JFK-GRU,
quando a correta era `1PC` na ida e `2PC` na volta.

O PQ do Sabre pode declarar a franquia por COMPONENTE TARIFARIO, nao por trecho fisico:

```text
BAG ALLOWANCE     -GRUJFK-01P/AA/...
BAG ALLOWANCE     -JFKGRU-02P/AA/...
```

`GRUJFK` cobre o componente de ida inteiro (GRU-MIA e MIA-JFK, ainda que sejam dois
voos); `JFKGRU` cobre so o trecho de volta. A leitura por linha de segmento numerada
so encontra franquia no ULTIMO trecho de cada componente, porque e so ali que a linha
numerada carrega o codigo. Quando o PQ nao lista as linhas numeradas de todos os
trechos (comum quando o PQ mostra so o componente de retorno), a leitura por linha
falhava e o valor do ultimo trecho era repetido para os anteriores.

A correcao distribui cada franquia direcional pelos trechos aereos reais do
itinerario, caminhando pela cadeia origem/destino até encontrar o destino de cada
componente. Se a cadeia nao bater com confianca — origem diferente do esperado,
destino nunca alcancado, trecho sobrando — a funcao devolve `null` e a leitura
anterior permanece, com o aviso generico de bagagem continuando a valer. Nunca
adivinha qual trecho fica com qual franquia.

### Armadilhas que o texto real contem

Tres trechos parecem franquia e nao sao, todos presentes neste exemplo:

- `CARRY ON ALLOWANCE` seguido de `GRUMIA MIAJFK JFKGRU-02P/AA`: bagagem de MAO,
  nao despachada;
- `2NDCHECKED BAG FEE-GRUJFK-BRL496.98/AA/...`: tarifa da bagagem extra, nao
  franquia inclusa;
- `GRUMIA JFKGRU-AA` seguido de restricoes de animais e peso: nao traz franquia.

A deteccao exige o rotulo exato `BAG ALLOWANCE` no inicio da linha, o que já
exclui as tres armadilhas.

## Equipamento da aeronave

O codigo IATA de equipamento tem tres caracteres e NAO e so numerico. A tabela
em `EQUIPAMENTO` (dentro do index.html) traduz o codigo para nome legivel, que
e o que aparece no e-mail da agencia.

Formatos validos, todos cobertos pela deteccao:

```text
359   tres digitos           Airbus A350-900
32N   dois digitos + letra   Airbus A320neo
E90   letra + dois digitos   Embraer 190
CR9   duas letras + digito   (nao esta na tabela, aparece cru)
CRJ   tres letras            Bombardier CRJ
```

A deteccao anterior exigia digitos puros e por isso perdia 12 dos 29 codigos
oficiais, incluindo toda a familia neo e os Embraer. Medicao nos exemplos deste
projeto, antes e depois da correcao:

```text
amadeus_arnk_surface_bio     3/4  ->  4/4   (perdia CR9)
amadeus_fqq_combinado_eur    2/4  ->  4/4   (perdia 32B, duas vezes)
```

### Codigo de tres letras exige estar na tabela

Padroes que contem digito sao inequivocos na posicao em que aparecem na linha.
Codigo so com letras e aceito apenas se estiver na tabela, senao seria
confundido com codigo de refeicao, de servico e outros tokens de tres letras.

Ha tambem um cuidado com estado de segmento: `HK1` e `CR9` tem o mesmo formato,
duas letras e um digito. A lista `ESTADOS_DE_SEGMENTO` evita a confusao caso a
ordem dos campos na linha varie.

### Codigo desconhecido nao e inventado

Codigo fora da tabela aparece cru no e-mail, prefixado por `Equip.`, para a
agencia saber que e codigo e nao nome de aviao. Dois codigos surgiram nos
exemplos deste projeto e ainda nao estao na tabela oficial:

- `32B`, visto em `amadeus_fqq_combinado_eur`
- `CR9`, visto em `amadeus_arnk_surface_bio`

Para incluir, basta acrescentar a entrada em `EQUIPAMENTO`.

### Sabre nao traz equipamento

Os exemplos Sabre deste projeto nao tem campo de equipamento: as linhas terminam
em `/DCLA /E`. Entao nao ler equipamento no Sabre e leitura correta, nao falha.
Se aparecer um retorno Sabre que exiba equipamento, vale registrar como exemplo
novo antes de mexer no parser.

## Como anonimizar

Antes de salvar qualquer exemplo:

- Troque nomes reais por nomes ficticios.
- Troque telefones por numeros ficticios.
- Troque e-mails por `teste@example.com`.
- Troque localizadores reais por `ABC123`, `XYZ789` ou similar.
- Remova documentos, datas de nascimento reais e qualquer informacao sensivel.
- Mantenha o formato original do GDS sempre que possivel.

## Como preencher cada arquivo

Cada arquivo tem secoes:

- `BLOCO GDS`: cole o texto bruto copiado do Sabre ou Amadeus.
- `RESULTADO ESPERADO`: escreva manualmente o que a calculadora deveria identificar.
- `OBSERVACOES`: registre qualquer detalhe importante, por exemplo code-share, bagagem ausente, status nao confirmado ou tarifa informativa.

## Importante

Nao precisa preencher tudo de uma vez. Comece com 1 exemplo Sabre e 1 exemplo Amadeus que sejam comuns na rotina.

Quanto mais real o formato do texto colado, melhor sera o teste.

## Executar os smoke tests

Abra `parser-tests.html` usando o Live Server do VS Code.

A pagina executa verificacoes automaticas usando as funcoes reais da calculadora, incluindo:

- deteccao de Sabre e Amadeus;
- leitura de segmentos;
- passageiros ADT/CHD/INF;
- valores e bagagem;
- validacoes obrigatorias;
- salvamento e restauracao do rascunho local.

O resultado esperado e `9/9 testes` e `Tudo certo`.

## Executar os testes com Node

Na pasta do projeto:

```powershell
npm.cmd install
npm.cmd test
```

Use `npm.cmd` no PowerShell quando a politica de execucao do Windows bloquear o arquivo `npm.ps1`.

Para acompanhar alteracoes no parser continuamente:

```powershell
npm.cmd run test:watch
```

## Referencias operacionais

Algumas informacoes do GDS dependem de regra comercial atualizada da companhia. Quando o exemplo envolver familia tarifaria/brand, registre tambem a fonte operacional usada para validar os atributos.

- LATAM internacional/regional: consultar a matriz oficial de atributos de brands no LATAM Trade:
  `https://www.latamtrade.com/pt_br/procom/tarifas-pt-2/atributos-brands-regionais`

Para o parser, a familia tarifaria lida no GDS, por exemplo `FARE FAMILY`, `BRANDED FARE` ou sufixos/codigos como `SL`, deve ser tratada como identificador da familia. Beneficios como bagagem, assento, remarcacao ou reembolso devem vir preferencialmente das linhas explicitas do GDS e/ou da matriz oficial vigente da companhia, nao de uma suposicao fixa no codigo.

## Preciso descrever o que ele deve ler?

Sim, sempre que possivel.

O bloco GDS mostra o texto bruto. O `RESULTADO ESPERADO` mostra a verdade operacional: aquilo que a calculadora deve interpretar.

Essa descricao e muito importante porque alguns retornos do GDS tem linhas ambiguas, telas quebradas por `MD`, tarifa em mais de uma pagina, linha `VOID`, code-share, surface/open jaw ou status diferente de confirmado.

Quando voce nao tiver certeza, preencha mesmo assim e marque em `OBSERVACOES` que precisa de revisao.

## Sabre: preencher WP e PQ separados

Quando o exemplo for Sabre com tarifamento, sempre que possivel envie dois blocos separados:

- `WP`: retorno da cotacao/preco consolidado.
- `PQ`: retorno da Price Quote armazenada/detalhada.

Motivo:

- O `WP` pode trazer familia tarifaria em `BRANDED FARE`, cambio em `RATE USED` e total geral.
- O `PQ` pode trazer fare basis, detalhe por passageiro, prazo de compra e bagagem textual como `01P`, `02P`, `0P` ou `NIL`.
- Em alguns casos a bagagem aparece no `WP` apenas por icone visual de mala. Esse icone ajuda o consultor, mas nao deve ser usado sozinho pelo parser para definir quantidade.

Modelo recomendado:

```text
## WP
cole aqui o retorno WP

## PQ ADT
cole aqui o PQ do adulto, se houver

## PQ CHD/CNN
cole aqui o PQ da crianca, se houver

## PQ INF
cole aqui o PQ do infantil, se houver
```

Se tiver apenas um dos dois, pode enviar mesmo assim. Marque em `OBSERVACOES` se falta WP ou PQ.
