# Exemplos GDS para testes da calculadora

Use esta pasta para salvar exemplos reais anonimizados de Sabre e Amadeus.

Esses exemplos servirao como base para evoluir o parser com seguranca. A ideia e comparar o que o sistema le automaticamente com o que deveria ler.

## Moedas tarifarias

O parser deve preservar o codigo ISO de tres letras informado pelo GDS. Exemplos ja cobertos:

- USD, EUR e CNY
- GBP, JPY, AUD, CAD, CHF e AED

O equivalente, as taxas e o total continuam em BRL quando assim informados pelo GDS. O `RATE USED` de outra moeda, como CNY ou JPY, nao deve ser usado como cambio do RC, que e sempre informado em USD.

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
