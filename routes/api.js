/**
 * Capaxero Cloud — Rotas da API REST para o Totem Android
 * Compatível com especificações SPEC-INT-001, SPEC-INT-002, 03_web_backend_totem_integration_guide.md
 * Suporte completo a telemetria, cupons, sincronização de transações, auto-registro e parametrização.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const QRCode = require('qrcode');
const store = require('../services/store');
const wsManager = require('../services/websocket');
const { sanitizeCpf, isValidCpf, formatCpf, COUPON_CPF_ENABLED } = require('../services/cpf');

// Configuração do Storage para Vídeos de Higienização
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../public/uploads/videos');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const devno = (req.params.devno || req.params.totemId || 'totem').replace(/[^a-zA-Z0-9_-]/g, '_');
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `${devno}_cleaning_${Date.now()}${ext}`);
  }
});

const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: 150 * 1024 * 1024 }, // Até 150 MB
  fileFilter: (req, file, cb) => {
    const allowedExts = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;
    if (allowedExts.test(file.originalname) || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Formato de arquivo inválido. Apenas vídeos (.mp4, .webm, .mov, etc.) são permitidos.'));
    }
  }
});

/**
 * GET /api/v1/health ou /api/v1/totems/ping
 * Healthcheck rápido para teste de conexão pelo totem
 */
router.get(['/health', '/totems/ping'], (req, res) => {
  return res.json({
    status: 'online',
    serverTime: Date.now(),
    message: 'Backend Capaxero Cloud operacional',
    totemsConnected: store.getTotemsList().length
  });
});

/**
 * POST /api/v1/totem/login ou /api/v1/totems/register
 * Autentica e auto-registra o Totem pelo ID único (devno / totemId)
 */
router.post(['/totem/login', '/totems/register'], (req, res) => {
  const { devno, totemId, name, machineName, appVersion, macAddress, ip } = req.body;
  const id = devno || totemId;

  if (!id) {
    return res.status(400).json({
      code: -1,
      success: false,
      message: 'Parâmetro obrigatório "devno" ou "totemId" não fornecido.'
    });
  }

  const totem = store.upsertTotem({
    devno: id,
    name: name || machineName || `Totem #${id}`,
    appVersion: appVersion || 'v1.0.0',
    macAddress: macAddress || '00:00:00:00:00:00',
    ip: ip || req.ip,
    status: 'IDLE'
  });

  wsManager.broadcastDashboardUpdate();
  wsManager.broadcastToDashboard('TOTEM_HEARTBEAT', { devno: id, totem });

  return res.json({
    code: 0,
    success: true,
    message: 'Totem autenticado e registrado com sucesso.',
    data: {
      devno: totem.devno,
      totemId: totem.devno,
      name: totem.name,
      token: 'CPX_AUTH_TOKEN_' + Buffer.from(id).toString('base64'),
      config: totem.config,
      serverTime: new Date().toISOString()
    }
  });
});

/**
 * GET /api/v1/totem/config/:devno ou /api/v1/totems/:totemId/config
 * Retorna as configurações de preços, tempos de ciclo e métodos de pagamento para o totem
 */
router.get(['/totem/config/:devno', '/totems/:totemId/config'], (req, res) => {
  const devno = req.params.devno || req.params.totemId;
  const totem = store.getTotem(devno) || store.upsertTotem({ devno });
  const c = totem.config || {};
  const currentModes = c.modes || {};

  const basicPriceInCents = c.basicPrice !== undefined ? Math.round(Number(c.basicPrice) * 100) : (currentModes.basica?.priceInCents || 1400);
  const interPriceInCents = c.intermediatePrice !== undefined ? Math.round(Number(c.intermediatePrice) * 100) : (currentModes.intermediaria?.priceInCents || 1700);
  const advPriceInCents = c.advancedPrice !== undefined ? Math.round(Number(c.advancedPrice) * 100) : (currentModes.avancada?.priceInCents || 2000);

  const modes = {
    basica: {
      isEnabled: c.basicEnabled !== undefined ? Boolean(c.basicEnabled) : (currentModes.basica?.isEnabled !== false),
      priceInCents: basicPriceInCents,
      uvSeconds: c.basicUvTime !== undefined ? Number(c.basicUvTime) : (currentModes.basica?.uvSeconds || 60),
      mistSpraySeconds: c.basicSmokeControlTime !== undefined ? Number(c.basicSmokeControlTime) : (currentModes.basica?.mistSpraySeconds || 15),
      mistSaturationSeconds: currentModes.basica?.mistSaturationSeconds || 45,
      thermalDryingSeconds: c.basicDryingTime !== undefined ? Number(c.basicDryingTime) : (currentModes.basica?.thermalDryingSeconds || 120),
      ozoneExhaustSeconds: c.basicExhaustTime !== undefined ? Number(c.basicExhaustTime) : (currentModes.basica?.ozoneExhaustSeconds || 115),
      fragranceSeconds: currentModes.basica?.fragranceSeconds || 5
    },
    intermediaria: {
      isEnabled: c.interEnabled !== undefined ? Boolean(c.interEnabled) : (currentModes.intermediaria?.isEnabled !== false),
      priceInCents: interPriceInCents,
      uvSeconds: c.interUvTime !== undefined ? Number(c.interUvTime) : (currentModes.intermediaria?.uvSeconds || 75),
      mistSpraySeconds: c.interSmokeControlTime !== undefined ? Number(c.interSmokeControlTime) : (currentModes.intermediaria?.mistSpraySeconds || 20),
      mistSaturationSeconds: currentModes.intermediaria?.mistSaturationSeconds || 45,
      thermalDryingSeconds: c.interDryingTime !== undefined ? Number(c.interDryingTime) : (currentModes.intermediaria?.thermalDryingSeconds || 150),
      ozoneExhaustSeconds: c.interExhaustTime !== undefined ? Number(c.interExhaustTime) : (currentModes.intermediaria?.ozoneExhaustSeconds || 125),
      fragranceSeconds: currentModes.intermediaria?.fragranceSeconds || 5
    },
    avancada: {
      isEnabled: c.advEnabled !== undefined ? Boolean(c.advEnabled) : (currentModes.avancada?.isEnabled !== false),
      priceInCents: advPriceInCents,
      uvSeconds: c.advUvTime !== undefined ? Number(c.advUvTime) : (currentModes.avancada?.uvSeconds || 90),
      mistSpraySeconds: c.advSmokeControlTime !== undefined ? Number(c.advSmokeControlTime) : (currentModes.avancada?.mistSpraySeconds || 25),
      mistSaturationSeconds: currentModes.avancada?.mistSaturationSeconds || 45,
      thermalDryingSeconds: c.advDryingTime !== undefined ? Number(c.advDryingTime) : (currentModes.avancada?.thermalDryingSeconds || 180),
      ozoneExhaustSeconds: c.advExhaustTime !== undefined ? Number(c.advExhaustTime) : (currentModes.avancada?.ozoneExhaustSeconds || 135),
      fragranceSeconds: currentModes.avancada?.fragranceSeconds || 5
    }
  };

  const paymentMethods = c.paymentMethods || {
    isPixEnabled: c.isPixEnabled !== undefined ? c.isPixEnabled : true,
    isCreditEnabled: c.isCreditEnabled !== undefined ? c.isCreditEnabled : true,
    isDebitEnabled: c.isDebitEnabled !== undefined ? c.isDebitEnabled : true,
    isCouponsEnabled: c.isCouponsEnabled !== undefined ? c.isCouponsEnabled : true
  };

  return res.json({
    code: 0,
    success: true,
    data: {
      totemId: totem.devno,
      devno: totem.devno,
      machineName: totem.name,
      modes,
      paymentMethods,
      prices: {
        basic: (modes.basica.priceInCents / 100),
        intermediate: (modes.intermediaria.priceInCents / 100),
        advanced: (modes.avancada.priceInCents / 100),
        currency: 'BRL'
      },
      durations: {
        basicSec: modes.basica.uvSeconds + modes.basica.mistSpraySeconds + modes.basica.mistSaturationSeconds + modes.basica.thermalDryingSeconds + modes.basica.ozoneExhaustSeconds + modes.basica.fragranceSeconds,
        intermediateSec: modes.intermediaria.uvSeconds + modes.intermediaria.mistSpraySeconds + modes.intermediaria.mistSaturationSeconds + modes.intermediaria.thermalDryingSeconds + modes.intermediaria.ozoneExhaustSeconds + modes.intermediaria.fragranceSeconds,
        advancedSec: modes.avancada.uvSeconds + modes.avancada.mistSpraySeconds + modes.avancada.mistSaturationSeconds + modes.avancada.thermalDryingSeconds + modes.avancada.ozoneExhaustSeconds + modes.avancada.fragranceSeconds
      },
      hardware: {
        serialPort: '/dev/ttyS0',
        baudRate: 9600,
        doorHoldTimeSec: 60,
        emergencyVentTimeSec: 5
      },
      cleaningVideoUrl: c.cleaningVideoUrl || null,
      coupons: store.getCouponsList(),
      // Credenciais E-commerce/PIX enviadas ao totem. A fonte principal é o que o painel
      // grava em config.cielo.ecommerce* — antes só se lia c.cieloMerchantId da raiz, que
      // o painel nunca preenche, e a máquina acabava recebendo a credencial de sandbox
      // embutida no código. `environment` vai junto para o totem saber se, no fallback
      // offline, deve falar com o host de produção ou o de sandbox da Cielo.
      cieloConfig: {
        merchantId: (c.cielo && c.cielo.ecommerceMerchantId) || c.cieloMerchantId ||
          store.getSystemSettings().defaultCieloMerchantId || "5e4fc2b8-11e3-4f9c-ab97-fb7baaea405b",
        merchantKey: (c.cielo && c.cielo.ecommerceMerchantKey) || c.cieloMerchantKey ||
          store.getSystemSettings().defaultCieloMerchantKey || "FMnlYedXdu5Xoa5n3hczfHh8yAMbYF7logQQ4qPL",
        environment: (c.cielo && c.cielo.ecommerceEnvironment) || 'Homologacao'
      },
      serverTime: Date.now()
    }
  });
});

/**
 * POST /api/v1/totems/:totemId/video ou /api/v1/totem/:devno/video
 * Upload de vídeo personalizado para exibição durante a higienização da máquina
 */
router.post(['/totems/:totemId/video', '/totem/:devno/video', '/totem/video/:devno'], videoUpload.single('video'), (req, res) => {
  const devno = req.params.totemId || req.params.devno;
  if (!devno) {
    return res.status(400).json({ success: false, message: 'Código da máquina é obrigatório.' });
  }

  let videoUrl = null;
  if (req.file) {
    videoUrl = `/uploads/videos/${req.file.filename}`;
  } else if (req.body && req.body.videoUrl) {
    videoUrl = req.body.videoUrl.trim();
  }

  if (!videoUrl) {
    return res.status(400).json({ success: false, message: 'Nenhum arquivo de vídeo ou URL fornecido.' });
  }

  const totem = store.getTotem(devno) || store.upsertTotem({ devno });
  const updatedTotem = store.updateTotemConfig(devno, { cleaningVideoUrl: videoUrl }, 'CRPADMIN');

  // Notifica o totem via WebSocket
  wsManager.sendCommandToTotem(devno, 'CLEANING_VIDEO_UPDATED', { videoUrl });
  wsManager.sendCommandToTotem(devno, 'CONFIG_UPDATED', {
    config: updatedTotem.config,
    cleaningVideoUrl: videoUrl
  });
  wsManager.broadcastDashboardUpdate();

  return res.json({
    code: 0,
    success: true,
    message: 'Vídeo de higienização enviado e vinculado à máquina com sucesso!',
    data: {
      devno,
      videoUrl,
      config: updatedTotem.config
    }
  });
});

/**
 * DELETE /api/v1/totems/:totemId/video ou /api/v1/totem/:devno/video
 * Remove o vídeo customizado da máquina e restaura a animação padrão
 */
router.delete(['/totems/:totemId/video', '/totem/:devno/video', '/totem/video/:devno'], (req, res) => {
  const devno = req.params.totemId || req.params.devno;
  const totem = store.getTotem(devno);

  if (totem && totem.config && totem.config.cleaningVideoUrl) {
    const oldUrl = totem.config.cleaningVideoUrl;
    if (oldUrl.startsWith('/uploads/videos/')) {
      const filePath = path.join(__dirname, '../public', oldUrl);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (_) {}
      }
    }
  }

  const updatedTotem = store.updateTotemConfig(devno, { cleaningVideoUrl: null }, 'CRPADMIN');
  wsManager.sendCommandToTotem(devno, 'CLEANING_VIDEO_UPDATED', { videoUrl: null });
  wsManager.broadcastDashboardUpdate();

  return res.json({
    code: 0,
    success: true,
    message: 'Vídeo customizado removido. Máquina restaurada para a animação padrão.',
    data: { devno, videoUrl: null }
  });
});

/**
 * PUT /api/v1/totems/:totemId/config ou /api/v1/totem/config/:devno
 * Atualiza configurações enviadas pelo totem ou operador
 */
router.put(['/totems/:totemId/config', '/totem/config/:devno'], (req, res) => {
  const devno = req.params.totemId || req.params.devno;
  const configData = req.body;

  const totem = store.getTotem(devno) || store.upsertTotem({ devno });
  const updatedTotem = store.updateTotemConfig(devno, configData, 'CRPADMIN');

  // Envia comando de atualização de configuração e recarga para o totem conectado
  wsManager.sendCommandToTotem(devno, 'CONFIG_UPDATED', {
    config: updatedTotem.config,
    modes: updatedTotem.config.modes,
    paymentMethods: updatedTotem.config.paymentMethods
  });
  wsManager.sendCommandToTotem(devno, 'RELOAD_CONFIG', {});
  wsManager.broadcastDashboardUpdate();

  return res.json({
    code: 0,
    success: true,
    message: 'Configurações do totem atualizadas e persistidas no banco com sucesso.',
    data: updatedTotem.config
  });
});

/**
 * GET /api/v1/app/version
 * Versão publicada do APK do totem, para a atualização pelo botão do Painel do Operador.
 *
 * A URL de download é montada a partir do host da própria requisição: assim o totem recebe
 * o endereço por onde ele já está falando (túnel Cloudflare, IP da LAN, domínio próprio) sem
 * precisar de nenhuma configuração extra.
 */
const APP_DOWNLOAD_DIR = path.join(__dirname, '../public/downloads');
const appVersionCache = { mtimeMs: 0, sha256: null };

router.get(['/app/version', '/app/latest'], (req, res) => {
  try {
    const manifestPath = path.join(APP_DOWNLOAD_DIR, 'app-version.json');
    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({
        code: -1, success: false,
        message: 'Nenhuma versão do aplicativo publicada no servidor.'
      });
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const apkName = manifest.apkFile || 'capaxero-totem.apk';
    const apkPath = path.join(APP_DOWNLOAD_DIR, apkName);

    if (!fs.existsSync(apkPath)) {
      return res.status(404).json({
        code: -1, success: false,
        message: `Manifesto aponta para "${apkName}", mas o arquivo não está em public/downloads.`
      });
    }

    const stat = fs.statSync(apkPath);

    // O hash só é recalculado quando o APK muda — são ~48 MB, não dá para reler a cada consulta.
    if (appVersionCache.mtimeMs !== stat.mtimeMs || !appVersionCache.sha256) {
      appVersionCache.sha256 = crypto.createHash('sha256').update(fs.readFileSync(apkPath)).digest('hex');
      appVersionCache.mtimeMs = stat.mtimeMs;
    }

    // Atrás do túnel/proxy o esquema real vem no cabeçalho; req.protocol diria "http".
    const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;

    return res.json({
      code: 0,
      success: true,
      data: {
        versionCode: Number(manifest.versionCode) || 0,
        versionName: manifest.versionName || '0.0.0',
        notes: manifest.notes || '',
        downloadUrl: `${proto}://${host}/downloads/${encodeURIComponent(apkName)}`,
        sizeBytes: stat.size,
        sha256: appVersionCache.sha256,
        publishedAt: stat.mtime.toISOString()
      }
    });
  } catch (err) {
    return res.status(500).json({ code: -1, success: false, message: err.message });
  }
});

/**
 * POST /api/v1/telemetry/heartbeat ou /api/v1/totem/heartbeat
 * Recebe a telemetria periódica do totem (sensores, porta, status, níveis) e auto-cadastra a máquina
 */
router.post(['/telemetry/heartbeat', '/totem/heartbeat'], (req, res) => {
  const {
    devno,
    totemId,
    status,
    machineState,
    currentPhase,
    doorLocked,
    isDoorClosed,
    liquidLevelPercent,
    isLiquidLevelOk,
    currentCycle,
    appVersion
  } = req.body;
  // Nota: "temperature"/"temperatureCelsius" e "fragranceLevelPercent" chegam do totem, mas a
  // máquina não tem sensor de temperatura nem de nível de fragrância (só porta e líquido — ver
  // Upus3Packet.kt no APK) — esses campos são ignorados de propósito para não persistir números
  // fabricados como se fossem leitura real de sensor.

  const id = devno || totemId;
  if (!id) {
    return res.status(400).json({ code: -1, success: false, message: 'Campo "devno" ou "totemId" é obrigatório.' });
  }

  const doorState = doorLocked !== undefined ? doorLocked : (isDoorClosed !== undefined ? isDoorClosed : true);
  let liquidState = liquidLevelPercent;
  if (liquidState === undefined && isLiquidLevelOk !== undefined) {
    liquidState = isLiquidLevelOk ? 100 : 10;
  }

  const effectiveStatus = status || (machineState ? (machineState.includes('CLEAN') ? 'CLEANING' : (machineState === 'MAINTENANCE' ? 'MAINTENANCE' : 'IDLE')) : 'IDLE');

  const updated = store.updateHeartbeat(id, {
    devno: id,
    status: effectiveStatus,
    doorLocked: doorState,
    liquidLevelPercent: liquidState !== undefined ? liquidState : 100,
    currentCycle: currentCycle || (currentPhase ? { step: currentPhase } : null),
    appVersion: appVersion || '1.0.0'
  });

  // Notifica o dashboard via WebSocket para aparecer imediatamente como máquina online
  wsManager.broadcastToDashboard('TOTEM_HEARTBEAT', { devno: id, totem: updated });

  return res.json({
    code: 0,
    success: true,
    message: 'Heartbeat registrado.',
    data: {
      serverTime: new Date().toISOString(),
      timestamp: Date.now(),
      activeCommands: []
    }
  });
});

/**
 * POST /api/v1/telemetry/alerts ou /api/v1/totem/alert
 * Registra alertas e avisos técnicos de segurança da máquina
 */
router.post(['/telemetry/alerts', '/totem/alert'], (req, res) => {
  const { devno, totemId, type, alertType, severity, message, description } = req.body;
  const id = devno || totemId;

  if (!id || (!type && !alertType)) {
    return res.status(400).json({ code: -1, success: false, message: 'Identificador do totem e tipo de alerta são obrigatórios.' });
  }

  const totem = store.getTotem(id) || store.upsertTotem({ devno: id });
  const alert = store.addAlert({
    devno: id,
    totemName: totem ? totem.name : `Totem #${id}`,
    type: alertType || type,
    severity: severity || 'WARNING',
    message: description || message || `Alerta técnico disparado pelo totem ${id}`
  });

  if (totem && severity === 'CRITICAL') {
    totem.status = 'ERROR';
  }

  wsManager.broadcastToDashboard('NEW_ALERT', { alert, stats: store.getStats() });

  return res.json({
    code: 0,
    success: true,
    message: 'Alerta registrado na central.',
    data: { alertId: alert.id }
  });
});

/**
 * POST /api/v1/transactions/sync ou /api/v1/telemetry/transactions
 * Sincronização em lote ou individual de vendas acumuladas no totem
 */
router.post(['/transactions/sync', '/telemetry/transactions'], (req, res) => {
  const { devno, totemId, transactions, orderId, amountInCents, amount, paymentMethod, modeTitle, nsu, authCode, timestamp } = req.body;
  const id = devno || totemId;

  if (!id) {
    return res.status(400).json({ code: -1, success: false, message: 'Campo "devno" ou "totemId" é obrigatório.' });
  }

  const totem = store.getTotem(id) || store.upsertTotem({ devno: id });
  const syncedOrderIds = [];

  // Se veio lista de transações
  if (Array.isArray(transactions)) {
    for (const tx of transactions) {
      const txRecord = store.addTransaction({
        orderId: tx.orderId,
        devno: id,
        totemName: totem ? totem.name : `Totem #${id}`,
        mode: tx.modeTitle || tx.mode || 'INTERMEDIARIA',
        amount: (tx.amountInCents ? (tx.amountInCents / 100) : (tx.amount || 17.0)),
        paymentMethod: tx.paymentMethod || 'CARTAO',
        nsu: tx.nsu || '',
        authCode: tx.authCode || '',
        status: 'APPROVED',
        timestamp: tx.timestamp ? new Date(tx.timestamp).toISOString() : new Date().toISOString()
      });

      syncedOrderIds.push(tx.orderId);

      wsManager.broadcastToDashboard('NEW_TRANSACTION', {
        transaction: txRecord,
        totem: store.getTotem(id),
        stats: store.getStats()
      });
    }
  } else if (orderId) {
    // Transação única
    const txRecord = store.addTransaction({
      orderId: orderId,
      devno: id,
      totemName: totem ? totem.name : `Totem #${id}`,
      mode: modeTitle || 'INTERMEDIARIA',
      amount: (amountInCents ? (amountInCents / 100) : (amount || 17.0)),
      paymentMethod: paymentMethod || 'CARTAO',
      nsu: nsu || '',
      authCode: authCode || '',
      status: 'APPROVED',
      timestamp: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString()
    });

    syncedOrderIds.push(orderId);

    wsManager.broadcastToDashboard('NEW_TRANSACTION', {
      transaction: txRecord,
      totem: store.getTotem(id),
      stats: store.getStats()
    });
  }

  return res.json({
    code: 0,
    success: true,
    syncedOrderIds,
    message: `${syncedOrderIds.length} transações sincronizadas com sucesso.`
  });
});

/**
 * POST /api/v1/totem/cycle-complete
 * Registra a finalização de um ciclo de higienização
 */
router.post('/totem/cycle-complete', (req, res) => {
  const { devno, totemId, orderId, mode, durationSeconds, amount, paymentMethod } = req.body;
  const id = devno || totemId;

  if (!id) {
    return res.status(400).json({ code: -1, success: false, message: 'Campo "devno" ou "totemId" é obrigatório.' });
  }

  const totem = store.recordCycleComplete(id, {
    orderId,
    mode,
    durationSeconds,
    amount,
    paymentMethod
  });

  wsManager.broadcastToDashboard('CYCLE_COMPLETED', {
    devno: id,
    totem,
    cycle: { orderId, mode, durationSeconds, amount, paymentMethod },
    stats: store.getStats()
  });

  return res.json({
    code: 0,
    success: true,
    message: 'Ciclo registrado no servidor com sucesso.',
    data: {
      totemTotalCyclesToday: totem ? totem.totalCyclesToday : 0
    }
  });
});

/**
 * GET /api/v1/coupons
 * Lista todos os cupons cadastrados na central
 */
router.get('/coupons', (req, res) => {
  const list = store.getCouponsList();
  return res.json({
    code: 0,
    success: true,
    data: list
  });
});

/**
 * POST /api/v1/coupons
 * Cria ou atualiza um cupom com definição de quantidade de usos
 */
router.post('/coupons', (req, res) => {
  const {
    code, description, discountPercent, applicableMode,
    maxUsages, allowedTotems, maxUsagesPerCpf, requireCpf
  } = req.body;

  if (!code) {
    return res.status(400).json({ success: false, message: 'Código do cupom é obrigatório.' });
  }

  try {
    const coupon = store.addCoupon({
      code,
      description,
      discountPercent,
      applicableMode,
      allowedTotems,
      maxUsages,
      maxUsagesPerCpf,
      requireCpf
    });

    wsManager.broadcastDashboardUpdate();
    wsManager.broadcastToTotems('COUPONS_UPDATED', { coupons: store.getCouponsList() });

    return res.json({
      code: 0,
      success: true,
      message: 'Cupom cadastrado com sucesso!',
      data: coupon
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * PUT /api/v1/coupons/:code
 * Edita um cupom existente preservando os usos e os CPFs já registrados
 */
router.put('/coupons/:code', (req, res) => {
  const { code } = req.params;
  const existing = store.getCoupon(code);

  if (!existing) {
    return res.status(404).json({ success: false, message: 'Cupom não encontrado para edição.' });
  }

  const {
    description, discountPercent, applicableMode,
    maxUsages, allowedTotems, maxUsagesPerCpf, requireCpf
  } = req.body;

  try {
    // Campos omitidos mantêm o valor atual do cupom
    const coupon = store.addCoupon({
      code: existing.code,
      description: description !== undefined ? description : existing.description,
      discountPercent: discountPercent !== undefined ? discountPercent : existing.discountPercent,
      applicableMode: applicableMode !== undefined ? applicableMode : existing.applicableMode,
      allowedTotems: allowedTotems !== undefined ? allowedTotems : existing.allowedTotems,
      maxUsages: maxUsages !== undefined ? maxUsages : existing.maxUsages,
      maxUsagesPerCpf: maxUsagesPerCpf !== undefined ? maxUsagesPerCpf : existing.maxUsagesPerCpf,
      requireCpf: requireCpf !== undefined ? requireCpf : existing.requireCpf
    });

    wsManager.broadcastDashboardUpdate();
    wsManager.broadcastToTotems('COUPONS_UPDATED', { coupons: store.getCouponsList() });

    return res.json({
      code: 0,
      success: true,
      message: `Cupom ${coupon.code} atualizado com sucesso!`,
      data: coupon
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/v1/coupons/:code/redemptions/:id
 * Remove o registro de um CPF, liberando-o para utilizar o cupom novamente
 */
router.delete('/coupons/:code/redemptions/:id', (req, res) => {
  const { code, id } = req.params;
  const updated = store.removeCouponRedemption(code, id);

  if (!updated) {
    return res.status(404).json({ success: false, message: 'Registro de CPF não encontrado.' });
  }

  wsManager.broadcastDashboardUpdate();
  wsManager.broadcastToTotems('COUPONS_UPDATED', { coupons: store.getCouponsList() });

  return res.json({
    code: 0,
    success: true,
    message: 'CPF liberado para utilizar o cupom novamente.',
    data: {
      code: updated.code,
      currentUsages: updated.currentUsages,
      remainingRedemptions: (updated.redemptions || []).length
    }
  });
});

/**
 * DELETE /api/v1/coupons/:code
 * Exclui um cupom
 */
router.delete('/coupons/:code', (req, res) => {
  const { code } = req.params;
  const deleted = store.deleteCoupon(code);

  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Cupom não encontrado para exclusão.' });
  }

  wsManager.broadcastDashboardUpdate();
  wsManager.broadcastToTotems('COUPONS_UPDATED', { coupons: store.getCouponsList() });

  return res.json({
    code: 0,
    success: true,
    message: 'Cupom excluído com sucesso.'
  });
});

/**
 * POST /api/v1/coupons/:code/reset
 * Restaura contagem de usos de um cupom específico
 */
router.post('/coupons/:code/reset', (req, res) => {
  const { code } = req.params;
  const reset = store.resetCoupon(code);

  if (!reset) {
    return res.status(404).json({ success: false, message: 'Cupom não encontrado.' });
  }

  wsManager.broadcastDashboardUpdate();
  wsManager.broadcastToTotems('COUPONS_UPDATED', { coupons: store.getCouponsList() });

  return res.json({
    code: 0,
    success: true,
    message: `Usos do cupom ${code} resetados para 0.`,
    data: reset
  });
});

/**
 * GET /api/v1/coupons/:code
 * Consulta e validação de cupom pelo totem
 */
router.get('/coupons/:code', (req, res) => {
  const { code } = req.params;
  const coupon = store.getCoupon(code);

  if (!coupon) {
    return res.status(404).json({
      code: 404,
      success: false,
      error: 'COUPON_NOT_FOUND',
      message: 'Cupom não cadastrado ou expirado'
    });
  }

  const reqTotem = (req.query.totemId || req.query.totem || '').trim().toUpperCase();
  if (coupon.allowedTotems && coupon.allowedTotems.length > 0 && reqTotem) {
    const isAllowed = coupon.allowedTotems.some(t => {
      const u = String(t).toUpperCase().trim();
      return u === reqTotem || u === 'TODAS' || u === 'TODOS' || u === '' || reqTotem.includes(u) || u.includes(reqTotem);
    });
    if (!isAllowed) {
      return res.status(403).json({
        code: 403,
        success: false,
        error: 'COUPON_NOT_ALLOWED_ON_THIS_TOTEM',
        message: `Este cupom não é válido para a máquina ${reqTotem}.`
      });
    }
  }

  const max = coupon.maxUsages || 9999;
  const curr = coupon.currentUsages || 0;
  const isUsed = curr >= max || Boolean(coupon.isUsed);

  // ---- Controle por CPF ----
  // Etapa de CPF desligada em services/cpf.js: nenhum cupom exige CPF enquanto isso.
  const requireCpf = COUPON_CPF_ENABLED && coupon.requireCpf !== false;
  const maxUsagesPerCpf = Number(coupon.maxUsagesPerCpf) > 0 ? Number(coupon.maxUsagesPerCpf) : 1;
  const rawCpf = req.query.cpf || req.query.document || '';
  const cleanCpf = sanitizeCpf(rawCpf);

  if (requireCpf && !cleanCpf) {
    return res.status(428).json({
      code: 428,
      success: false,
      error: 'COUPON_CPF_REQUIRED',
      message: 'Informe o CPF do cliente para validar este cupom.',
      requireCpf: true,
      maxUsagesPerCpf
    });
  }

  if (cleanCpf && !isValidCpf(cleanCpf)) {
    return res.status(422).json({
      code: 422,
      success: false,
      error: 'COUPON_CPF_INVALID',
      message: 'CPF inválido. Confira os números digitados.',
      requireCpf,
      maxUsagesPerCpf
    });
  }

  const cpfUsages = cleanCpf ? store.countCpfUsages(coupon, cleanCpf) : 0;
  if (cleanCpf && cpfUsages >= maxUsagesPerCpf) {
    return res.status(409).json({
      code: 409,
      success: false,
      error: 'COUPON_CPF_LIMIT_REACHED',
      message: maxUsagesPerCpf === 1
        ? `O CPF ${formatCpf(cleanCpf)} já utilizou este cupom.`
        : `O CPF ${formatCpf(cleanCpf)} já utilizou este cupom ${cpfUsages} de ${maxUsagesPerCpf} vezes permitidas.`,
      requireCpf,
      maxUsagesPerCpf,
      cpfUsages
    });
  }

  let normMode = null;
  if (coupon.applicableMode) {
    const upper = String(coupon.applicableMode).toUpperCase();
    if (upper.includes('BASIC')) normMode = 'BASICA';
    else if (upper.includes('INTER')) normMode = 'INTERMEDIARIA';
    else if (upper.includes('AVAN')) normMode = 'AVANCADA';
    else normMode = null;
  }

  const payload = {
    code: coupon.code,
    description: coupon.description || `Desconto de ${coupon.discountPercent}%`,
    discountPercent: Number(coupon.discountPercent) || 0,
    applicableMode: normMode,
    allowedTotems: coupon.allowedTotems || null,
    isUsed: isUsed,
    maxUsages: max,
    currentUsages: curr,
    requireCpf,
    maxUsagesPerCpf,
    cpfUsages,
    cpfRemaining: Math.max(0, maxUsagesPerCpf - cpfUsages)
  };

  return res.json({
    ...payload,
    success: true,
    data: payload
  });
});

/**
 * GET /api/v1/coupons/:code/qrcode
 * GET /api/v1/coupons/:code/qrcode.png
 * GET /api/v1/coupons/:code/qrcode.svg
 * GET /api/v1/coupons/:code/qrcode-data
 * Gera o QR Code escaneável do cupom para leitura no leitor óptico do Totem
 */
router.get(['/coupons/:code/qrcode', '/coupons/:code/qrcode.png'], async (req, res) => {
  try {
    const { code } = req.params;
    const format = req.query.format || (req.path.endsWith('.svg') ? 'svg' : 'png');

    // Se solicitado formato JSON com DataURL
    if (format === 'json' || req.query.json === 'true') {
      const dataUrl = await QRCode.toDataURL(code.toUpperCase(), {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: Number(req.query.size) || 360,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });
      return res.json({ success: true, code: code.toUpperCase(), dataUrl });
    }

    if (format === 'svg') {
      const svg = await QRCode.toString(code.toUpperCase(), {
        type: 'svg',
        margin: 2,
        errorCorrectionLevel: 'M'
      });
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(svg);
    }

    // Default: Imagem PNG binária
    const buffer = await QRCode.toBuffer(code.toUpperCase(), {
      type: 'png',
      margin: 2,
      width: Number(req.query.size) || 360,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="coupon_${code.toUpperCase()}_qrcode.png"`);
    return res.send(buffer);
  } catch (err) {
    return res.status(500).json({ success: false, error: 'QRCODE_GEN_ERROR', message: err.message });
  }
});

router.get('/coupons/:code/qrcode.svg', async (req, res) => {
  try {
    const { code } = req.params;
    const svg = await QRCode.toString(code.toUpperCase(), {
      type: 'svg',
      margin: 2,
      errorCorrectionLevel: 'M'
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(svg);
  } catch (err) {
    return res.status(500).json({ success: false, error: 'QRCODE_GEN_ERROR', message: err.message });
  }
});

router.get('/coupons/:code/qrcode-data', async (req, res) => {
  try {
    const { code } = req.params;
    const dataUrl = await QRCode.toDataURL(code.toUpperCase(), {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: Number(req.query.size) || 360,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    return res.json({ success: true, code: code.toUpperCase(), dataUrl });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'QRCODE_GEN_ERROR', message: err.message });
  }
});

/**
 * POST /api/v1/coupons/:code/redeem
 * Resgate / Baixa de cupom quando ciclo inicia ou pagamento é aprovado
 */
router.post('/coupons/:code/redeem', (req, res) => {
  const { code } = req.params;
  const { totemId, selectedMode, orderId, discountAppliedInCents, cpf } = req.body;

  const result = store.redeemCoupon(code, totemId, {
    selectedMode,
    orderId,
    discountAppliedInCents,
    cpf
  });

  if (!result) {
    return res.status(404).json({
      success: false,
      message: 'Cupom não encontrado para resgate.'
    });
  }

  if (result.error) {
    // Status específicos para o app tratar o bloqueio por CPF
    const statusByError = {
      COUPON_CPF_REQUIRED: 428,
      COUPON_CPF_INVALID: 422,
      COUPON_CPF_LIMIT_REACHED: 409
    };
    return res.status(statusByError[result.error] || 400).json({
      success: false,
      error: result.error,
      message: result.message
    });
  }

  wsManager.broadcastDashboardUpdate();
  wsManager.broadcastToTotems('COUPONS_UPDATED', { coupons: store.getCouponsList() });

  const cleanCpf = sanitizeCpf(cpf);

  return res.json({
    success: true,
    code: result.code,
    currentUsages: result.currentUsages,
    maxUsages: result.maxUsages,
    isUsed: result.isUsed,
    cpf: cleanCpf ? formatCpf(cleanCpf) : null,
    cpfUsages: cleanCpf ? store.countCpfUsages(result, cleanCpf) : 0,
    maxUsagesPerCpf: result.maxUsagesPerCpf || 1,
    message: 'Cupom resgatado com sucesso'
  });
});

/**
 * GET /api/v1/coupons/:code/redemptions
 * Lista os CPFs que já utilizaram o cupom (exibido na aba Cupons do painel)
 */
router.get('/coupons/:code/redemptions', (req, res) => {
  const { code } = req.params;
  const redemptions = store.getCouponRedemptions(code);

  if (!redemptions) {
    return res.status(404).json({ success: false, message: 'Cupom não encontrado.' });
  }

  const coupon = store.getCoupon(code);

  return res.json({
    code: 0,
    success: true,
    data: redemptions.map(r => ({
      ...r,
      cpfFormatted: r.cpfFormatted || (r.cpf ? formatCpf(r.cpf) : '—')
    })),
    summary: {
      couponCode: coupon.code,
      description: coupon.description,
      discountPercent: coupon.discountPercent,
      totalRedemptions: redemptions.length,
      uniqueCpfs: new Set(redemptions.map(r => sanitizeCpf(r.cpf)).filter(Boolean)).size,
      maxUsages: coupon.maxUsages || 1,
      maxUsagesPerCpf: coupon.maxUsagesPerCpf || 1,
      requireCpf: coupon.requireCpf !== false
    }
  });
});

/**
 * GET /api/v1/coupons-redemptions
 * Histórico consolidado de todos os CPFs que utilizaram cupons na rede
 */
router.get('/coupons-redemptions', (req, res) => {
  const rows = store.getAllCouponRedemptions().map(r => ({
    ...r,
    cpfFormatted: r.cpfFormatted || (r.cpf ? formatCpf(r.cpf) : '—')
  }));

  return res.json({
    code: 0,
    success: true,
    data: rows,
    summary: {
      total: rows.length,
      uniqueCpfs: new Set(rows.map(r => sanitizeCpf(r.cpf)).filter(Boolean)).size
    }
  });
});

/**
 * POST /api/v1/coupons/reset-test
 * Restaura cupons de teste para não utilizados (para homologação)
 */
router.post('/coupons/reset-test', (req, res) => {
  const { scope } = req.body;
  const resetCount = store.resetCoupons(scope || 'TEST_COUPONS_ONLY');

  wsManager.broadcastDashboardUpdate();

  return res.json({
    success: true,
    resetCount,
    message: 'Cupons de teste restaurados para estado não utilizado'
  });
});

/**
 * GET /api/v1/settings/cielo
 * Consulta as credenciais Cielo Conect padrão do sistema
 */
router.get('/settings/cielo', (req, res) => {
  const settings = store.getSystemSettings();
  return res.json({
    code: 0,
    success: true,
    data: {
      defaultCieloMerchantId: settings.defaultCieloMerchantId,
      defaultCieloMerchantKey: settings.defaultCieloMerchantKey ? (settings.defaultCieloMerchantKey.slice(0, 4) + '****' + settings.defaultCieloMerchantKey.slice(-4)) : ''
    }
  });
});

/**
 * PUT /api/v1/settings/cielo
 * Atualiza e salva as credenciais Cielo Conect como padrão do sistema
 */
router.put('/settings/cielo', (req, res) => {
  const { defaultCieloMerchantId, defaultCieloMerchantKey, applyToAllTotems } = req.body;

  const updates = {};
  if (defaultCieloMerchantId) updates.defaultCieloMerchantId = defaultCieloMerchantId.trim();
  if (defaultCieloMerchantKey) updates.defaultCieloMerchantKey = defaultCieloMerchantKey.trim();

  const saved = store.updateSystemSettings(updates);

  // Se solicitado, replica como padrão para todos os totens existentes
  if (applyToAllTotems) {
    const totems = store.getTotemsList({ role: 'CRPADMIN' });
    for (const t of totems) {
      const cfg = { ...(t.config || {}) };
      if (defaultCieloMerchantId) cfg.cieloMerchantId = defaultCieloMerchantId.trim();
      if (defaultCieloMerchantKey) cfg.cieloMerchantKey = defaultCieloMerchantKey.trim();
      store.updateTotemConfig(t.devno, cfg, 'CRPADMIN');
      wsManager.sendCommandToTotem(t.devno, 'RELOAD_CONFIG', {});
    }
  }

  wsManager.broadcastDashboardUpdate();

  return res.json({
    code: 0,
    success: true,
    message: 'Credenciais Cielo padrão atualizadas com sucesso!',
    data: {
      defaultCieloMerchantId: saved.defaultCieloMerchantId
    }
  });
});

module.exports = router;
