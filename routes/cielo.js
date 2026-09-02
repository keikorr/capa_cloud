/**
 * Capaxero Cloud / UPUS IoT — Integração de Pagamento Cielo Real & Webhooks
 * Conforme SPEC-INT-001 (PIX Real Cielo API 3.0, Cartão de Débito, Crédito por aproximação NFC/Chip)
 */

const express = require('express');
const router = express.Router();
const store = require('../services/store');
const wsManager = require('../services/websocket');
const cieloConecta = require('../services/cieloConecta');
const cieloConfig = require('../config/cielo_conecta');
const { isValidWebhookToken } = require('../middleware/auth');

// Credenciais da conta Cielo (PIX / E-commerce 3.0) via variáveis de ambiente
const CIELO_MERCHANT_ID = process.env.CIELO_MERCHANT_ID || '';
const CIELO_MERCHANT_KEY = process.env.CIELO_MERCHANT_KEY || '';

// URLs da API Cielo E-commerce 3.0. O ambiente é resolvido por máquina (o painel grava
// "Producao" ou "Sandbox" em config.cielo.ecommerceEnvironment), com CIELO_ENVIRONMENT do
// .env como padrão. Antes eram constantes de módulo lidas uma única vez no boot, então
// trocar o ambiente no painel não tinha efeito nenhum sem reiniciar o servidor.
function ecommerceSalesUrl(isProduction) {
  if (process.env.CIELO_ECOMMERCE_API_URL) return process.env.CIELO_ECOMMERCE_API_URL;
  return isProduction
    ? 'https://api.cieloecommerce.cielo.com.br/1/sales/'
    : 'https://apisandbox.cieloecommerce.cielo.com.br/1/sales/';
}

function ecommerceQueryUrl(isProduction) {
  if (process.env.CIELO_ECOMMERCE_QUERY_URL) return process.env.CIELO_ECOMMERCE_QUERY_URL;
  return isProduction
    ? 'https://apiquery.cieloecommerce.cielo.com.br/1/sales/'
    : 'https://apiquerysandbox.cieloecommerce.cielo.com.br/1/sales/';
}

/**
 * Credenciais e ambiente E-commerce/PIX efetivos de uma máquina.
 *
 * O painel salva as credenciais em `config.cielo.ecommerceMerchantId/Key/Environment`
 * (modal "Credenciais Cielo" da estação), mas o checkout lia `config.cieloMerchantId/Key`
 * na raiz da config. Os dois nomes nunca se encontravam: a credencial cadastrada ficava
 * guardada e o PIX saía com a conta errada. A ordem de prioridade aqui é o que o painel
 * grava, depois o campo antigo na raiz (legado), depois o .env.
 */
function resolveEcommerceCredentials(totem) {
  const cfg = (totem && totem.config) || {};
  const nested = cfg.cielo || {};

  const pick = (...values) => {
    for (const v of values) {
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };

  const merchantId = pick(nested.ecommerceMerchantId, cfg.cieloMerchantId, CIELO_MERCHANT_ID);
  const merchantKey = pick(nested.ecommerceMerchantKey, cfg.cieloMerchantKey, CIELO_MERCHANT_KEY);
  const environment = pick(nested.ecommerceEnvironment, cieloConfig.environment) || 'Homologacao';
  const expiration = Number(nested.pixExpirationSeconds) > 0
    ? Number(nested.pixExpirationSeconds)
    : PIX_EXPIRATION_SECONDS;

  return {
    merchantId,
    merchantKey,
    environment,
    isProduction: environment === 'Producao',
    isConfigured: Boolean(merchantId && merchantKey),
    pixExpirationSeconds: expiration
  };
}

// Janela de validade do QR Code Pix (spec: 300s / 5 minutos)
const PIX_EXPIRATION_SECONDS = Number(process.env.CIELO_PIX_EXPIRATION_SECONDS || 300);
// Tempo máximo entre a Cielo aprovar um cartão e o totem confirmar o FINISHCHIP local
// antes do watchdog desfazer automaticamente a transação (regra crítica da SPEC-INT-001 §5.7)
const CARD_FINISH_WATCHDOG_SECONDS = Number(process.env.CIELO_CARD_FINISH_WATCHDOG_SECONDS || 120);

/**
 * Criação de transação Pix Real diretamente na API da Cielo
 */
async function createCieloPixSale(orderId, amountInCents, credentials) {
  try {
    const activeMerchantId = credentials.merchantId;
    const activeMerchantKey = credentials.merchantKey;

    if (!activeMerchantId || !activeMerchantKey) {
      console.warn('[CIELO PIX] Nenhuma credencial E-commerce cadastrada para esta máquina (painel > Credenciais Cielo) nem no .env.');
      return null;
    }

    const payload = {
      MerchantOrderId: orderId,
      Customer: {
        Name: "Cliente Capaxero"
      },
      Payment: {
        Type: "Pix",
        Amount: amountInCents
      }
    };

    const salesUrl = ecommerceSalesUrl(credentials.isProduction);
    console.log(`[CIELO PIX] Criando cobrança ${orderId} em ${credentials.environment} (${salesUrl}) com MerchantId ...${activeMerchantId.slice(-6)}`);

    const res = await fetch(salesUrl, {
      method: 'POST',
      headers: {
        'MerchantId': activeMerchantId,
        'MerchantKey': activeMerchantKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.Payment) {
        return {
          success: true,
          paymentId: data.Payment.PaymentId,
          qrCodePix: data.Payment.QrCodeString,
          qrCodeBase64: data.Payment.QrCodeBase64Image,
          tid: data.Payment.Tid,
          proofOfSale: data.Payment.ProofOfSale,
          status: data.Payment.Status === 2 ? 'APPROVED' : 'WAITING_PAYMENT'
        };
      }
    }
    const errText = await res.text();
    console.warn('[CIELO API] Erro ao criar venda Pix:', res.status, errText);
    return null;
  } catch (err) {
    console.error('[CIELO API] Exceção ao chamar Cielo:', err.message);
    return null;
  }
}

/**
 * Consulta de status em tempo real na API da Cielo
 */
async function queryCieloPaymentStatus(paymentId, credentials) {
  const activeMerchantId = credentials.merchantId;
  const activeMerchantKey = credentials.merchantKey;

  if (!paymentId || !activeMerchantId || !activeMerchantKey) return null;
  try {
    // A consulta precisa cair no mesmo ambiente em que a cobrança foi criada.
    const res = await fetch(ecommerceQueryUrl(credentials.isProduction) + paymentId, {
      headers: {
        'MerchantId': activeMerchantId,
        'MerchantKey': activeMerchantKey
      }
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.Payment) {
        return {
          status: data.Payment.Status === 2 ? 'APPROVED' : (data.Payment.Status === 12 ? 'WAITING_PAYMENT' : 'DECLINED'),
          rawStatus: data.Payment.Status,
          proofOfSale: data.Payment.ProofOfSale,
          tid: data.Payment.Tid,
          amount: data.Payment.Amount ? (data.Payment.Amount / 100) : null
        };
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Cálculo de CRC16-CCITT (Polinômio 0x1021, Inicial 0xFFFF) para Fallback EMV
 */
function calculateCRC16(payload) {
  let crc = 0xFFFF;
  const polynomial = 0x1021;
  const bytes = Buffer.from(payload, 'utf-8');
  for (let i = 0; i < bytes.length; i++) {
    crc ^= (bytes[i] << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ polynomial) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function generatePixBRCode({ orderId, amount, pixKey, merchantName, merchantCity }) {
  const key = pixKey || '5e4fc2b8-11e3-4f9c-ab97-fb7baaea405b';
  const name = (merchantName || 'CAPAXERO IOT').slice(0, 25);
  const city = (merchantCity || 'FORTALEZA').slice(0, 15);
  const txid = (orderId || 'ORD' + Date.now()).replace(/[^a-zA-Z0-9]/g, '').slice(0, 25);
  const amtStr = Number(amount).toFixed(2);

  const f00 = '000201';
  const f01 = '010212';
  const gui = '0014br.gov.bcb.pix';
  const keyTag = `01${String(key.length).padStart(2, '0')}${key}`;
  const f26Payload = gui + keyTag;
  const f26 = `26${String(f26Payload.length).padStart(2, '0')}${f26Payload}`;
  const f52 = '52040000';
  const f53 = '5303986';
  const f54 = `54${String(amtStr.length).padStart(2, '0')}${amtStr}`;
  const f58 = '5802BR';
  const f59 = `59${String(name.length).padStart(2, '0')}${name}`;
  const f60 = `60${String(city.length).padStart(2, '0')}${city}`;
  const txTag = `05${String(txid.length).padStart(2, '0')}${txid}`;
  const f62 = `62${String(txTag.length).padStart(2, '0')}${txTag}`;

  const payloadWithoutCRC = f00 + f01 + f26 + f52 + f53 + f54 + f58 + f59 + f60 + f62 + '6304';
  const crc = calculateCRC16(payloadWithoutCRC);
  return payloadWithoutCRC + crc;
}

/**
 * Gera um orderId de pedido pendente garantindo que não colida com um já existente em memória.
 */
function generatePendingOrderId() {
  let candidate;
  do {
    candidate = 'ORD-' + Math.floor(10000 + Math.random() * 90000);
  } while (store.pendingOrders.has(candidate));
  return candidate;
}

/**
 * POST /api/v1/payment/cielo/checkout ou /api/v1/cielo/checkout ou /api/v1/payment/checkout
 * Inicia uma cobrança PIX Real na Cielo vinculada à conta oficial
 */
router.post(['/cielo/checkout', '/checkout', '/'], async (req, res) => {
  const { devno, totemId, mode, amount, amountInCents: reqCents, paymentMethod } = req.body;
  const id = devno || totemId;

  if (!id || (!amount && !reqCents)) {
    return res.status(400).json({ success: false, message: 'Parâmetros devno/totemId e amount são obrigatórios.' });
  }

  const orderId = generatePendingOrderId();
  const numAmount = amount ? Number(amount) : (reqCents / 100);
  const amountInCents = reqCents || Math.round(numAmount * 100);
  const totem = store.getTotem(id) || store.upsertTotem({ devno: id });

  const credentials = resolveEcommerceCredentials(totem);
  const cieloPix = await createCieloPixSale(orderId, amountInCents, credentials);

  let qrCodePix = '';
  let qrCodeBase64 = '';
  let paymentId = null;
  let isRealCielo = false;

  if (cieloPix && cieloPix.qrCodePix) {
    qrCodePix = cieloPix.qrCodePix;
    qrCodeBase64 = cieloPix.qrCodeBase64 || '';
    paymentId = cieloPix.paymentId;
    isRealCielo = true;
    console.log(`[CIELO PIX] QrCode oficial gerado com sucesso para ${orderId} (PaymentId: ${paymentId})`);
  } else if (credentials.isConfigured) {
    // A máquina TEM credencial cadastrada e mesmo assim a Cielo não devolveu o QR.
    // Cair no EMV local aqui seria pior que falhar: o cliente pagaria um QR que não
    // pertence à conta do lojista. Foi assim que este problema passou despercebido.
    console.error(
      `[CIELO PIX] Falha ao gerar cobrança real para ${orderId} em ${credentials.environment}. ` +
      'Cobrança NÃO criada — confira as credenciais E-commerce no painel.'
    );
    return res.status(502).json({
      code: -1,
      success: false,
      error: 'CIELO_PIX_UNAVAILABLE',
      message: 'Não foi possível gerar o PIX na Cielo com as credenciais desta máquina. ' +
        'Confira o Merchant ID / Merchant Key e o ambiente em Credenciais Cielo.'
    });
  } else {
    // Sem nenhuma credencial cadastrada: modo demonstração, QR local só para exercitar o fluxo.
    qrCodePix = generatePixBRCode({
      orderId,
      amount: numAmount,
      pixKey: '5e4fc2b8-11e3-4f9c-ab97-fb7baaea405b',
      merchantName: 'CAPAXERO HIGIENIZACAO',
      merchantCity: 'FORTALEZA'
    });
    console.warn(
      `[CIELO PIX] Nenhuma credencial cadastrada — EMV de demonstração para ${orderId}. ` +
      'Este QR NÃO credita em nenhuma conta.'
    );
  }

  const checkoutData = {
    orderId,
    merchantOrderId: 'CPX-' + orderId,
    devno,
    totemName: totem ? totem.name : `Totem #${devno}`,
    mode: mode || 'INTERMEDIARIA',
    amount: numAmount,
    paymentMethod: paymentMethod || 'PIX_CIELO',
    paymentId,
    isRealCielo,
    qrCodePix,
    qrCodeBase64,
    status: 'WAITING_PAYMENT',
    createdAt: new Date().toISOString(),
    isDemoQrCode: !isRealCielo,
    cieloEnvironment: credentials.environment,
    expiresAt: new Date(Date.now() + credentials.pixExpirationSeconds * 1000).toISOString(),
    expiresInSeconds: credentials.pixExpirationSeconds
  };

  store.createPendingOrder(checkoutData);

  wsManager.broadcastToDashboard('ORDER_CREATED', {
    order: checkoutData,
    totem
  });

  return res.json({
    code: 0,
    success: true,
    data: checkoutData
  });
});

/**
 * GET /api/v1/payment/cielo/status/:orderId ou /api/v1/payment/status/:orderId
 * Consulta o status de um pedido PIX ou Cartão
 */
router.get(['/cielo/status/:orderId', '/status/:orderId'], async (req, res) => {
  const { orderId } = req.params;
  let order = store.getPendingOrder(orderId);

  if (!order) {
    return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });
  }

  // Expiração real do pedido: um QR "vencido" não pode mais ser aprovado.
  if (order.status === 'WAITING_PAYMENT' && order.expiresAt && new Date(order.expiresAt) < new Date()) {
    order = store.updatePendingOrder(orderId, { status: 'EXPIRED' });
  }

  // "Claim" do pedido antes de consultar a Cielo (chamada assíncrona): evita que uma segunda
  // requisição concorrente (outro polling, ou o webhook chegando ao mesmo tempo) processe a
  // mesma aprovação duas vezes e dispare dois destravamentos/transações duplicadas.
  if (order.status === 'WAITING_PAYMENT' && order.paymentId) {
    store.updatePendingOrder(orderId, { status: 'CHECKING' });
    const totem = store.getTotem(order.devno);
    const cieloStatus = await queryCieloPaymentStatus(order.paymentId, resolveEcommerceCredentials(totem));
    const current = store.getPendingOrder(orderId);

    if (!(cieloStatus && cieloStatus.status === 'APPROVED') ) {
      if (current.status === 'CHECKING') {
        store.updatePendingOrder(orderId, { status: 'WAITING_PAYMENT' });
      }
    } else if (current.status !== 'APPROVED') {
      const totem = store.getTotem(order.devno);
      const txRecord = store.addTransaction({
        orderId: order.orderId,
        devno: order.devno,
        totemName: totem ? totem.name : `Totem #${order.devno}`,
        mode: order.mode,
        amount: order.amount,
        paymentMethod: order.paymentMethod,
        nsu: cieloStatus.proofOfSale || Math.floor(100000000 + Math.random() * 900000000).toString(),
        authCode: cieloStatus.tid || Math.floor(100000 + Math.random() * 900000).toString(),
        status: 'APPROVED'
      });

      store.updatePendingOrder(orderId, { status: 'APPROVED' });

      if (totem) {
        totem.status = 'CLEANING';
        totem.currentCycle = {
          orderId: order.orderId,
          mode: order.mode,
          step: 'ESTERILIZAÇÃO UV-C (FASE 1/4)',
          stepIndex: 1,
          totalSteps: 4,
          elapsedSeconds: 0,
          totalSeconds: (totem.config && totem.config.intermediateDurationSec) || 420,
          progressPercent: 5
        };

        wsManager.sendCommandToTotem(order.devno, 'UNLOCK_DOOR_START_CYCLE', {
          orderId: order.orderId,
          mode: order.mode,
          holdTimeSec: 60,
          paymentMethod: order.paymentMethod,
          amount: order.amount,
          nsu: txRecord.nsu
        });
      }

      wsManager.broadcastToDashboard('NEW_TRANSACTION', {
        transaction: txRecord,
        totem: store.getTotem(order.devno),
        stats: store.getStats()
      });

      return res.json({
        code: 0,
        success: true,
        data: {
          orderId,
          status: 'APPROVED',
          paymentMethod: order.paymentMethod,
          amount: order.amount,
          nsu: txRecord.nsu,
          authCode: txRecord.authCode
        }
      });
    }
  }

  order = store.getPendingOrder(orderId); // relê o estado final após o claim acima

  return res.json({
    code: 0,
    success: true,
    data: {
      orderId,
      status: order.status,
      paymentMethod: order.paymentMethod,
      amount: order.amount,
      nsu: order.nsu,
      authCode: order.authCode,
      cardBrand: order.cardBrand,
      returnMessage: order.returnMessage
    }
  });
});

/**
 * POST /api/v1/payment/cielo/webhook
 *
 * A Cielo não assina esses eventos, então validamos um token secreto próprio embutido na URL
 * cadastrada junto à Cielo (?token=...) — sem ele, qualquer POST externo conseguiria forjar uma
 * aprovação de pagamento e destravar a cabine de graça. Veja CAPAXERO_WEBHOOK_TOKEN no boot log.
 */
router.post('/cielo/webhook', (req, res) => {
  const providedToken = req.query.token || req.headers['x-webhook-token'] || '';
  if (!isValidWebhookToken(providedToken)) {
    console.warn('[CIELO WEBHOOK] Requisição rejeitada: token de webhook ausente ou inválido.');
    return res.status(401).json({ received: false, message: 'Token de webhook inválido.' });
  }

  const event = req.body;
  console.log('[CIELO WEBHOOK] Evento recebido da Cielo:', JSON.stringify(event));

  if (event && (event.PaymentId || event.paymentId)) {
    const paymentId = event.PaymentId || event.paymentId;
    const status = event.ChangeType || event.status;

    if (status === 2 || status === 'PaymentApproved' || status === 'APPROVED') {
      const pendingList = Array.from(store.pendingOrders.values());
      const matched = pendingList.find(o => o.paymentId === paymentId);
      const notExpired = !matched || !matched.expiresAt || new Date(matched.expiresAt) >= new Date();

      if (matched && notExpired && matched.status !== 'APPROVED') {
        // Reivindica o pedido antes de qualquer outro trabalho: fecha a corrida com um polling
        // concorrente que esteja no meio de uma consulta assíncrona à Cielo para o mesmo pedido.
        store.updatePendingOrder(matched.orderId, { status: 'APPROVED' });
        const totem = store.getTotem(matched.devno);
        const txRecord = store.addTransaction({
          orderId: matched.orderId,
          devno: matched.devno,
          totemName: totem ? totem.name : `Totem #${matched.devno}`,
          mode: matched.mode,
          amount: matched.amount,
          paymentMethod: matched.paymentMethod,
          nsu: event.ProofOfSale || Math.floor(100000000 + Math.random() * 900000000).toString(),
          authCode: event.AuthorizationCode || Math.floor(100000 + Math.random() * 900000).toString(),
          status: 'APPROVED'
        });

        if (totem) {
          totem.status = 'CLEANING';
          wsManager.sendCommandToTotem(matched.devno, 'UNLOCK_DOOR_START_CYCLE', {
            orderId: matched.orderId,
            mode: matched.mode,
            holdTimeSec: 60,
            paymentMethod: matched.paymentMethod,
            amount: matched.amount,
            nsu: txRecord.nsu
          });
        }

        wsManager.broadcastToDashboard('NEW_TRANSACTION', {
          transaction: txRecord,
          totem: store.getTotem(matched.devno),
          stats: store.getStats()
        });
      }
    }
  }

  return res.json({ received: true, timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────────────────────────────────────
// CIELO CONECTA — CARTÃO PRESENTE (DÉBITO / CRÉDITO COM PINPAD GERTEC PPC930)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/payment/cielo/card/config
 * Retorna configurações do Pinpad (licença, empresa, porta e timeout) sem expor segredos.
 */
router.get('/cielo/card/config', (req, res) => {
  try {
    const configStatus = cieloConecta.getConfigStatus();
    return res.json({
      code: 0,
      success: true,
      data: {
        pinpad: {
          license: cieloConfig.pinpad.license,
          companyName: cieloConfig.pinpad.companyName,
          comm: cieloConfig.pinpad.comm
        },
        environment: cieloConfig.environment,
        simulator: configStatus.simulator,
        configured: configStatus.configured,
        cardTimeoutSeconds: cieloConfig.cardTimeoutSeconds
      }
    });
  } catch (err) {
    return res.status(500).json({ code: -1, success: false, message: err.message });
  }
});

/**
 * GET /api/v1/payment/cielo/card/initialization
 * "Baixa de Parâmetros" — devolve tabelas EMV (AidParameters, PublicKeys, InitializationVersion)
 */
router.get('/cielo/card/initialization', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const tables = await cieloConecta.getPinpadTables({ force });
    return res.json({
      code: 0,
      success: true,
      data: tables
    });
  } catch (err) {
    console.error('[CIELO CONECTA] Erro na baixa de parâmetros:', err.message);
    return res.status(500).json({ code: -1, success: false, message: err.message });
  }
});

/**
 * POST /api/v1/payment/cielo/card/start
 * Inicia transação de cartão presente
 */
router.post('/cielo/card/start', async (req, res) => {
  const { devno, amount, mode, paymentMethod } = req.body;

  if (!devno || !amount) {
    return res.status(400).json({ success: false, message: 'Parâmetros devno e amount são obrigatórios.' });
  }

  const orderId = generatePendingOrderId();
  const merchantOrderId = cieloConecta.generateMerchantOrderId();
  const numAmount = Number(amount);
  const amountCents = Math.round(numAmount * 100);
  const payMethod = paymentMethod || 'CIELO_CREDITO';
  const appType = (payMethod === 'CIELO_DEBITO' || payMethod === 'debit') ? '02' : '01';
  const totem = store.getTotem(devno);

  let initVer10 = '0000';
  try {
    const tables = await cieloConecta.getPinpadTables();
    if (tables && tables.initVer10) initVer10 = tables.initVer10;
  } catch (ignored) {}

  const checkoutData = {
    orderId,
    merchantOrderId,
    devno,
    totemName: totem ? totem.name : `Totem #${devno}`,
    mode: mode || 'INTERMEDIARIA',
    amount: numAmount,
    paymentMethod: payMethod,
    status: 'WAITING_CARD',
    pinpadCommand: {
      amount: amountCents,
      appType,
      trnType: '00',
      ctlsOn: '1',
      dateTime: cieloConecta.formatPaymentDateTime(),
      initVer: initVer10,
      timeoutSeconds: cieloConfig.cardTimeoutSeconds || 90
    },
    createdAt: new Date().toISOString()
  };

  store.createPendingOrder(checkoutData);
  console.log(`[CIELO CONECTA] Início de transação com Cartão Presente (${payMethod}): ${orderId} (MerchantOrder: ${merchantOrderId}) - R$ ${numAmount.toFixed(2)}`);

  return res.json({
    code: 0,
    success: true,
    data: checkoutData
  });
});

/**
 * POST /api/v1/payment/cielo/card/authorize
 * Recebe dados criptografados do pinpad (DUKPT) e autoriza na Cielo Conecta (POST /1/physicalSales)
 */
router.post('/cielo/card/authorize', async (req, res) => {
  const { orderId, devno, card, pinpadInfo, appType, merchantOrderId, amountCents } = req.body;
  const order = store.getPendingOrder(orderId) || {};

  try {
    const effectiveAmount = order.amount || (amountCents ? amountCents / 100 : 17.00);
    const effectiveAppType = appType || order.pinpadCommand?.appType || (order.paymentMethod === 'CIELO_DEBITO' ? '02' : '01');
    const effectiveMerchantOrder = merchantOrderId || order.merchantOrderId || cieloConecta.generateMerchantOrderId();

    const authResult = await cieloConecta.authorizeCardSale({
      amount: effectiveAmount,
      appType: effectiveAppType,
      card: card || {},
      pinpadInfo: pinpadInfo || {},
      merchantOrderId: effectiveMerchantOrder
    });

    store.updatePendingOrder(orderId, {
      // "APPROVED" aqui só significa que a CIELO aprovou — o totem ainda precisa confirmar o
      // FINISHCHIP local via /card/finish. financeConfirmed só vira true nesse segundo passo;
      // enquanto isso o watchdog abaixo pode desfazer automaticamente se o totem nunca responder.
      status: authResult.approved ? 'APPROVED' : 'DENIED',
      financeConfirmed: false,
      authorizedAt: authResult.approved ? new Date().toISOString() : null,
      paymentId: authResult.paymentId,
      merchantOrderId: effectiveMerchantOrder,
      nsu: authResult.nsu,
      authCode: authResult.authCode,
      cardBrand: (card && card.cardBrand) || authResult.cardBrand || 'Mastercard',
      emvResponseData: authResult.emvResponseData,
      rawAuthResult: authResult
    });

    console.log(`[CIELO CONECTA] Autorização processada para ${orderId}: Status=${authResult.status}, NSU=${authResult.nsu}, AuthCode=${authResult.authCode}`);

    return res.json({
      code: 0,
      success: true,
      data: {
        orderId,
        merchantOrderId: effectiveMerchantOrder,
        paymentId: authResult.paymentId,
        status: authResult.status,
        nsu: authResult.nsu,
        authCode: authResult.authCode,
        retCode: authResult.returnCode !== null ? Number(authResult.returnCode) : (authResult.approved ? 0 : 51),
        emvResponseData: authResult.emvResponseData || '8A023030',
        cardBrand: authResult.cardBrand,
        receipt: authResult.receipt,
        links: authResult.links
      }
    });
  } catch (err) {
    console.error(`[CIELO CONECTA] Erro ao autorizar pedido ${orderId}:`, err.message);
    store.updatePendingOrder(orderId, { status: 'DENIED', error: err.message });
    return res.status(err.httpStatus || 400).json({
      code: -1,
      success: false,
      message: err.message,
      data: {
        orderId,
        status: 'DENIED',
        retCode: 51,
        emvResponseData: '8A023035'
      }
    });
  }
});

/**
 * POST /api/v1/payment/cielo/card/finish
 * Conclui a transação após o FINISHCHIP do pinpad e aciona a cabine
 */
router.post('/cielo/card/finish', async (req, res) => {
  const { orderId, devno, finalResult, finishChipStatus, amountCents } = req.body;
  const order = store.getPendingOrder(orderId) || {};
  const totem = store.getTotem(devno || order.devno);

  try {
    const isApproved = finalResult === 'APPROVED' || finalResult === '0' || finalResult === 0 || finalResult === 'SUCCESS';

    if (isApproved) {
      if (order.paymentId) {
        await cieloConecta.confirmSale({
          paymentId: order.paymentId,
          amount: order.amount || (amountCents ? amountCents / 100 : 17.00),
          links: order.rawAuthResult?.links
        }).catch(err => console.warn('[CIELO CONECTA] Aviso na confirmação:', err.message));
      }

      const txRecord = store.addTransaction({
        orderId: orderId || order.orderId,
        devno: devno || order.devno,
        totemName: totem ? totem.name : `Totem #${devno || order.devno}`,
        mode: order.mode || 'INTERMEDIARIA',
        amount: order.amount || 17.00,
        paymentMethod: order.paymentMethod || 'CIELO_CREDITO',
        cardBrand: order.cardBrand || 'Cartão Cielo',
        nsu: order.nsu || Math.floor(100000000 + Math.random() * 900000000).toString(),
        authCode: order.authCode || Math.floor(100000 + Math.random() * 900000).toString(),
        status: 'APPROVED'
      });

      store.updatePendingOrder(orderId, { status: 'APPROVED', financeConfirmed: true });

      if (totem) {
        totem.status = 'CLEANING';
        totem.currentCycle = {
          orderId: orderId || order.orderId,
          mode: order.mode || 'INTERMEDIARIA',
          step: 'ESTERILIZAÇÃO UV-C (FASE 1/4)',
          stepIndex: 1,
          totalSteps: 4,
          elapsedSeconds: 0,
          totalSeconds: (totem.config && totem.config.intermediateDurationSec) || 420,
          progressPercent: 5
        };

        wsManager.sendCommandToTotem(devno || order.devno, 'UNLOCK_DOOR_START_CYCLE', {
          orderId: orderId || order.orderId,
          mode: order.mode || 'INTERMEDIARIA',
          holdTimeSec: 60,
          paymentMethod: order.paymentMethod,
          amount: order.amount,
          nsu: txRecord.nsu
        });
      }

      wsManager.broadcastToDashboard('NEW_TRANSACTION', {
        transaction: txRecord,
        totem: store.getTotem(devno || order.devno),
        stats: store.getStats()
      });

      console.log(`[CIELO CONECTA] Transação de cartão concluída com sucesso: ${orderId} (R$ ${txRecord.amount})`);

      return res.json({
        code: 0,
        success: true,
        message: 'Transação de cartão confirmada e cabine acionada.'
      });
    } else {
      if (order.paymentId) {
        await cieloConecta.reverseSale({
          paymentId: order.paymentId,
          merchantOrderId: order.merchantOrderId,
          amount: order.amount,
          links: order.rawAuthResult?.links
        }, 'LOCAL_ERROR_OR_REJECTED').catch(err => console.warn('[CIELO CONECTA] Aviso no desfazimento:', err.message));
      }
      store.updatePendingOrder(orderId, { status: 'REVERSED', financeConfirmed: true, finalResult });
      return res.json({
        code: 0,
        success: true,
        message: 'Transação desfeita com sucesso.'
      });
    }
  } catch (err) {
    console.error('[CIELO CONECTA] Erro ao finalizar transação:', err);
    return res.status(500).json({ code: -1, success: false, message: err.message });
  }
});

/**
 * POST /api/v1/payment/cielo/card/reversal
 */
router.post('/cielo/card/reversal', async (req, res) => {
  const { orderId, reason } = req.body;
  console.log(`[CIELO CONECTA] Desfazimento solicitado para pedido ${orderId}: ${reason || 'N/A'}`);

  const order = store.getPendingOrder(orderId);
  if (order && order.paymentId) {
    try {
      await cieloConecta.reverseSale({
        paymentId: order.paymentId,
        merchantOrderId: order.merchantOrderId,
        amount: order.amount,
        links: order.rawAuthResult?.links
      }, reason || 'USER_CANCELLED');
    } catch (e) {
      console.warn('[CIELO CONECTA] Erro no reversal:', e.message);
    }
  }

  store.updatePendingOrder(orderId, { status: 'REVERSED', financeConfirmed: true, reversalReason: reason });

  return res.json({
    code: 0,
    success: true,
    message: 'Desfazimento de transação de cartão processado com sucesso.'
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WATCHDOG — desfazimento automático de cartão aprovado e nunca confirmado
//
// Regra crítica da SPEC-INT-001 §5.7: se a Cielo aprovou mas o totem nunca chamou
// /card/finish (app travou, pinpad caiu, tablet perdeu conexão após a aprovação), a
// transação não pode ficar pela metade — o dinheiro foi debitado do cliente sem o serviço
// ser prestado. Este sweep periódico fecha essa lacuna, que antes dependia 100% do totem.
// ─────────────────────────────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const order of store.pendingOrders.values()) {
    if (
      order.status === 'APPROVED' &&
      order.financeConfirmed === false &&
      order.authorizedAt &&
      (now - new Date(order.authorizedAt).getTime()) > CARD_FINISH_WATCHDOG_SECONDS * 1000
    ) {
      console.warn(`[CIELO CONECTA][WATCHDOG] Pedido ${order.orderId} aprovado há mais de ${CARD_FINISH_WATCHDOG_SECONDS}s sem confirmação local (/card/finish). Desfazendo automaticamente.`);
      store.updatePendingOrder(order.orderId, { status: 'REVERSED', financeConfirmed: true, reversalReason: 'WATCHDOG_FINISH_TIMEOUT' });
      cieloConecta.reverseSale({
        paymentId: order.paymentId,
        merchantOrderId: order.merchantOrderId,
        amount: order.amount,
        links: order.rawAuthResult && order.rawAuthResult.links
      }, 'WATCHDOG_FINISH_TIMEOUT').catch(err => {
        console.error(`[CIELO CONECTA][WATCHDOG] Falha ao desfazer pedido ${order.orderId}:`, err.message);
      });
    }
  }
}, 30 * 1000);

module.exports = router;
