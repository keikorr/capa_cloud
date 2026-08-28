/**
 * Capaxero Cloud — Serviço de Integração Cielo Conecta (Cartão Presente / Débito e Crédito)
 *
 * Conforme SPEC-INT-001 e o documento "Cielo Conecta — Integration Briefing".
 *
 * Este módulo cobre a CAMADA DE BACKEND (API/host) da trilha B do briefing:
 *   • Autenticação OAuth2 "Client Credentials" (POST /oauth2/token com HTTP Basic).
 *   • "Baixa de Parâmetros" / Inicialização
 *     (GET /api/v0.1/initialization/{SubordinatedMerchantId}/{TerminalId}), que devolve as
 *     tabelas Bins, Products, Emv, Issuers, Parameters, AidParameters, PublicKeys e o
 *     InitializationVersion — o mesmo conjunto consumido pelo PPC_CMD_TAB_LOAD no totem.
 *   • Resolução do ProductId (Crédito = 0 / Débito = 1) pelo AID (chip) ou faixa de BIN (tarja).
 *   • Autorização da venda presencial (POST /1/physicalSales/).
 *   • Confirmação e Desfazimento (reversal) via os Links hipermídia da resposta.
 *
 * A CAMADA LOCAL do pinpad (biblioteca PPCONECTA: PPC_CMD_GETCARD, PPC_CMD_PROCCHIP,
 * PPC_CMD_FINISHCHIP, etc.) roda no tablet Android — ver `android_cielo/` no repositório do APK.
 * O tablet nunca recebe o ClientSecret: ele envia os dados de cartão já criptografados pelo
 * pinpad (DUKPT 3DES CBC) para cá, e este serviço fala com a Cielo.
 */

const config = require('../config/cielo_conecta');

// ─────────────────────────────────────────────────────────────────────────────
// Estado interno (tokens e tabelas de inicialização em memória)
// ─────────────────────────────────────────────────────────────────────────────
const tokenCache = new Map(); // scope -> { accessToken, expiresAt }
let initializationCache = null; // { data, fetchedAt, version }
let orderSequence = 0;

/**
 * Indica se o serviço deve operar em modo simulador (sem chamar a Cielo de verdade).
 * Em "auto", o simulador liga sozinho enquanto faltarem URL base ou credenciais.
 */
function isSimulator() {
  if (config.simulator === 'on') return true;
  if (config.simulator === 'off') return false;
  return !(config.baseUrl && config.clientId && config.clientSecret);
}

/**
 * Motivo pelo qual o simulador está ativo — útil para o painel e para os logs.
 */
function getConfigStatus() {
  const missing = [];
  if (!config.baseUrl) missing.push('CIELO_BASE_URL');
  if (!config.authUrl) missing.push('CIELO_AUTH_URL');
  if (!config.clientId) missing.push('CIELO_CLIENT_ID');
  if (!config.clientSecret) missing.push('CIELO_CLIENT_SECRET');
  if (!config.merchantId) missing.push('CIELO_SUBORDINATED_MERCHANT_ID');
  if (!config.terminalId) missing.push('CIELO_TERMINAL_ID');
  if (!config.pinpad.license) missing.push('CIELO_PINPAD_LICENSE');
  if (!config.pinpad.companyName) missing.push('CIELO_PINPAD_COMPANY');

  return {
    environment: config.environment,
    simulator: isSimulator(),
    configured: missing.length === 0,
    missing
  };
}

/**
 * MerchantOrderId: identificador próprio, numérico, de 1 a 15 dígitos e NUNCA reutilizado.
 * Timestamp em milissegundos (13 dígitos) + sequencial de 2 dígitos = 15 dígitos.
 */
function generateMerchantOrderId() {
  orderSequence = (orderSequence + 1) % 100;
  return `${Date.now()}${String(orderSequence).padStart(2, '0')}`;
}

/**
 * Data/hora no formato exigido pela Cielo e pelo PPC_INP_DATETIME: "AAAA-MM-DDThh:mm:ss".
 */
function formatPaymentDateTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Valor em centavos, sem separadores — formato de Payment.Amount e de PPC_INP_AMOUNT.
 */
function toCents(amount) {
  return Math.round(Number(amount) * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Autenticação OAuth2 (Client Credentials)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Obtém (e mantém em cache) o access_token para um escopo.
 *
 * Homologação devolve tokens de 24h; Produção, de apenas 20 minutos — por isso o token é
 * sempre renovado com base no `expires_in` real da resposta, descontada a margem de segurança.
 */
async function getAccessToken(scope = config.scopeTransactional) {
  const cached = tokenCache.get(scope);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }

  if (!config.authUrl || !config.clientId || !config.clientSecret) {
    throw new Error('Credenciais Cielo Conecta não configuradas (CIELO_AUTH_URL / CLIENT_ID / CLIENT_SECRET).');
  }

  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  if (scope) body.set('scope', scope);

  const res = await fetch(config.authUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Falha na autenticação Cielo Conecta (HTTP ${res.status}): ${detail}`);
  }

  const data = await res.json();
  const expiresInSeconds = Number(data.expires_in || 1200);
  const ttl = Math.max(expiresInSeconds - config.tokenRefreshMarginSeconds, 30);

  tokenCache.set(scope, {
    accessToken: data.access_token,
    expiresAt: Date.now() + ttl * 1000
  });

  console.log(`[CIELO CONECTA] Token OAuth2 obtido (escopo ${scope}, válido por ${expiresInSeconds}s).`);
  return data.access_token;
}

/**
 * Chamada autenticada genérica à API Cielo Conecta.
 * `kind` define qual valor vai no header "Environment": 'master' ou 'payment'.
 */
async function cieloRequest(method, path, { body, scope, kind = 'payment' } = {}) {
  const token = await getAccessToken(scope || (kind === 'master' ? config.scopeMaster : config.scopeTransactional));
  const envHeader = config.environmentHeaders[kind];

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (envHeader) headers['Environment'] = envHeader;

  const url = path.startsWith('http') ? path : `${config.baseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (e) {
    payload = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`Cielo Conecta ${method} ${path} respondeu HTTP ${res.status}`);
    err.httpStatus = res.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. "Baixa de Parâmetros" (Inicialização)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Baixa (com cache) as tabelas de inicialização do terminal.
 *
 * Uma única chamada devolve tudo que o pinpad e a aplicação precisam:
 * Bins, Products, Emv, Issuers, Parameters, AidParameters, PublicKeys e InitializationVersion.
 *
 * Sempre que o InitializationVersion mudar do lado da Cielo, o totem precisa recarregar as
 * tabelas no pinpad com PPC_CMD_TAB_LOAD (é exatamente o que PPC_CMD_TAB_VER detecta).
 */
async function getInitialization({ force = false } = {}) {
  const cacheTtl = config.initializationCacheMinutes * 60 * 1000;
  if (!force && initializationCache && (Date.now() - initializationCache.fetchedAt) < cacheTtl) {
    return initializationCache.data;
  }

  if (isSimulator()) {
    initializationCache = {
      data: buildSimulatedInitialization(),
      fetchedAt: Date.now()
    };
    return initializationCache.data;
  }

  if (!config.merchantId || !config.terminalId) {
    throw new Error('SubordinatedMerchantId e TerminalId são obrigatórios para a baixa de parâmetros.');
  }

  const initBase = config.initUrl || `${config.baseUrl}/api/v0.1/initialization`;
  const url = `${initBase.replace(/\/+$/, '')}/${config.merchantId}/${config.terminalId}`;
  const data = await cieloRequest('GET', url, { kind: 'master' });

  initializationCache = { data, fetchedAt: Date.now() };
  console.log(`[CIELO CONECTA] Baixa de parâmetros concluída — InitializationVersion ${data.InitializationVersion}.`);
  return data;
}

/**
 * Pacote enxuto entregue ao totem para alimentar PPC_CMD_TAB_VER / PPC_CMD_TAB_LOAD.
 *
 * O PPC_INP_INITVER recebe apenas os 10 ÚLTIMOS caracteres do InitializationVersion — a
 * comparação com PPC_OUT_TABVER é feita sobre esse mesmo recorte.
 */
async function getPinpadTables({ force = false } = {}) {
  const init = await getInitialization({ force });
  const fullVersion = String(init.InitializationVersion || '');

  return {
    initializationVersion: fullVersion,
    initVer10: fullVersion.slice(-10),         // PPC_INP_INITVER
    aidParameters: init.AidParameters || [],   // PPC_INP_TABAID
    publicKeys: init.PublicKeys || [],         // PPC_INP_TABCAPK
    // Parâmetros de risco EMV usados em PPC_CMD_PROCCHIP e a lista de tags TagsFirst/TagsSecond
    emv: init.Emv || [],
    parameters: init.Parameters || {},
    // Licença repassada ao PPC_CMD_OPEN no tablet
    pinpad: {
      license: config.pinpad.license,
      companyName: config.pinpad.companyName,
      comm: config.pinpad.comm
    },
    cardTimeoutSeconds: config.cardTimeoutSeconds
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Resolução do produto (Crédito = 0 / Débito = 1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normaliza o AID devolvido pelo cartão. O PPC_OUT_CARDAID pode trazer bytes extras à
 * direita (ex.: "A000000003101001" para o registro "A0000000031010" da tabela Emv), então a
 * comparação é feita por prefixo, respeitando o tamanho do AID cadastrado na tabela.
 */
function aidMatches(tableAid, cardAid) {
  if (!tableAid || !cardAid) return false;
  const t = String(tableAid).toUpperCase();
  const c = String(cardAid).toUpperCase();
  return c.startsWith(t);
}

/**
 * Descobre qual ProductId (e portanto se é Crédito ou Débito) se aplica à transação:
 *  • cartão com chip  → pesquisa o AID na tabela Emv;
 *  • tarja / digitado → pesquisa a faixa de BIN na tabela Bins.
 *
 * `appType` é o tipo pedido pelo usuário na tela ("01" crédito / "02" débito, mesmo valor
 * enviado ao pinpad em PPC_INP_APPTYPE) e serve de desempate quando o cartão é múltiplo.
 */
async function resolveProduct({ cardAid, cardBin, appType = '01' }) {
  const wantedType = appType === '02' ? 1 : 0; // 0 = Crédito, 1 = Débito
  try {
    const init = await getInitialization();
    const emvTable = (init && init.Emv) || [];
    const binsTable = (init && init.Bins) || [];
    const productsTable = (init && init.Products) || [];

    const candidates = [];

    if (cardAid) {
      for (const row of emvTable) {
        if (aidMatches(row.Aid, cardAid)) candidates.push(row);
      }
    }

    if (!candidates.length && cardBin) {
      const bin = Number(cardBin);
      for (const row of binsTable) {
        const initial = Number(row.InitialBin);
        const final = Number(row.FinalBin);
        if (!Number.isNaN(initial) && !Number.isNaN(final) && bin >= initial && bin <= final) {
          candidates.push(row);
        }
      }
    }

    const describe = (productId) => productsTable.find(p => String(p.ProductId) === String(productId)) || null;

    let chosen = null;
    for (const candidate of candidates) {
      const product = describe(candidate.ProductId);
      const productType = product ? Number(product.ProductType ?? product.Type) : null;
      if (productType === wantedType) {
        chosen = { candidate, product };
        break;
      }
    }
    if (!chosen && candidates.length > 0) {
      const candidate = candidates[0];
      chosen = { candidate, product: describe(candidate.ProductId) };
    }

    if (chosen && chosen.candidate) {
      const productType = chosen.product
        ? Number(chosen.product.ProductType ?? chosen.product.Type)
        : wantedType;

      return {
        productId: chosen.candidate.ProductId,
        productName: chosen.product ? (chosen.product.ProductName || chosen.product.Name) : (wantedType === 1 ? 'Debito a vista' : 'Credito a vista'),
        productType,
        paymentType: productType === 1 ? 'PhysicalDebitCard' : 'PhysicalCreditCard',
        brandId: chosen.candidate.BrandId || (productType === 1 ? 2 : 1),
        issuerId: chosen.candidate.IssuerId || (productType === 1 ? 2580 : 1010),
        matchedBy: cardAid && chosen.candidate.Aid ? 'Emv/Aid' : 'Bins/Range'
      };
    }
  } catch (err) {
    console.warn('[CIELO CONECTA] Aviso na resolução de produto via tabelas:', err.message);
  }

  // Fallback padrão se não encontrar nas tabelas
  return {
    productId: wantedType === 1 ? 81 : 1,
    productName: wantedType === 1 ? 'Debito a vista' : 'Credito a vista',
    productType: wantedType,
    paymentType: wantedType === 1 ? 'PhysicalDebitCard' : 'PhysicalCreditCard',
    brandId: wantedType === 1 ? 2 : 1,
    issuerId: wantedType === 1 ? 2580 : 1010,
    matchedBy: 'Default/Fallback'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Autorização da venda presencial (POST /1/physicalSales/)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Monta e envia a autorização de uma venda com cartão presente.
 *
 * @param {object} params
 * @param {number} params.amount           Valor em reais (ex.: 17).
 * @param {string} params.appType          "01" crédito | "02" débito (PPC_INP_APPTYPE).
 * @param {object} params.card             Saída do pinpad (PPC_CMD_GETCARD/GETTRACKS/PROCCHIP).
 * @param {object} params.pinpadInfo       Saída de PPC_CMD_OPEN (número de série, características).
 * @param {string} [params.merchantOrderId] Se omitido, é gerado aqui.
 */
async function authorizeCardSale({ amount, appType = '01', card = {}, pinpadInfo = {}, merchantOrderId, paymentDateTime }) {
  const merchantOrder = merchantOrderId || generateMerchantOrderId();
  const dateTime = paymentDateTime || formatPaymentDateTime();
  const amountCents = toCents(amount);

  if (isSimulator()) {
    return simulateAuthorization({ merchantOrder, amountCents, appType, card, dateTime });
  }

  const product = await resolveProduct({
    cardAid: card.cardAid,
    cardBin: card.cardBin,
    appType
  });

  // O bloco de cartão muda de nome conforme o produto: CreditCard ou DebitCard.
  const cardBlockName = product.productType === 1 ? 'DebitCard' : 'CreditCard';

  const cardBlock = {
    ExpirationDate: card.expirationDate || '12/2030',
    BrandId: product.brandId || (product.productType === 1 ? 2 : 1),
    IssuerId: product.issuerId || (product.productType === 1 ? 2580 : 1010),
    InputMode: card.cardType || (card.isChip ? 'Emv' : 'ContactlessEmv'),
    AuthenticationMethod: card.authenticationMethod || 'OnlineAuthentication',
    PanSequenceNumber: Number(card.panSequenceNumber) || 1,
    SaveCard: false,
    IsFallback: card.isFallback === true || card.isFallback === 'true',
    EncryptedCardData: {
      EncryptionType: card.encryptionType || 'Dukpt3DesCBC',
      IsDataInTLVFormat: false,
      InitializationVector: card.initializationVector || '0000000000000000',
      TrackTwoDataKSN: card.trackTwoDataKsn || '',
      ...(card.trackOneDataKsn ? { TrackOneDataKSN: card.trackOneDataKsn } : {})
    }
  };

  if (card.trackTwoData) cardBlock.TrackTwoData = card.trackTwoData;
  if (card.trackOneData) cardBlock.TrackOneData = card.trackOneData;
  if (card.emvData) cardBlock.EmvData = card.emvData;

  if (card.encryptedPinBlock) {
    cardBlock.PinBlock = {
      EncryptedPinBlock: card.encryptedPinBlock,
      EncryptionType: card.pinEncryptionType || 'Dukpt3Des',
      KsnIdentification: card.pinKsn || ''
    };
  }

  const body = {
    MerchantOrderId: merchantOrder,
    Payment: {
      SubordinatedMerchantId: config.merchantId || config.clientId,
      Installments: 1,
      Interest: 'ByMerchant',
      Amount: amountCents,
      Capture: true,
      ProductId: product.productId,
      Type: product.paymentType,
      PaymentDateTime: dateTime,
      SoftDescriptor: 'Chip',
      PinPadInformation: {
        TerminalId: config.terminalId || '00000001',
        SerialNumber: (pinpadInfo && pinpadInfo.serialNumber) || '205fae17775b1955',
        PhysicalCharacteristics: (pinpadInfo && pinpadInfo.physicalCharacteristics) || 'PinPadWithChipReaderWithSamModuleAndContactless',
        ReturnDataInfo: (pinpadInfo && pinpadInfo.returnDataInfo) || '00'
      },
      [cardBlockName]: cardBlock
    }
  };

  const response = await cieloRequest('POST', '/1/physicalSales', { body, kind: 'payment' });
  return normalizeSaleResponse(response, { merchantOrder, product, amountCents });
}

/**
 * Normaliza a resposta da Cielo num formato único para o totem e para o dashboard.
 */
function normalizeSaleResponse(response, { merchantOrder, product, amountCents }) {
  const payment = (response && response.Payment) || {};
  const rawStatus = Number(payment.Status);
  const returnCode = String(payment.ReturnCode || '');
  const returnMsg = String(payment.ReturnMessage || payment.Message || '').toUpperCase();
  const approved = rawStatus === 2 || returnCode === '000' || returnCode === '00' || returnCode === '0' || returnMsg.includes('APROVAD');

  return {
    approved,
    status: approved ? 'APPROVED' : 'DENIED',
    rawStatus: payment.Status,
    merchantOrderId: merchantOrder,
    paymentId: payment.PaymentId || payment.Id || null,
    amount: amountCents / 100,
    productId: product ? product.productId : payment.ProductId,
    productType: product ? product.productType : null,
    paymentType: product ? product.paymentType : payment.Type,
    // ReturnCode alimenta PPC_INP_RETCODE no PPC_CMD_FINISHCHIP
    returnCode: payment.ReturnCode || null,
    returnMessage: payment.ReturnMessage || payment.Message || null,
    // EmvResponseData alimenta PPC_INP_EMVDATA no PPC_CMD_FINISHCHIP
    emvResponseData: payment.EmvResponseData || null,
    nsu: payment.Nsu || payment.ProofOfSale || null,
    authCode: payment.AuthorizationCode || payment.AuthCode || null,
    cardBrand: payment.Brand || (payment.CreditCard && payment.CreditCard.Brand) || null,
    receipt: payment.ReceiptInformation || response.ReceiptInformation || null,
    links: extractLinks(response, payment),
    raw: response
  };
}

/**
 * Extrai os Links hipermídia (confirm / reverse) devolvidos pela Cielo.
 */
function extractLinks(response, payment) {
  const list = (payment && payment.Links) || (response && response.Links) || [];
  const links = {};
  for (const link of list) {
    const rel = String(link.Rel || link.rel || '').toLowerCase();
    links[rel] = { href: link.Href || link.href, method: link.Method || link.method || 'POST' };
  }
  return links;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Confirmação e Desfazimento (reversal)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Confirma a venda (quando o fluxo hipermídia da Cielo exigir o passo de confirmação).
 */
async function confirmSale(sale) {
  if (isSimulator()) {
    return { confirmed: true, simulated: true };
  }
  const link = sale && sale.links && (sale.links.confirm || sale.links.confirmation);
  if (!link) return { confirmed: false, reason: 'Resposta da Cielo não trouxe link de confirmação.' };

  const response = await cieloRequest(link.method || 'POST', link.href, { kind: 'payment' });
  return { confirmed: true, response };
}

/**
 * DESFAZIMENTO (reversal).
 *
 * Regra crítica do briefing: se a Cielo aprovou a transação mas o fechamento local falhou —
 * PPC_CMD_FINISHCHIP retornando erro, PPC_OUT_FINALRES = "3" (aprovada online e negada pelo
 * cartão), ou qualquer falha depois da aprovação — a transação NÃO pode ficar pela metade e
 * o desfazimento precisa ser enviado.
 */
async function reverseSale(sale, reason = 'FINISHCHIP_FAILED') {
  if (isSimulator()) {
    console.log(`[CIELO CONECTA][SIM] Desfazimento simulado do pedido ${sale && sale.merchantOrderId} (${reason}).`);
    return { reversed: true, simulated: true, reason };
  }

  const link = sale && sale.links && (sale.links.reverse || sale.links.reversal || sale.links.void);
  if (!link) {
    console.error(`[CIELO CONECTA] Desfazimento SEM link hipermídia — pedido ${sale && sale.merchantOrderId}, motivo ${reason}.`);
    return { reversed: false, reason: 'Resposta da Cielo não trouxe link de desfazimento.' };
  }

  const response = await cieloRequest(link.method || 'POST', link.href, { kind: 'payment' });
  console.log(`[CIELO CONECTA] Desfazimento enviado — pedido ${sale.merchantOrderId} (${reason}).`);
  return { reversed: true, reason, response };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Modo simulador (sem pinpad físico / sem credenciais)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tabelas mínimas no mesmo formato da Inicialização real, para que a resolução de produto e
 * o carregamento de tabelas do totem possam ser exercitados antes do pinpad chegar.
 */
function buildSimulatedInitialization() {
  return {
    InitializationVersion: 'SIM0000001',
    Bins: [
      { InitialBin: '400000', FinalBin: '499999', ProductId: 1 },  // Visa crédito
      { InitialBin: '500000', FinalBin: '509999', ProductId: 2 },  // Mastercard débito
      { InitialBin: '510000', FinalBin: '559999', ProductId: 1 },
      { InitialBin: '600000', FinalBin: '659999', ProductId: 2 }
    ],
    Products: [
      { ProductId: 1, ProductName: 'Credito a vista', ProductType: 0 },
      { ProductId: 2, ProductName: 'Debito a vista', ProductType: 1 }
    ],
    Emv: [
      { Aid: 'A0000000031010', ProductId: 1, TagsFirst: '9F029F03', TagsSecond: '9F26' },
      { Aid: 'A0000000041010', ProductId: 1, TagsFirst: '9F029F03', TagsSecond: '9F26' },
      { Aid: 'A0000000032010', ProductId: 2, TagsFirst: '9F029F03', TagsSecond: '9F26' },
      { Aid: 'A0000000043060', ProductId: 2, TagsFirst: '9F029F03', TagsSecond: '9F26' }
    ],
    Issuers: [],
    Parameters: {},
    AidParameters: [],
    PublicKeys: []
  };
}

/**
 * Reproduz os atalhos de teste documentados para o Sandbox, onde os CENTAVOS do valor
 * determinam o desfecho: 10 → Aprovado, 11 → Negado, 12 → Timeout, 19 → Erro.
 * Qualquer outro valor é aprovado (equivalente ao comportamento de valor "redondo" da
 * Homologação, que aprova para qualquer bandeira).
 */
function simulateAuthorization({ merchantOrder, amountCents, appType, card, dateTime }) {
  const cents = amountCents % 100;
  const isDebit = appType === '02';

  if (cents === 12) {
    const err = new Error('Timeout simulado na autorização Cielo (centavos = 12).');
    err.simulatedOutcome = 'TIMEOUT';
    throw err;
  }
  if (cents === 19) {
    const err = new Error('Erro simulado na autorização Cielo (centavos = 19).');
    err.simulatedOutcome = 'ERROR';
    throw err;
  }

  const approved = cents !== 11;
  const nsu = String(Math.floor(100000000 + Math.random() * 900000000));

  return {
    approved,
    status: approved ? 'APPROVED' : 'DENIED',
    rawStatus: approved ? 'Approved' : 'Denied',
    simulated: true,
    merchantOrderId: merchantOrder,
    paymentId: `SIM-${merchantOrder}`,
    amount: amountCents / 100,
    productId: isDebit ? 2 : 1,
    productType: isDebit ? 1 : 0,
    paymentType: isDebit ? 'PhysicalDebitCard' : 'PhysicalCreditCard',
    returnCode: approved ? '00' : '51',
    returnMessage: approved ? 'Transacao aprovada' : 'Saldo/limite insuficiente',
    emvResponseData: null,
    nsu: approved ? nsu : null,
    authCode: approved ? String(Math.floor(100000 + Math.random() * 900000)) : null,
    cardBrand: card.cardBrand || (isDebit ? 'Mastercard' : 'Visa'),
    receipt: {
      MerchantReceipt: `CAPAXERO IOT\nVIA ESTABELECIMENTO\n${isDebit ? 'DEBITO' : 'CREDITO'} A VISTA\nNSU ${nsu}\n${dateTime}`,
      CustomerReceipt: `CAPAXERO IOT\nVIA CLIENTE\n${isDebit ? 'DEBITO' : 'CREDITO'} A VISTA\nNSU ${nsu}\n${dateTime}`
    },
    links: {}
  };
}

module.exports = {
  // configuração / diagnóstico
  getConfigStatus,
  isSimulator,
  // autenticação
  getAccessToken,
  // inicialização
  getInitialization,
  getPinpadTables,
  // produto
  resolveProduct,
  // transação
  authorizeCardSale,
  confirmSale,
  reverseSale,
  // utilitários compartilhados com as rotas
  generateMerchantOrderId,
  formatPaymentDateTime,
  toCents
};
