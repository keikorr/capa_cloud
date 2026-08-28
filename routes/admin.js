/**
 * Capaxero Cloud — Rotas Administrativas e de Controle do Dashboard (com RBAC)
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const store = require('../services/store');
const wsManager = require('../services/websocket');
const { getUserFromToken } = require('./auth');

// Configuração de upload de vídeo para a rota de admin
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../public/uploads/videos');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const devno = (req.params.devno || 'totem').replace(/[^a-zA-Z0-9_-]/g, '_');
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `${devno}_cleaning_${Date.now()}${ext}`);
  }
});

const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExts = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;
    if (allowedExts.test(file.originalname) || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Formato de vídeo inválido. Permitidos: .mp4, .webm, .mov, etc.'));
    }
  }
});

// Middleware auxiliar para extrair o usuário autenticado
function extractUser(req) {
  const token = req.headers.authorization || req.query.token;
  return getUserFromToken(token);
}

/**
 * GET /api/v1/admin/stats
 * Retorna as estatísticas consolidadas (filtradas por dono se for OWNER)
 */
router.get('/admin/stats', (req, res) => {
  const user = extractUser(req);
  return res.json({
    success: true,
    data: store.getStats(user)
  });
});

/**
 * GET /api/v1/admin/branches
 * Lista todas as filiais
 */
router.get('/admin/branches', (req, res) => {
  return res.json({
    success: true,
    data: store.getBranchesList()
  });
});

/**
 * GET /api/v1/admin/depots
 * Lista todos os pontos de instalação (depots) com métricas
 */
router.get('/admin/depots', (req, res) => {
  const user = extractUser(req);
  return res.json({
    success: true,
    data: store.getDepotsList(user)
  });
});

/**
 * POST /api/v1/admin/depots
 * Cadastra um novo ponto de instalação (local)
 */
router.post('/admin/depots', (req, res) => {
  const depot = store.addDepot(req.body || {});
  wsManager.broadcastDashboardUpdate();
  return res.json({ success: true, message: 'Local cadastrado com sucesso.', data: depot });
});

/**
 * DELETE /api/v1/admin/depots/:depotno
 * Exclui um ponto de instalação
 */
router.delete('/admin/depots/:depotno', (req, res) => {
  const { depotno } = req.params;
  const deleted = store.deleteDepot(depotno);
  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Local não encontrado.' });
  }
  wsManager.broadcastDashboardUpdate();
  return res.json({ success: true, message: 'Local excluído com sucesso.' });
});

/**
 * PUT /api/v1/admin/totems/:devno/relocate
 * Move um totem para um novo ponto de instalação (depot)
 */
router.put('/admin/totems/:devno/relocate', (req, res) => {
  const { devno } = req.params;
  const { depotno } = req.body;

  if (!depotno) {
    return res.status(400).json({ success: false, message: 'Campo "depotno" é obrigatório.' });
  }

  const totem = store.getTotem(devno);
  if (!totem) {
    return res.status(404).json({ success: false, message: 'Totem não encontrado.' });
  }

  const result = store.relocateTotem(devno, depotno);
  if (!result) {
    return res.status(404).json({ success: false, message: 'Local de destino não encontrado.' });
  }

  wsManager.broadcastDashboardUpdate();
  return res.json({ success: true, message: 'Estação realocada com sucesso.', data: result.totem });
});

/**
 * PUT /api/v1/admin/totems/:devno/owner
 * PUT /api/v1/admin/totems/:devno/transfer
 * Altera titularidade do totem (Exclusivo para CRPADMIN)
 */
const handleOwnerTransfer = (req, res) => {
  const user = extractUser(req);
  if (user && user.role !== 'CRPADMIN') {
    return res.status(403).json({ success: false, message: 'Acesso negado. Apenas o perfil CRPADMIN pode alterar o dono da máquina.' });
  }

  const { devno } = req.params;
  const target = req.body.owner || req.body.owner_id || req.body.targetUserId || req.body.userId || req.body.target;

  if (!target) {
    return res.status(400).json({ success: false, message: 'O novo dono ou ID do usuário é obrigatório.' });
  }

  try {
    const updated = store.transferTotemOwner(devno, target);
    wsManager.broadcastDashboardUpdate();
    return res.json({
      success: true,
      message: `Máquina ${devno} reatribuída para "${updated.owner}" com sucesso!`,
      data: updated
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

router.put('/admin/totems/:devno/owner', handleOwnerTransfer);
router.put('/admin/totems/:devno/transfer', handleOwnerTransfer);

/**
 * GET /api/v1/admin/owners
 * Lista os donos de máquina cadastrados
 */
router.get('/admin/owners', (req, res) => {
  return res.json({ success: true, data: store.getOwnersList() });
});

/**
 * GET /api/v1/admin/users
 * Exclusivo para CRPADMIN: lista todos os usuários/donos cadastrados com suas máquinas
 */
router.get('/admin/users', (req, res) => {
  const user = extractUser(req);
  if (user && user.role !== 'CRPADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Acesso negado. Apenas o perfil CRPADMIN pode listar todos os cadastros.'
    });
  }

  return res.json({
    success: true,
    data: store.getUsersList()
  });
});

/**
 * DELETE /api/v1/admin/users/:id
 * Exclusivo para CRPADMIN: exclui um usuário/dono
 */
router.delete('/admin/users/:id', (req, res) => {
  const user = extractUser(req);
  if (user && user.role !== 'CRPADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Acesso negado. Apenas o perfil CRPADMIN pode excluir cadastros.'
    });
  }

  const { id } = req.params;
  try {
    const deleted = store.deleteUser(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    }
    wsManager.broadcastDashboardUpdate();
    return res.json({ success: true, message: 'Usuário excluído com sucesso.' });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/v1/admin/income-report
 * Relatório financeiro detalhado por local e últimos 7 dias (com RBAC)
 */
router.get('/admin/income-report', (req, res) => {
  const user = extractUser(req);
  return res.json({
    success: true,
    data: store.getIncomeReport(user)
  });
});

/**
 * GET /api/v1/admin/totems
 * Lista todos os totens registrados (filtrados por dono para perfil OWNER)
 */
router.get('/admin/totems', (req, res) => {
  const user = extractUser(req);
  return res.json({
    success: true,
    data: store.getTotemsList(user)
  });
});

/**
 * POST /api/v1/admin/totems
 * Cadastra um novo totem/estação na plataforma
 */
router.post('/admin/totems', (req, res) => {
  const user = extractUser(req);
  const data = req.body || {};

  const devno = (data.devno || data.totemId || '').trim().toUpperCase();
  if (!devno) {
    return res.status(400).json({ success: false, message: 'Código de Série / DevNo do totem é obrigatório.' });
  }

  // Define dono padrão caso não especificado
  if (!data.owner_id && user) {
    data.owner_id = user.id;
    data.owner = user.responsible_name || user.username;
  }

  const totem = store.upsertTotem({
    ...data,
    devno
  });

  wsManager.broadcastDashboardUpdate();
  return res.json({
    success: true,
    message: `Estação ${devno} cadastrada com sucesso!`,
    data: totem
  });
});

/**
 * DELETE /api/v1/admin/totems/:devno
 * Exclui um totem registrado
 */
router.delete('/admin/totems/:devno', (req, res) => {
  const { devno } = req.params;
  const deleted = store.deleteTotem(devno);

  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Totem não encontrado.' });
  }

  wsManager.broadcastDashboardUpdate();
  return res.json({ success: true, message: `Estação ${devno} excluída com sucesso.` });
});

/**
 * PUT /api/v1/admin/totems/:devno/config
 * Atualiza as configurações de preço, tempo e credenciais Cielo de um totem
 * (Apenas CRPADMIN pode alterar Merchant ID e Merchant Key)
 */
router.put('/admin/totems/:devno/config', (req, res) => {
  const user = extractUser(req);
  const userRole = user ? user.role : 'CRPADMIN';

  const { devno } = req.params;
  const configData = req.body;

  const totem = store.getTotem(devno);
  if (!totem) {
    return res.status(404).json({ success: false, message: 'Totem não encontrado.' });
  }

  const updatedTotem = store.updateTotemConfig(devno, configData, userRole);

  // Envia comando de atualização de configuração para o totem conectado
  wsManager.sendCommandToTotem(devno, 'CONFIG_UPDATED', {
    config: updatedTotem.config,
    modes: updatedTotem.config.modes,
    paymentMethods: updatedTotem.config.paymentMethods
  });
  wsManager.sendCommandToTotem(devno, 'RELOAD_CONFIG', {});
  wsManager.broadcastDashboardUpdate();

  return res.json({
    success: true,
    message: 'Configurações atualizadas e persistidas no banco com sucesso.',
    data: updatedTotem.config
  });
});

/**
 * POST /api/v1/admin/totems/:devno/video
 * Upload de vídeo personalizado para exibição durante a higienização da máquina
 */
router.post('/admin/totems/:devno/video', videoUpload.single('video'), (req, res) => {
  const { devno } = req.params;
  let videoUrl = null;

  if (req.file) {
    videoUrl = `/uploads/videos/${req.file.filename}`;
  } else if (req.body && req.body.videoUrl) {
    videoUrl = req.body.videoUrl.trim();
  }

  if (!videoUrl) {
    return res.status(400).json({ success: false, message: 'Nenhum arquivo de vídeo ou URL fornecido.' });
  }

  const totem = store.getTotem(devno);
  if (!totem) {
    return res.status(404).json({ success: false, message: 'Totem não encontrado.' });
  }

  const updatedTotem = store.updateTotemConfig(devno, { cleaningVideoUrl: videoUrl }, 'CRPADMIN');

  // Envia comando de atualização de vídeo para o totem conectado
  wsManager.sendCommandToTotem(devno, 'CLEANING_VIDEO_UPDATED', { videoUrl });
  wsManager.sendCommandToTotem(devno, 'CONFIG_UPDATED', {
    config: updatedTotem.config,
    cleaningVideoUrl: videoUrl
  });
  wsManager.broadcastDashboardUpdate();

  return res.json({
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
 * DELETE /api/v1/admin/totems/:devno/video
 * Remove o vídeo customizado da máquina e restaura a animação padrão
 */
router.delete('/admin/totems/:devno/video', (req, res) => {
  const { devno } = req.params;
  const totem = store.getTotem(devno);

  if (!totem) {
    return res.status(404).json({ success: false, message: 'Totem não encontrado.' });
  }

  if (totem.config && totem.config.cleaningVideoUrl) {
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
    success: true,
    message: 'Vídeo customizado removido. Máquina restaurada para a animação padrão.',
    data: { devno, videoUrl: null }
  });
});

/**
 * POST /api/v1/admin/remote-command
 * Envia um comando remoto para a estação Capaxero via WebSocket
 */
router.post('/admin/remote-command', (req, res) => {
  const { devno, command, params } = req.body;

  if (!devno || !command) {
    return res.status(400).json({
      success: false,
      message: 'Campos "devno" e "command" são obrigatórios.'
    });
  }

  const totem = store.getTotem(devno);
  if (!totem) {
    return res.status(404).json({ success: false, message: 'Totem não encontrado.' });
  }

  let actionDescription = '';

  switch (command) {
    case 'UNLOCK_DOOR':
      totem.doorLocked = false;
      actionDescription = 'Comando de destravamento de porta emitido.';
      break;

    case 'LOCK_DOOR':
      totem.doorLocked = true;
      actionDescription = 'Porta travada com sucesso.';
      break;

    case 'TOGGLE_MAINTENANCE':
      totem.status = totem.status === 'MAINTENANCE' ? 'IDLE' : 'MAINTENANCE';
      actionDescription = `Status do totem alterado para ${totem.status}.`;
      break;

    case 'TEST_RELAYS':
      actionDescription = 'Sequência de teste de relés e atuadores disparada.';
      break;

    case 'TEST_FOGGER_SMOKE':
      actionDescription = 'Teste de disparo da névoa atomizada (fogger) acionado por 5s.';
      break;

    case 'PURGE_DUCTS':
      actionDescription = 'Válvula de limpeza e purga de dutos acionada (0x79).';
      break;

    case 'START_REMOTE_CLEANING':
      totem.status = 'CLEANING';
      totem.doorLocked = true;
      totem.currentCycle = {
        mode: (params && params.mode) || 'INTERMEDIARIA',
        step: '🟣 FASE 1/4: ESTERILIZAÇÃO UV-C',
        stepIndex: 1,
        totalSteps: 4,
        elapsedSeconds: 0,
        totalSeconds: 420,
        progressPercent: 10
      };
      actionDescription = 'Ciclo de higienização disparado remotamente.';
      break;

    case 'EMERGENCY_STOP':
      totem.status = 'IDLE';
      totem.currentCycle = null;
      totem.doorLocked = false;
      actionDescription = 'Parada de emergência executada. Exaustão preventiva acionada e porta liberada.';
      break;

    case 'REFILL_FLUIDS':
      totem.liquidLevelPercent = 100;
      totem.fragranceLevelPercent = 100;
      store.getAlerts().forEach(a => {
        if (a.devno === devno && a.type === 'LOW_LIQUID') {
          store.resolveAlert(a.id);
        }
      });
      actionDescription = 'Tanques de sanitizante e fragrância reabastecidos para 100%.';
      break;

    default:
      actionDescription = `Comando '${command}' encaminhado ao totem.`;
  }

  const wsResult = wsManager.sendCommandToTotem(devno, command, params || {});
  wsManager.broadcastDashboardUpdate();

  return res.json({
    success: true,
    message: actionDescription,
    data: {
      devno,
      command,
      totemStatus: totem.status,
      doorLocked: totem.doorLocked,
      deliveredOnline: wsResult.deliveredOnline
    }
  });
});

/**
 * GET /api/v1/admin/transactions
 * Histórico de transações com filtros
 */
router.get('/admin/transactions', (req, res) => {
  const user = extractUser(req);
  const limit = parseInt(req.query.limit) || 50;
  return res.json({
    success: true,
    data: store.getTransactions(limit, user)
  });
});

/**
 * GET /api/v1/admin/alerts
 * Lista de alertas técnicos
 */
router.get('/admin/alerts', (req, res) => {
  const user = extractUser(req);
  const activeOnly = req.query.active === 'true';
  return res.json({
    success: true,
    data: store.getAlerts(activeOnly, user)
  });
});

/**
 * POST /api/v1/admin/alerts/:id/resolve
 * Marca um alerta como resolvido
 */
router.post('/admin/alerts/:id/resolve', (req, res) => {
  const { id } = req.params;
  const alert = store.resolveAlert(id);

  if (!alert) {
    return res.status(404).json({ success: false, message: 'Alerta não encontrado.' });
  }

  wsManager.broadcastDashboardUpdate();

  return res.json({
    success: true,
    message: 'Alerta marcado como resolvido.',
    data: alert
  });
});

module.exports = router;
