/**
 * Capaxero Cloud — Servidor Principal
 * Telemetria, Pagamentos Cielo, Dashboard em Tempo Real, Autenticação e Camada UPUS IoT
 */

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');

const store = require('./services/store');
const wsManager = require('./services/websocket');
const { requireAdminToken } = require('./middleware/auth');

const authRoutes = require('./routes/auth').router;
const apiRoutes = require('./routes/api');
const cieloRoutes = require('./routes/cielo');
const adminRoutes = require('./routes/admin');
const upusCompatRoutes = require('./routes/upus_compat');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

process.on('uncaughtException', (err) => {
  console.error('[SERVER CRASH PREVENTED] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER CRASH PREVENTED] Unhandled Rejection:', reason);
});

// CORS: Permite conexões do dashboard web, totens e integrações
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Tratamento de erro para JSON malformatado
app.use((err, req, res, next) => {
  if (err && (err.status === 400 || err instanceof SyntaxError)) {
    return res.status(400).json({ success: false, message: 'JSON malformatado na requisição.' });
  }
  next(err);
});

// Servir arquivos estáticos do Frontend Dashboard (nunca dotfiles como .env)
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny' }));

// Log de requisições recebidas (para depuração em tempo real)
app.use((req, res, next) => {
  if (req.path.includes('telemetry') || req.path.includes('totem') || req.path.includes('health')) {
    console.log(`[HTTP ${req.method}] ${req.path} - Origem: ${req.ip}`);
  }
  next();
});

// Rotas de Autenticação e Gestão de Contas (Donos & CRPADMIN)
app.use('/api/v1/auth', authRoutes);
app.use('/auth', authRoutes);

// Rotas da API Capaxero Cloud (V1 e Raiz para máxima resiliência de URL)
app.use('/api/v1', apiRoutes);
app.use('/', apiRoutes);
app.use('/api/v1/payment', cieloRoutes);
app.use('/api/v1/payment/cielo', cieloRoutes);
app.use('/api/v1/cielo', cieloRoutes);
app.use('/api/v1/admin', requireAdminToken);
app.use('/api/v1', adminRoutes);

// Camada de Compatibilidade UPUS IoT (Para o APK original e ferramentas do upusiot_site)
app.use('/upus_APP/app', upusCompatRoutes);

// Rota de Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    service: 'Capaxero Cloud Platform',
    version: '1.3.0',
    database: 'SQLite/Relational Engine',
    compatMode: 'UPUS IoT 3.2.7 + Capaxero Native V1',
    timestamp: new Date().toISOString(),
    totemsConnected: store.getTotemsList().length,
    branchesCount: store.getBranchesList().length
  });
});

// Inicialização do WebSocket Server
wsManager.init(server);

// Watchdog: marca como OFFLINE totens sem heartbeat há mais de 3 minutos (o APK manda
// heartbeat a cada 60s). Cobre o caso de a máquina ser desligada da tomada sem fechar o
// WebSocket de forma limpa — sem isso o painel mostraria "Disponível" para sempre.
const HEARTBEAT_TIMEOUT_MS = 3 * 60 * 1000;
const OFFLINE_CHECK_INTERVAL_MS = 30 * 1000;
setInterval(() => {
  const changedDevnos = store.markStaleTotemsOffline(HEARTBEAT_TIMEOUT_MS);
  if (changedDevnos.length) {
    console.log(`[WATCHDOG] Totens marcados como OFFLINE por timeout de heartbeat: ${changedDevnos.join(', ')}`);
    wsManager.broadcastDashboardUpdate();
  }
}, OFFLINE_CHECK_INTERVAL_MS);

// Garante que os tokens de admin/webhook já apareçam no boot
require('./middleware/auth').getAdminToken();
require('./middleware/auth').getWebhookToken();

// Inicializa o servidor HTTP
server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🏍️  CAPAXERO CLOUD — PLATAFORMA DE TELEMETRIA & IOT`);
  console.log(`====================================================`);
  console.log(`🌐 Servidor Web & Dashboard : http://localhost:${PORT}`);
  console.log(`⚡ Conexão WebSocket        : ws://localhost:${PORT}/ws`);
  console.log(`🔄 Compatibilidade UPUS IoT : http://localhost:${PORT}/upus_APP/app/...`);
  console.log(`📱 Simulador de Totens/Cielo: http://localhost:${PORT}#simulator`);
  console.log(`====================================================`);
});
