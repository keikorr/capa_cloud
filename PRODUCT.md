# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Inferido do produto existente:** operadores e gestores da rede Capaxero que acompanham máquinas, vendas, estoque, alertas e manutenção durante o trabalho diário.
- **Inferido dos papéis existentes:** administradores da rede e donos de máquinas ou franquias com acesso limitado aos próprios ativos.

## Product Purpose

A Capaxero Cloud centraliza telemetria, operação, faturamento, histórico de ciclos, estoque de sanitizante, manutenção, locais, proprietários e cupons da rede de totens. Sucesso significa permitir que o usuário entenda rapidamente o estado real da operação e aja sem perder contexto.

## Positioning

O produto reúne no mesmo painel os dados comerciais e a telemetria física de máquinas de higienização de capacetes, incluindo leitura do reservatório, ciclos, conexão, pagamentos e ações remotas.

## Operating Context

- Monitoramento recorrente de máquinas distribuídas em diferentes pontos.
- Investigação de vendas, ciclos, estoque, falhas e disponibilidade.
- Gestão administrativa de locais, donos, cupons, configurações e manutenção.
- Uso predominante em desktop, com suporte responsivo para consultas em telas menores.

## Capabilities and Constraints

- Preservar os fluxos, permissões, dados reais, rotas e integrações existentes.
- Dados financeiros e de telemetria não podem ser inventados para preencher estados vazios.
- O estoque exibe somente percentual real, estado binário do sensor ou ausência de leitura.
- O painel recebe atualizações por WebSocket e permite consultas manuais ao servidor.
- A implementação atual usa HTML, CSS e JavaScript sem framework no frontend.

## Brand Commitments

- **Confirmado pelo produto:** nome Capaxero Cloud e logotipo existente.
- **Inferido do pedido e da referência:** manter reconhecimento da paleta preta, amarela e verde, elevada para uma apresentação mais premium, futurista e chamativa.
- **Confirmado pelo pedido:** a referência visual do Pinterest orienta profundidade, composição escura, hierarquia editorial e detalhes dourados, sem copiar o tema de xadrez.

## Evidence on Hand

- Logotipo e ativos existentes em `public/assets` e `public/images`.
- Dados, estados, fluxos e textos funcionais presentes em `public/index.html` e `public/js/app.js`.
- Referência visual fornecida: `https://br.pinterest.com/pin/599119556726527941/`.
- Não há depoimentos, métricas promocionais ou alegações comerciais autorizadas; futuras telas não devem fabricá-los.

## Product Principles

1. A verdade operacional deve ser visível antes do ornamento.
2. Cada ação importante precisa permanecer rápida e previsível.
3. A identidade deve comunicar tecnologia física, precisão e confiança.
4. Estados vazios, offline e sem telemetria devem ser honestos e legíveis.
5. O sistema visual deve funcionar da visão geral ao detalhe de uma máquina.

## Open Decisions

- **Inferido nesta sessão:** foco principal em operadores e gestores.
- **Inferido nesta sessão:** preservar logo e cores centrais da marca.
- **Inferido nesta sessão:** fluxo de trabalho direto no código.
