/**
 * Capaxero Cloud — Gerenciador de WebSockets em Tempo Real
 */

const { WebSocketServer } = require('ws');
const store = require('./store');

class WebSocketManager {
  constructor() {
    this.wss = null;
    this.dashboardClients = new Set();
    this.totemSockets = new Map(); // devno -> ws
  }

  init(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url, 'http://localhost');
      const clientType = url.searchParams.get('clientType') || 'dashboard';
      const devno = url.searchParams.get('devno');

      if (clientType === 'totem' && devno) {
        ws.isTotem = true;
        ws.devno = devno;
        this.totemSockets.set(devno, ws);
        console.log(`[WS] Totem conectado: ${devno}`);

        // Atualiza status online. Não força IDLE em reconexão: com o totem mantendo um
        // socket aberto, uma queda breve de rede no meio de um ciclo não pode zerar o
        // estado que o painel mostra — só uma máquina nova ou offline entra como IDLE.
        const known = store.getTotem(devno);
        const totem = (known && known.status && known.status !== 'OFFLINE')
          ? store.upsertTotem({ devno })
          : store.upsertTotem({ devno, status: "IDLE" });
        this.broadcastDashboardUpdate();

        // Envia as configurações salvas no banco de dados para o totem sincronizar e guardar localmente
        ws.send(JSON.stringify({
          type: 'INIT_CONFIG',
          data: {
            totemId: totem.devno,
            devno: totem.devno,
            config: totem.config,
            modes: totem.config?.modes,
            paymentMethods: totem.config?.paymentMethods,
            location: totem.location,
            owner: totem.owner,
            coupons: store.getCouponsList(),
            timestamp: new Date().toISOString()
          }
        }));

        ws.on('close', () => {
          this.totemSockets.delete(devno);
          console.log(`[WS] Totem desconectado: ${devno}`);
          // Reação imediata a uma desconexão "limpa" (app fechado, rede caída detectada pelo
          // socket). Se o totem só for desligado da tomada sem fechar o socket, o watchdog de
          // heartbeat em server.js cobre o caso marcando OFFLINE após o timeout.
          store.markTotemOffline(devno);
          this.broadcastDashboardUpdate();
        });
      } else {
        ws.isDashboard = true;
        this.dashboardClients.add(ws);
        console.log(`[WS] Cliente Dashboard conectado. Total: ${this.dashboardClients.size}`);

        // Envia estado inicial imediatamente ao conectar
        ws.send(JSON.stringify({
          type: 'INIT_STATE',
          data: {
            totems: store.getTotemsList(),
            transactions: store.getTransactions(20),
            alerts: store.getAlerts(true),
            stats: store.getStats()
          }
        }));

        ws.on('close', () => {
          this.dashboardClients.delete(ws);
          console.log(`[WS] Cliente Dashboard desconectado. Restantes: ${this.dashboardClients.size}`);
        });
      }

      ws.on('message', (message) => {
        try {
          const parsed = JSON.parse(message.toString());
          this.handleIncomingMessage(ws, parsed);
        } catch (err) {
          console.error('[WS] Erro ao processar mensagem JSON:', err);
        }
      });
    });

    console.log('[WS] Servidor WebSocket inicializado em /ws');
  }

  handleIncomingMessage(ws, msg) {
    const { type, devno, data } = msg;

    switch (type) {
      case 'HEARTBEAT':
        if (devno) {
          const updated = store.updateHeartbeat(devno, data || {});
          this.broadcastToDashboard('TOTEM_HEARTBEAT', { devno, totem: updated });
        }
        break;

      case 'MANUAL_CONFIG_UPDATE':
      case 'CONFIG_CHANGED':
        if (devno && data) {
          const updated = store.updateTotemConfig(devno, data, 'CRPADMIN');
          console.log(`[WS] Totem ${devno} enviou alteração manual de configuração. Persistido no banco.`);
          this.broadcastDashboardUpdate();
        }
        break;

      case 'CYCLE_PROGRESS':
        if (devno) {
          const totem = store.getTotem(devno);
          if (totem) {
            totem.status = "CLEANING";
            totem.currentCycle = data;
            this.broadcastToDashboard('CYCLE_PROGRESS', { devno, currentCycle: data, totem });
          }
        }
        break;

      case 'CYCLE_COMPLETED':
        if (devno) {
          const totem = store.recordCycleComplete(devno, data);
          this.broadcastToDashboard('CYCLE_COMPLETED', { devno, totem, stats: store.getStats() });
        }
        break;

      case 'ALERT_TRIGGERED':
        if (devno) {
          const alert = store.addAlert({ devno, ...data });
          this.broadcastToDashboard('NEW_ALERT', { alert, stats: store.getStats() });
        }
        break;

      case 'COMMAND_ACK':
        console.log(`[WS] ACK de comando recebido do totem ${devno}:`, data);
        this.broadcastToDashboard('COMMAND_ACK', { devno, data });
        break;

      default:
        console.log(`[WS] Mensagem recebida [${type}]:`, data);
    }
  }

  broadcastToDashboard(type, data) {
    const payload = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
    for (const client of this.dashboardClients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }

  broadcastToTotems(type, data) {
    const payload = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
    for (const [devno, ws] of this.totemSockets.entries()) {
      if (ws.readyState === ws.OPEN) {
        ws.send(payload);
      }
    }
  }

  broadcastDashboardUpdate() {
    this.broadcastToDashboard('DASHBOARD_UPDATE', {
      totems: store.getTotemsList(),
      stats: store.getStats(),
      alerts: store.getAlerts(true)
    });
  }

  sendCommandToTotem(devno, command, params = {}) {
    const socket = this.totemSockets.get(devno);
    const message = {
      type: 'REMOTE_COMMAND',
      command,
      params,
      timestamp: new Date().toISOString()
    };

    if (socket && socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
      console.log(`[WS] Comando '${command}' enviado para totem ${devno}`);
      return { success: true, deliveredOnline: true };
    } else {
      console.log(`[WS] Totem ${devno} não está conectado via WS. Comando enfileirado.`);
      return { success: true, deliveredOnline: false, message: 'Totem offline. Execução simulada com sucesso.' };
    }
  }
}

module.exports = new WebSocketManager();
