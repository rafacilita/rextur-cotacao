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

## Sabre: franquia diferente por segmento, sem linha BAG ALLOWANCE

`sabre_bagagem_por_segmento_am_4trechos.txt` e o contraponto do caso direcional
acima. Aqui o PQ trata CADA trecho como seu proprio componente tarifario: ha
quatro linhas numeradas e cada uma ja carrega seu proprio codigo de bagagem
(`NIL`, `NIL`, `02P`, `01P`). Nao existe nenhuma linha `BAG ALLOWANCE`.

Este caso ja era lido corretamente pela leitura simples por linha numerada, que
existia antes da correcao direcional. A fixture serve para travar isso: a
correcao direcional so ativa com 2 ou mais linhas `BAG ALLOWANCE` distintas, e
nao pode interferir neste padrao mais simples.

## ADT, CHD e INF com franquia propria (Sabre e Amadeus)

`sabre_adt_chd_inf_bagagem_distinta_am.txt` e
`amadeus_adt_chd_inf_bagagem_distinta_am.txt` sao o mesmo bilhete GRU-MEX-GDL-MEX-GRU
pela AM, relatado por um usuario com o alerta: a franquia do INF e DIFERENTE da do
ADT e do CHD (ADT/CHD: Sem Bag/Sem Bag/2PC/1PC; INF: 1PC/Sem Bag/Sem Bag/1PC). O
exemplo expos dois defeitos reais, nenhum deles na leitura de bagagem em si.

### Secao WP*BAG vazava para o ultimo PQ do retorno combinado

O retorno Sabre combinado (`WPP1ADT/1CNN/1INF` + tres blocos `PQ`) as vezes traz, depois
do ultimo `PQ`, uma secao `WP«`/`WP*BAG«` com franquia por passageiro numerado (ex.:
`ADT-02`), de estrutura diferente da do `PQ`. `splitSabrePricingMasks` cortava os
blocos `PQ` so pelo inicio do PQ seguinte, e usava o fim literal do texto como limite
do ULTIMO bloco — neste exemplo, o `PQ 3 PINF`. A secao `WP*BAG` (que na verdade e do
ADT) ficava colada dentro da mascara do INF.

Isso por si so nao seria grave, mas a correcao de franquia direcional (ver secao
acima) encontrou ali 4 linhas `BAG ALLOWANCE`, uma por trecho fisico, e — por nao ter
como saber que vieram de outro passageiro — aplicou-as com confianca sobre o INF,
sobrescrevendo a leitura correta pela errada.

A correcao limita o ultimo `PQ` a parar antes de `WP«`/`WP*BAG«`, quando essa secao
existir. A secao continua nao sendo lida (nenhum passageiro e identificado com
confianca a partir dela), mas tambem deixa de contaminar o passageiro errado.

### PQ duplicado por paginacao inflava `bagSegs` e citava trechos fantasmas

O retorno real trazia o `PQ 3 PINF` inteiro duplicado (quebra de pagina do terminal
gerando `MD«` + repeticao). Isso fazia `bagSegs` do INF sair com 8 posicoes em vez de
4. O e-mail ja truncava corretamente na hora de montar a tabela, mas o aviso de
"trecho sem bagagem" nao truncava, e citava `trecho 6`, `trecho 7` — trechos que nao
existem no itinerario de 4 voos.

A correcao trunca `bagSegs` de cada tipo para o numero real de trechos aereos uma
unica vez, logo depois do parse, antes de qualquer logica consumir o array. Isso
corrige o aviso sem precisar de logica nova nele, e vale tambem se o mesmo tipo de
duplicacao aparecer em ADT ou CHD no futuro.

## Cabine inferida pela classe de reserva (RBD)

O campo Cabine (Economica/Executiva/Primeira Classe/Premium Economy) era 100% manual.
A letra de classe de reserva (RBD) que ja vem em cada linha de segmento do GDS — e que
o parser ja extraia no campo `.rbd`, sem usar para nada — e o sinal correto para
sugerir a cabine, bem mais confiavel do que o nome da familia tarifaria (`BASICA`,
`PREMIERONB` etc. sao marca comercial, nao cabine).

A tabela `CABINE_POR_RBD` (dentro do index.html) e deliberadamente conservadora: so
mapeia letras com alta confianca entre companhias. Letras ambiguas (`W`, `E`, `O`, `R`,
`X` e qualquer letra fora da tabela) ficam de fora e nunca entram no palpite.
"Premium Economy" nunca e inferida — nao ha letra confiavel o bastante entre
companhias para esse nivel ainda.

### "I" e Executiva, confirmado pelo operador

`sabre_adt_chd_inf_bagagem_distinta_am.txt` (ver secao acima) usa RBD `V` nos trechos
GRU-MEX/MEX-GDL e `I` nos trechos GDL-MEX/MEX-GRU. A primeira versao desta tabela
deixou `I` de fora, assumindo (errado) que o "Cabine: Economica" visto na tela desse
bilhete era a verdade do GDS — mas esse campo ainda era 100% manual nessa epoca, era
so o valor padrao, nunca confirmado. O operador confirmou diretamente que `I`
geralmente E executiva, e a tabela foi corrigida.

Com a correcao, esse mesmo exemplo passa a acender o aviso de **cabine mista** (`V` na
ida, `I` na volta sao confiaveis e discordam), em vez de inferir Economica sozinho — o
que é o comportamento certo quando as classes realmente divergem entre os trechos.

### Autopreenchimento e aviso, nunca bloqueio

Quando todos os trechos aereos do itinerario concordam numa cabine confiavel, o campo
`#fldCabine` e preenchido automaticamente e o motor empurra um aviso no painel de
confiabilidade ("Cabine (Economica) inferida automaticamente pela classe de reserva
(RBD) do GDS. Confirme antes de enviar."), que baixa a pilula de confianca mas NUNCA
bloqueia copiar ou gerar o e-mail — mesma filosofia ja usada para bagagem, status de
segmento e equipamento desconhecido. O texto do e-mail ao cliente continua limpo, sem
nenhum aviso: a confirmacao e so para o operador, antes de enviar.

Assim que o operador edita o campo manualmente, o sistema para de sobrescrever (campo
`dataset.source`, igual ao padrao ja usado no campo de cambio BCB) e o aviso de
inferencia desaparece. O botao "Limpar" reseta essa trava, permitindo nova inferencia
na proxima colagem.

Quando o itinerario tem RBDs confiaveis discordando entre ida e volta (cabine mista),
o campo nao e tocado e um aviso proprio avisa que o campo so aceita um valor.

### Refinar por companhia exige evidencia do GDS

A tabela usa convencao IATA ampla, nao uma tabela por companhia. Para refinar uma letra
especifica de uma companhia (como aconteceu com `32B`/`CR9` em equipamento), a fonte
certa e a tela de disponibilidade do proprio GDS (Sabre `1` / Amadeus `AN`), que mostra
a RBD ja agrupada por cabine para aquele voo especifico, ou o portal de agente da
companhia (igual a matriz de brands da LATAM referenciada mais abaixo). Entra conforme
casos reais aparecerem, nunca especulativamente.

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

### Formato digito-letra-digito (variantes do 737 MAX)

`7M8` e `7M9` (vistos em `amadeus_adt_chd_inf_bagagem_distinta_am`) nao se encaixavam
em nenhum dos formatos acima e eram perdidos por completo (`equipment=null`), nao so
sem traducao de nome. A deteccao agora aceita o formato `\d[A-Z]\d`. Os dois codigos
aparecem crus no e-mail (`Equip. 7M8` / `Equip. 7M9`) ate serem confirmados pelo GDS,
seguindo a mesma politica do `32B`/`CR9`.

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
