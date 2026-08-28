# 🏍️ Capaxero Cloud — Backend, Telemetria IoT & Web Dashboard

> **Plataforma Centralizada de Gestão, Telemetria em Tempo Real e Pagamentos Cielo para a Rede de Totens de Higienização de Capacetes CapaXero.**

---

## 📋 Sumário
- [Visão Geral](#-visão-geral)
- [Arquitetura e Recursos](#-arquitetura-e-recursos)
- [Tecnologias Utilizadas](#-tecnologias-utilizadas)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [Pré-requisitos e Instalação](#-pré-requisitos-e-instalação)
- [Configuração de Ambiente (.env)](#-configuração-de-ambiente-env)
- [Como Executar](#-como-executar)
- [Túnel Público (Cloudflare Tunnel)](#-túnel-público-cloudflare-tunnel)
- [Documentação da API REST](#-documentação-da-api-rest)
- [WebSockets e Telemetria](#-websockets-e-telemetria)
- [Distribuição do APK Android](#-distribuição-do-apk-android)

---

## 🌟 Visão Geral

O **Capaxero Cloud** é o núcleo de controle da solução CapaXero. Ele conecta todos os totens físicos espalhados em campo com a central operacional, permitindo:
- Monitoramento em tempo real do status de cada máquina (nível de sanitizante, trava de porta, sensores e comunicação UART).
- Validação e resgate atômico de cupons promocionais e vouchers de cortesia online.
- Gateway de pagamentos unificado Cielo (Crédito, Débito e PIX).
- Envio de comandos remotos de manutenção (destravar porta, expurgo de sanitizante, reboot e parada de emergência).
- Dashboard web interativo com gráficos operacionais, mapa de estações e logs de auditoria.

---

## 🚀 Arquitetura e Recursos

### 1. 📊 Dashboard Web em Tempo Real
- **Monitoramento de Frota:** Status instantâneo (`ONLINE`, `OCUPADO`, `MANUTENCAO`, `OFFLINE`).
- **Nível de Insumos:** Alertas visuais de nível baixo do reservatório de sanitizante.
- **Gráficos e Indicadores:** Faturamento por período, modalidade de limpeza (Rápida / Completa / Ozônio) e volumetria de ciclos.
- **Simulador Interativo:** Ferramenta visual para testar fluxos de hardware, pagamentos e eventos sem totem físico conectado (`/simulador.html`).

### 2. 🎟️ Gestão Inteligente de Cupons & Vouchers
- Cadastro de códigos promocionais com descontos percentuais (ex: 20%, 50%, 100% Gratuidade).
- Restrição por máquina/totem específico ou uso global em toda a rede.
- Limite de utilizações individuais e controle atômico contra uso duplicado.
- Sincronização em tempo real com os aplicativos Android embarcados.

### 3. 💳 Motor de Pagamentos Cielo
- **Cielo Conecta / Pinpad PPC930:** Processamento presencial de cartões de débito, crédito e aproximação (NFC).
- **Cielo E-Commerce / PIX Dinâmico:** Geração de QR Code instantâneo com confirmação ativa via Webhook.

### 4. 📡 WebSockets Bidirecionais (`/ws`)
- Canal direto e persistente entre o servidor e os totens Android.
- Notificações de pagamentos aprovados, cancelamentos e alterações remotas de configuração (preços, tempos de ciclo e URLs de telemetria).

---

## 🛠️ Tecnologias Utilizadas

- **Runtime:** [Node.js](https://nodejs.org/) (v18+ LTS)
- **Framework Web:** [Express.js](https://expressjs.com/)
- **Comunicação em Tempo Real:** [ws (WebSocket)](https://github.com/websockets/ws)
- **Geração de Códigos:** `qrcode`
- **Upload de Mídias/Manuais:** `multer`
- **Segurança & CORS:** `cors`, tokens de autenticação Bearer e validação de Webhooks

---

## 📂 Estrutura do Projeto

```text
capaxero_cloud/
├── config/
│   └── cielo_conecta.js        # Configurações da API Cielo Conecta / Pinpad
├── data/
│   ├── capaxero_database.json  # Banco de dados persistente JSON (Totens, Transações, Cupons)
│   └── totem_live_logs.txt     # Log histórico de telemetria e eventos de hardware
├── middleware/
│   └── auth.js                 # Middleware de proteção de rotas administrativas e tokens
├── public/
│   ├── app-debug.apk           # APK Android compilado para download direto nos totens
│   ├── css/
│   │   └── style.css           # Folha de estilos moderna do Dashboard
│   ├── js/
│   │   ├── api-docs.js         # Documentação interativa de endpoints
│   │   ├── app.js              # Lógica principal do Dashboard Web
│   │   └── simulator.js        # Motor do simulador de totem virtual
│   ├── index.html              # Interface do Dashboard de Gestão
│   └── simulador.html          # Interface do Simulador de Totens
├── routes/
│   ├── admin.js                # Rotas administrativas (Ações de hardware, configuração de totens)
│   ├── api.js                  # Endpoints REST públicos consumidos pelo APK Android
│   ├── auth.js                 # Autenticação de operadores e painel web
│   ├── cielo.js                # Endpoints e Webhooks de integração Cielo / PIX
│   └── upus_compat.js          # Camada de compatibilidade de legado IoT
├── services/
│   ├── cieloConecta.js         # Serviço de comunicação com APIs da Cielo
│   ├── database.js             # Gerenciador de persistência de dados
│   ├── store.js                # Armazenamento em memória para alta performance
│   └── websocket.js            # Hub WebSocket para conexões do dashboard e dos totens
├── .env.example                # Template de variáveis de ambiente
├── .gitignore                  # Arquivos e pastas ignorados no controle de versão
├── package.json                # Dependências e scripts do projeto
├── server.js                   # Ponto de entrada (Entrypoint) do servidor Express + WS
└── README.md                   # Documentação do projeto
```

---

## ⚙️ Pré-requisitos e Instalação

1. **Instale o Node.js** (versão 18 ou superior):
   [Download Node.js](https://nodejs.org/)

2. **Clone o repositório:**
   ```bash
   git clone https://github.com/keikorr/capa_cloud.git
   cd capa_cloud
   ```

3. **Instale as dependências:**
   ```bash
   npm install
   ```

---

## 🔐 Configuração de Ambiente (.env)

Crie um arquivo `.env` na raiz do projeto baseado no `.env.example`:

```bash
cp .env.example .env
```

Preencha as variáveis conforme seu ambiente:

```env
# Porta do Servidor
PORT=3000

# Integração Cielo Conecta (Pinpad PPC930 / Cartão Presencial)
CIELO_ENVIRONMENT=Producao
CIELO_AUTH_URL=https://authsandbox.cieloecommerce.cielo.com.br/oauth2/token
CIELO_BASE_URL=https://apisandbox.cieloecommerce.cielo.com.br
CIELO_INIT_URL=https://parametersdownloadsandbox.cieloecommerce.cielo.com.br/api/v0.1/initialization
CIELO_CLIENT_ID=seu_client_id_aqui
CIELO_CLIENT_SECRET=seu_client_secret_aqui
CIELO_SUBORDINATED_MERCHANT_ID=seu_merchant_id_aqui
CIELO_TERMINAL_ID=00000001

# Licença Gertec PPCONECTA
CIELO_PINPAD_LICENSE=sua_licenca_gertec
CIELO_PINPAD_COMPANY=capaxero
CIELO_PINPAD_COMM=USB
CIELO_CARD_TIMEOUT_SECONDS=90

# Cielo E-Commerce (PIX)
CIELO_MERCHANT_ID=seu_merchant_id_ecommerce
CIELO_MERCHANT_KEY=sua_merchant_key_ecommerce

# Segurança e Tokens
CAPAXERO_ADMIN_TOKEN=seu_token_admin_secreto
CAPAXERO_WEBHOOK_TOKEN=seu_token_webhook_secreto
```

---

## 🚀 Como Executar

### Modo Produção:
```bash
npm start
```

### Modo Desenvolvimento (com hot-reload automático):
```bash
npm run dev
```

O servidor iniciará em:  
👉 `http://localhost:3000`

---

## 🌐 Túnel Público (Cloudflare Tunnel)

Para conectar totens operando em redes externas (4G/LTE ou Wi-Fi externo) sem necessidade de IP fixo ou abertura de portas no roteador, utilize o executável do Cloudflare Tunnel:

```powershell
.\cloudflared.exe tunnel --protocol http2 --url http://localhost:3000
```

Copie a URL segura gerada (ex: `https://xxxx.trycloudflare.com`) e insira no Painel do Operador do APK Android.

---

## 📡 Documentação da API REST

A base dos endpoints REST é `/api/v1`.

### 1. Saúde do Servidor
* `GET /api/v1/health`  
  Retorna o status operacional do backend e a quantidade de totens conectados.

### 2. Cupons & Vouchers
* `GET /api/v1/coupons`  
  Retorna a lista completa de cupons ativos cadastrados no sistema.
* `GET /api/v1/coupons/:code?totemId=TOTEM-01`  
  Valida o cupom para o totem solicitante, retornando percentual de desconto e regras de modalidade.
* `POST /api/v1/coupons/:code/redeem`  
  Registra a utilização/baixa atômica do cupom.
* `POST /api/v1/coupons/reset-test`  
  Reseta os contadores de uso dos cupons de teste.

### 3. Telemetria dos Totens
* `POST /api/v1/telemetry/heartbeat`  
  Recebe o heartbeat periódico do totem (sensores, status de porta, nível de sanitizante e contadores).
* `POST /api/v1/telemetry/events`  
  Registra eventos de ciclos iniciados, concluídos ou interrupções de emergência.
* `POST /api/v1/telemetry/transactions`  
  Sincroniza transações de pagamento efetuadas localmente.

### 4. Configuração Remota de Totens
* `GET /api/v1/totems/:totemId/config`  
  Retorna os preços, tempos de higienização e parâmetros operacionais atualizados para o totem.
* `PUT /api/v1/totems/:totemId/config`  
  Atualiza remotamente a tabela de preços e parâmetros do totem.

### 5. Ações Administrativas de Manutenção
* `POST /api/v1/admin/totems/:totemId/action`  
  Executa comandos remotos imediatos no totem via WebSocket:
  * `DOOR_UNLOCK` — Pulso para destravar a solenoide de porta (`0xE2`).
  * `DUCT_CLEAN` — Ciclo de expurgo e limpeza dos dutos de sanitizante.
  * `EMERGENCY_STOP` — Corte imediato de atuadores.
  * `REBOOT` — Reinicialização do totem.

### 6. Pagamentos Cielo & PIX
* `POST /api/v1/payment/cielo/pix/create`  
  Gera cobrança PIX com QR Code dinâmico.
* `POST /api/v1/payment/cielo/webhook`  
  Recebe a notificação instantânea de liquidação de pagamento enviada pela Cielo.

---

## 🔌 WebSockets

- **URL de Conexão:** `ws://localhost:3000/ws` (ou `wss://dominio-cloudflare/ws`)
- **Parâmetros de Conexão para Totens:**
  ```text
  /ws?clientType=totem&devno=TOTEM-CPX-001
  ```
- **Parâmetros para o Dashboard:**
  ```text
  /ws?clientType=dashboard
  ```

---

## 📱 Distribuição do APK Android

O arquivo compilado do aplicativo Android embarcado fica hospedado em:
```text
https://seu-dominio-cloud/app-debug.apk
```
Isso permite aos operadores de campo baixar e atualizar o aplicativo nos totens diretamente pelo navegador do tablet/Android.

---

## 📄 Licença

Propriedade exclusiva de **CapaXero Tecnologia em Higienização**. Todos os direitos reservados.
