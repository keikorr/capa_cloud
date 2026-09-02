/**
 * Capaxero Cloud — Visualizador de Documentação e Endpoints REST
 * Suporta tanto as especificações modernas V1 quanto a camada de compatibilidade UPUS IoT.
 */

const API_SPECS = [
  // --- CAPAXERO V1 NATIVE ---
  {
    title: "1. Autenticação do Totem (Capaxero V1)",
    method: "POST",
    typeBadge: "post",
    endpoint: "/api/v1/totem/login",
    desc: "Chamado pelo totem Android no boot para validar o número de série e receber o token de sessão.",
    requestExample: {
      devno: "CPX-001",
      appVersion: "v3.3.0",
      macAddress: "B8:27:EB:12:34:56"
    },
    responseExample: {
      code: 0,
      success: true,
      message: "Totem autenticado com sucesso.",
      data: {
        devno: "CPX-001",
        token: "CPX_AUTH_TOKEN_Q1BYLTAwMQ==",
        config: { basicPrice: 13.0, intermediatePrice: 17.0, advancedPrice: 20.0 }
      }
    }
  },
  {
    title: "2. Webhook de Pagamento Cielo (Cartão NFC / PIX)",
    method: "POST",
    typeBadge: "post",
    endpoint: "/api/v1/payment/cielo/webhook",
    desc: "Callback acionado pelo Terminal Cielo ao aprovar uma transação por aproximação (NFC), chip ou PIX.",
    requestExample: {
      orderId: "ORD-84920",
      devno: "CPX-001",
      mode: "INTERMEDIARIA",
      amount: 17.00,
      paymentMethod: "CIELO_CREDITO_NFC",
      cardBrand: "Mastercard NFC",
      status: "APPROVED",
      nsu: "849201948",
      authCode: "049281"
    },
    responseExample: {
      code: 0,
      success: true,
      message: "Pagamento processado com sucesso. Porta liberada.",
      data: { orderId: "ORD-84920", status: "APPROVED", nsu: "849201948" }
    }
  },
  {
    title: "3. Telemetria e Sensores (Heartbeat)",
    method: "POST",
    typeBadge: "post",
    endpoint: "/api/v1/totem/heartbeat",
    desc: "Disparado a cada 60s ou quando sensores mudarem de valor (trava da porta, nível de fluido). A máquina não tem sensor de temperatura nem de fragrância.",
    requestExample: {
      devno: "CPX-001",
      status: "CLEANING",
      doorLocked: true,
      liquidLevelPercent: 78
    },
    responseExample: {
      code: 0,
      success: true,
      message: "Heartbeat registrado."
    }
  },

  // --- UPUS IOT COMPATIBILITY LAYER ---
  {
    title: "4. Login de Operadores / Web (UPUS IoT Legacy)",
    method: "POST",
    typeBadge: "legacy",
    endpoint: "/upus_APP/app/Register/login1",
    desc: "Endpoint padrão de login da plataforma UPUS IoT com suporte a companyNo, userName e userPwd.",
    requestExample: {
      companyNo: "spost",
      userName: "A0629",
      userPwd: "123456",
      userType: 1
    },
    responseExample: {
      code: 0,
      msg: "Login realizado com sucesso.",
      data: {
        compno: "87550094",
        logno: "A0629",
        cocode: "SPOST",
        langkind: 2,
        branno: "BR-01",
        corpno: "CORP-01",
        usertype: 1
      }
    }
  },
  {
    title: "5. Login do Totem Original (UPUS devlogin)",
    method: "POST",
    typeBadge: "legacy",
    endpoint: "/upus_APP/app/expressbox/devlogin",
    desc: "Utilizado pelo firmware chinês original para registro do totem pelo número de série.",
    requestExample: {
      devno: "CPX-001",
      appVersion: "v3.2.7",
      devkind: 1
    },
    responseExample: {
      code: 0,
      msg: "Dispositivo conectado e autenticado.",
      data: {
        devno: "CPX-001",
        devna: "Totem #01 — Shopping Central",
        compno: "87550094",
        cocode: "SPOST",
        branno: "BR-01"
      }
    }
  },
  {
    title: "6. Configurações de Tempos UPUS (devnoinfo)",
    method: "POST",
    typeBadge: "legacy",
    endpoint: "/upus_APP/app/expressbox/devnoinfo",
    desc: "Retorna a calibração de tempos em segundos: task0 (UV), task1 (Fogger), task2 (Aquecedor), task3 (Ozônio), task4 (Perfume).",
    requestExample: {
      devno: "CPX-001"
    },
    responseExample: {
      code: 0,
      msg: "success",
      data: {
        devno: "CPX-001",
        task0Time: 30,
        task1Time: 60,
        task2Time: 240,
        task3Time: 60,
        task4Time: 30,
        xiangshuiTime: 3,
        prices: { basic: 13.0, intermediate: 17.0, advanced: 20.0 }
      }
    }
  },
  {
    title: "7. Teste Remoto de Névoa (UPUS remote/smoke)",
    method: "POST",
    typeBadge: "legacy",
    endpoint: "/upus_APP/app/device/remote/smoke",
    desc: "Dispara remotamente o atuador de fumaça/névoa atomizada para teste de bancada.",
    requestExample: {
      devno: "CPX-001"
    },
    responseExample: {
      code: 0,
      msg: "Teste de névoa disparado no totem CPX-001.",
      data: { success: true }
    }
  },
  {
    title: "8. Relatórios de Receita UPUS (newdepot/income/count)",
    method: "POST",
    typeBadge: "legacy",
    endpoint: "/upus_APP/app/newdepot/income/count",
    desc: "Consolida faturamento e comissões por ponto de instalação e por semana.",
    requestExample: {},
    responseExample: {
      code: 0,
      msg: "success",
      data: {
        depotStats: [
          { depotno: "DEP-01", depotna: "Shopping Central", cycles: 14, revenue: 238.00, commissionAmount: 35.70, netRevenue: 202.30 }
        ],
        weekTotalRevenue: 6494.00,
        weekTotalCycles: 382
      }
    }
  }
];

function renderApiDocs() {
  const container = document.getElementById('api-docs-container');
  if (!container) return;

  container.innerHTML = API_SPECS.map(api => {
    return `
      <div class="api-endpoint-card">
        <div class="api-endpoint-header">
          <span class="http-badge ${api.typeBadge}">${api.method}</span>
          <span class="api-path">${api.endpoint}</span>
          <strong style="margin-left: auto; font-size: 0.9rem; color: var(--text-primary);">${api.title}</strong>
        </div>
        <div class="api-endpoint-body">
          <p style="font-size: 0.88rem; color: var(--text-secondary); margin-bottom: 1.25rem;">${api.desc}</p>

          ${api.requestExample ? `
            <div style="margin-bottom: 1rem;">
              <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">
                Payload da Requisição (JSON Request Body):
              </div>
              <pre class="code-snippet"><code>${JSON.stringify(api.requestExample, null, 2)}</code></pre>
            </div>
          ` : ''}

          <div>
            <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">
              Resposta do Servidor (JSON Response Body):
            </div>
            <pre class="code-snippet"><code>${JSON.stringify(api.responseExample, null, 2)}</code></pre>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

document.addEventListener('DOMContentLoaded', renderApiDocs);
