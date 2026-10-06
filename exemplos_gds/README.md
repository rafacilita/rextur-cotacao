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

## Portal NDC (eLATAM, e-GOL e similares)

Portais de reserva da companhia nao devolvem mascara de texto: a tela e HTML.
Por isso a calculadora tem uma fonte propria, escolhida no seletor "Fonte dos
dados", onde os valores sao transcritos da tela em campos estruturados.

O itinerario usa uma linha por voo:

```text
VOO CLASSE ORIGEM DESTINO DATA SAIDA CHEGADA[+N] [EQUIPAMENTO]
AZ675 W GRU FCO 10FEV27 1545 0705+1 339
ARNK
```

- `+N` marca chegada em dia posterior, que no portal aparece com o horario em
  vermelho;
- `ARNK` marca trecho terrestre, o que faz o open jaw ser tratado pela mesma
  logica de projecao aerea usada no Amadeus;
- os horarios do portal vem em 12 horas (`03:45p`) e sao convertidos para 24
  horas na leitura.

### O cambio da tela nao serve sempre ao RC

A taxa exibida no portal (`Rate used`) converte a MOEDA DA TARIFA para BRL. O RC
e sempre informado em USD, entao essa taxa so pode alimentar o cambio do RC
quando a tarifa-base tambem for em USD. Com tarifa em EUR ou THB o sistema
recusa a taxa e avisa que falta cambio, em vez de calcular o RC errado.

Exemplo coberto: `ndc_elatam_az_gru_fco_lhr_cdg_mux.txt`.

### Por que nao usamos OCR

Como a tela do portal e HTML, selecionar a tabela e copiar devolve texto de
verdade. Entao OCR nao e necessario para esse caso, e seria pior: um digito lido
errado numa tarifa e erro de cobranca, nao erro cosmetico. Quando houver um
copiar-colar real registrado na fixture, da para preencher a mascara
automaticamente sem nenhuma dependencia nova.

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
