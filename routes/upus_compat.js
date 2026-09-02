/**
 * Capaxero Cloud — Módulo de Compatibilidade com UPUS IoT / Yapuda Backend
 * Implementa 100% dos endpoints chamados originalmente pelo APK e pelo site upusiot_site.
 * Prefixo: /upus_APP/app/*
 */

const express = require('express');
const router = express.Router();
const store = require('../services/store');
const wsManager = require('../services/websocket');

/**
 * POST /upus_APP/app/Register/login1
 * Login de Operadores e Aplicativo Web
 */
router.post('/Register/login1', (req, res) => {
  const { companyNo, userName, userPwd } = req.body;

  if (!userName || !companyNo) {
    return res.json({ code: -1, msg: 'companyNo e userName são obrigatórios.', data: null });
  }

  const session = store.authenticateOperator(companyNo, userName, userPwd);
  if (!session) {
    return res.json({ code: -2, msg: 'Empresa, usuário ou senha inválidos.', data: null });
  }

  console.log(`[UPUS COMPAT] Login bem-sucedido: Usuário ${session.username} (${session.logno}) na empresa ${session.cocode}`);

  return res.json({
    code: 0,
    msg: 'Login realizado com sucesso.',
    data: session
  });
});

/**
 * POST /upus_APP/app/user/getUserInfo
 * Retorna os dados do usuário autenticado
 */
router.post('/user/getUserInfo', (req, res) => {
  const { logno } = req.body;
  const op = store.operators.find(o => o.logno === logno) || store.operators[0];

  return res.json({
    code: 0,
    msg: 'success',
    data: {
      logno: op.logno,
      username: op.username,
      cocode: op.cocode,
      compno: op.compno,
      branno: op.branno,
      roleTitle: op.roleTitle,
      usertype: op.usertype
    }
  });
});

/**
 * POST /upus_APP/app/branch/list
 * Lista de filiais ativas
 */
router.post('/branch/list', (req, res) => {
  return res.json({
    code: 0,
    msg: 'success',
    data: store.getBranchesList()
  });
});

/**
 * POST /upus_APP/app/expressbox/devlogin
 * Autenticação do Totem de Higienização de Capacetes no boot
 */
router.post('/expressbox/devlogin', (req, res) => {
  const { devno, appVersion, devkind, mac } = req.body;

  if (!devno) {
    return res.json({ code: -1, msg: 'devno is required', data: null });
  }

  const totem = store.upsertTotem({
    devno,
    appVersion: appVersion || 'v3.3.0',
    macAddress: mac || '00:00:00:00:00:00',
    status: 'IDLE'
  });

  wsManager.broadcastDashboardUpdate();
  console.log(`[UPUS COMPAT] Totem registrado: ${devno}`);

  return res.json({
    code: 0,
    msg: 'Dispositivo conectado e autenticado.',
    data: {
      devno: totem.devno,
      devna: totem.name,
      compno: '87550094',
      cocode: 'SPOST',
      branno: totem.branno || 'BR-01',
      serverTime: new Date().toISOString()
    }
  });
});

/**
 * POST /upus_APP/app/expressbox/devnoinfo
 * Download dos tempos de ciclo e mapeamento de portas seriais do totem
 */
router.post('/expressbox/devnoinfo', (req, res) => {
  const { devno } = req.body;
  const totem = store.getTotem(devno) || store.upsertTotem({ devno });

  const c = totem.config || {};
  return res.json({
    code: 0,
    msg: 'success',
    data: {
      devno: totem.devno,
      task0Time: c.interUvTime || 120,                  // Tempo de desinfecção UV
      task1Time: c.interSterilizationTime || 120,       // Tempo de esterilização e desinfecção
      task2Time: c.interDryingTime || 120,              // Tempo de secagem
      task3Time: c.interPurificationTime || 120,        // Tempo de purificação
      task4Time: c.interExhaustTime || 10,              // Sair da higienização Ventilador de exaustão
      smokeControlTime: c.interSmokeControlTime || 15,  // Tempo de controle da fumaça
      doorTimeout: c.interDoorTimeout || 5,             // Tempo limite para fechar a porta
      prices: {
        basic: c.basicPrice || 14.0,
        intermediate: c.intermediatePrice || 17.0,
        advanced: c.advancedPrice || 20.0
      },
      serialPort: '/dev/ttyS1',
      baudRate: 9600
    }
  });
});

/**
 * POST /upus_APP/app/expressbox/unlockupdate
 * Registro de abertura de porta e início/fim de higienização
 */
router.post('/expressbox/unlockupdate', (req, res) => {
  const { devno, boxno, orderno, paytype, money } = req.body;

  const tx = store.addTransaction({
    orderId: orderno || 'ORD-' + Math.floor(10000 + Math.random() * 90000),
    devno: devno || 'CPX-001',
    mode: 'INTERMEDIARIA',
    amount: Number(money || 17.00),
    paymentMethod: paytype || 'CIELO_POS',
    status: 'APPROVED'
  });

  wsManager.broadcastToDashboard('NEW_TRANSACTION', {
    transaction: tx,
    totem: store.getTotem(devno),
    stats: store.getStats()
  });

  return res.json({
    code: 0,
    msg: 'Ciclo registrado e destravamento autorizado.',
    data: { orderno: tx.orderId }
  });
});

/**
 * POST /upus_APP/app/expressbox/warning
 * Envio de alertas de sensores para a central
 */
router.post('/expressbox/warning', (req, res) => {
  const { devno, warnkind, warnmsg } = req.body;

  const alert = store.addAlert({
    devno: devno || 'CPX-001',
    type: warnkind || 'SENSOR_WARNING',
    severity: 'WARNING',
    message: warnmsg || `Alerta recebido do totem ${devno}`
  });

  wsManager.broadcastToDashboard('NEW_ALERT', { alert, stats: store.getStats() });

  return res.json({
    code: 0,
    msg: 'Alerta recebido na central.',
    data: { alertId: alert.id }
  });
});

/**
 * POST /upus_APP/app/device/remote/clean
 * Disparo remoto de ciclo de higienização
 */
router.post('/device/remote/clean', (req, res) => {
  const { devno } = req.body;
  const result = wsManager.sendCommandToTotem(devno, 'START_REMOTE_CLEANING', { mode: 'INTERMEDIARIA' });

  return res.json({
    code: 0,
    msg: `Comando de limpeza remota enviado para ${devno}.`,
    data: result
  });
});

/**
 * POST /upus_APP/app/device/remote/smoke
 * Disparo de teste de névoa atomizada (fogger)
 */
router.post('/device/remote/smoke', (req, res) => {
  const { devno } = req.body;
  const result = wsManager.sendCommandToTotem(devno, 'TEST_SMOKE_FOGGER', { durationSec: 5 });

  return res.json({
    code: 0,
    msg: `Teste de névoa disparado no totem ${devno}.`,
    data: result
  });
});

/**
 * POST /upus_APP/app/Lock/openLock_charge
 * Abertura remota da trava da porta
 */
router.post('/Lock/openLock_charge', (req, res) => {
  const { devno } = req.body;
  const totem = store.getTotem(devno);
  if (totem) totem.doorLocked = false;

  wsManager.sendCommandToTotem(devno, 'UNLOCK_DOOR', { holdTimeSec: 60 });
  wsManager.broadcastDashboardUpdate();

  return res.json({
    code: 0,
    msg: `Porta da cabine do totem ${devno} destravada com sucesso.`
  });
});

/**
 * POST /upus_APP/app/dropdown/getListBySql
 * Endpoint de consultas flexíveis do frontend UPUS
 */
router.post('/dropdown/getListBySql', (req, res) => {
  const { sql } = req.body;
  const sqlLower = (sql || '').toLowerCase();

  let resultData = [];

  if (sqlLower.includes('branch') || sqlLower.includes('branno')) {
    resultData = store.getBranchesList();
  } else if (sqlLower.includes('depot') || sqlLower.includes('venue')) {
    resultData = store.getDepotsList();
  } else if (sqlLower.includes('device') || sqlLower.includes('shelf') || sqlLower.includes('expressbox')) {
    resultData = store.getTotemsList();
  } else {
    resultData = store.getTotemsList();
  }

  return res.json({
    code: 0,
    msg: 'success',
    data: resultData
  });
});

/**
 * POST /upus_APP/app/BgpartManage/getWashChestList
 * Lista de gabinetes de lavagem/higienização de capacetes
 */
router.post('/BgpartManage/getWashChestList', (req, res) => {
  return res.json({
    code: 0,
    msg: 'success',
    data: store.getTotemsList().map(t => ({
      devno: t.devno,
      devna: t.name,
      location: t.location,
      status: t.status,
      liquidPercent: t.liquidLevelPercent
    }))
  });
});

/**
 * POST /upus_APP/app/newdepot/income/count
 * Relatórios de faturamento por período e ponto de instalação
 */
router.post('/newdepot/income/count', (req, res) => {
  const income = store.getIncomeReport();
  return res.json({
    code: 0,
    msg: 'success',
    data: income
  });
});

module.exports = router;
