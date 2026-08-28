/**
 * Painel Capaxero — Frontend Controller Oficial
 * Conectado exclusivamente aos dados reais do Banco de Dados Relacional e WebSocket.
 * Sem dados mockados: totens, locais, donos, alertas, transações e cupons sincronizados ao vivo.
 */

function fmtBRL(n) {
  return 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function maskCNPJ(val) {
  return (val || '')
    .replace(/\D/g, '')
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
    .slice(0, 18);
}

function maskPhone(val) {
  const digits = (val || '').replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 10) {
    return digits.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  }
  return digits.replace(/^(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
}

function hashPosition(seed) {
  let h = 0;
  for (let i = 0; i < (seed || 'TX').length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const left = 12 + (h % 76);
  const top = 16 + (Math.floor(h / 97) % 68);
  return { left: `${left}%`, top: `${top}%` };
}

class CapaxeroDashboard {
  constructor() {
    this.token = localStorage.getItem('cpx_token') || null;
    this.currentUser = null;
    this.ws = null;

    this.activeTab = 'estacoes';
    this.estacoesView = 'map';
    this.periodo = '7 dias';
    this.selectedStationId = null;
    this.searchTerm = '';
    this.selectedCouponCode = null;

    // Metadados de Status dos Totens
    this.meta = {
      IDLE:        { label: 'Disponível',     color: '#00C566', chip: 'rgba(0,197,102,.14)',  border: 'rgba(0,197,102,.28)' },
      CLEANING:    { label: 'Higienizando',   color: '#5587B3', chip: 'rgba(85,135,179,.18)', border: 'rgba(85,135,179,.5)' },
      MAINTENANCE: { label: 'Em Manutenção',  color: '#FF9100', chip: 'rgba(255,145,0,.14)',  border: 'rgba(255,145,0,.35)' },
      ERROR:       { label: 'Falha',          color: '#FF3D57', chip: 'rgba(255,61,87,.14)',  border: 'rgba(255,61,87,.4)' },
      OFFLINE:     { label: 'Offline',        color: '#5b6675', chip: 'rgba(255,255,255,.06)', border: 'rgba(255,255,255,.08)' }
    };

    // Coleções carregadas dinamicamente do Banco de Dados
    this.stations = [];
    this.locais = [];
    this.oms = [];
    this.donosList = [];
    this.transactions = [];

    this.state = {
      totems: [],
      depots: [],
      branches: [],
      users: [],
      alerts: [],
      transactions: [],
      coupons: [],
      stats: {
        totalRevenueToday: 0,
        totalCyclesToday: 0,
        totalTotems: 0,
        onlineTotems: 0,
        cleaningTotems: 0,
        alertTotems: 0
      }
    };

    this.init();
  }

  init() {
    this.setupAuthForms();
    this.checkSessionAndBoot();
    this.attachNav();
    this.attachGlobalControls();
    this.attachModals();
  }

  /* ============================================================
     Autenticação & Controle de Sessão
     ============================================================ */
  setupAuthForms() {
    const btnTabLogin = document.getElementById('btn-tab-login');
    const btnTabRegister = document.getElementById('btn-tab-register');
    const formLogin = document.getElementById('form-auth-login');
    const formRegister = document.getElementById('form-auth-register');
    const regCnpj = document.getElementById('reg-cnpj');
    const regPhone = document.getElementById('reg-phone');

    if (btnTabLogin && btnTabRegister) {
      btnTabLogin.addEventListener('click', () => {
        btnTabLogin.classList.add('active');
        btnTabRegister.classList.remove('active');
        if (formLogin) formLogin.classList.add('active');
        if (formRegister) formRegister.classList.remove('active');
      });

      btnTabRegister.addEventListener('click', () => {
        btnTabRegister.classList.add('active');
        btnTabLogin.classList.remove('active');
        if (formRegister) formRegister.classList.add('active');
        if (formLogin) formLogin.classList.remove('active');
      });
    }

    if (regCnpj) {
      regCnpj.addEventListener('input', (e) => {
        e.target.value = maskCNPJ(e.target.value);
      });
    }

    if (regPhone) {
      regPhone.addEventListener('input', (e) => {
        e.target.value = maskPhone(e.target.value);
      });
    }

    if (formLogin) {
      formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errBox = document.getElementById('login-error');
        if (errBox) errBox.style.display = 'none';

        const login = document.getElementById('login-identifier').value.trim();
        const password = document.getElementById('login-password').value;

        try {
          const res = await fetch('/api/v1/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login, password })
          }).then(r => r.json());

          if (res.success && res.data?.token) {
            this.token = res.data.token;
            this.currentUser = res.data.user;
            localStorage.setItem('cpx_token', this.token);
            this.hideAuthScreen();
            this.updateUserUI();
            this.fetchBackendData();
            this.connectWebSocket();
            this.showToast(`👋 Olá, ${this.currentUser.responsible_name || this.currentUser.username}!`);
          } else {
            if (errBox) {
              errBox.textContent = res.message || 'Credenciais inválidas. Verifique seu login e senha.';
              errBox.style.display = 'block';
            }
          }
        } catch (err) {
          if (errBox) {
            errBox.textContent = 'Falha na comunicação com o servidor.';
            errBox.style.display = 'block';
          }
        }
      });
    }

    // Fecha tela de auth se logado
  }

  async checkSessionAndBoot() {
    const authScreen = document.getElementById('auth-screen');
    if (!this.token) {
      if (authScreen) authScreen.classList.remove('hidden');
      return;
    }

    try {
      const res = await fetch('/api/v1/auth/me', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      }).then(r => r.json());

      if (res.success && res.data?.user) {
        this.currentUser = res.data.user;
        this.hideAuthScreen();
        this.updateUserUI();
        this.fetchBackendData();
        this.connectWebSocket();
      } else {
        localStorage.removeItem('cpx_token');
        if (authScreen) authScreen.classList.remove('hidden');
      }
    } catch (_) {
      this.hideAuthScreen();
      this.fetchBackendData();
      this.connectWebSocket();
    }
  }

  hideAuthScreen() {
    const authScreen = document.getElementById('auth-screen');
    if (authScreen) {
      authScreen.classList.add('hidden');
    }
  }

  updateUserUI() {
    if (!this.currentUser) return;
    const isAdmin = this.currentUser.role === 'CRPADMIN';

    const nameEl = document.getElementById('user-display-name');
    const roleEl = document.getElementById('user-display-role');
    const pmName = document.getElementById('pm-user-name');
    const pmEmail = document.getElementById('pm-user-email');
    const pmRole = document.getElementById('pm-user-role');
    const tabCadastros = document.getElementById('tab-cadastros');

    const displayName = this.currentUser.responsible_name || this.currentUser.username;
    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = isAdmin ? 'ADMIN' : 'DONO';
    if (pmName) pmName.textContent = displayName;
    if (pmEmail) pmEmail.textContent = this.currentUser.email || '--';
    if (pmRole) pmRole.textContent = isAdmin ? '🔒 ADMIN — total' : '👤 Dono da Máquina';

    if (tabCadastros) {
      tabCadastros.style.display = isAdmin ? 'block' : 'none';
    }

    // Oculta todas as ações e painéis restritos de realocação / gestão de donos para não-admins
    document.querySelectorAll('.admin-only').forEach(el => {
      el.style.display = isAdmin ? '' : 'none';
    });

    const adminLocaisControls = document.getElementById('admin-locais-controls');
    if (adminLocaisControls) {
      adminLocaisControls.style.display = isAdmin ? 'grid' : 'none';
    }

    const btnNewDepot = document.getElementById('btn-open-new-depot');
    if (btnNewDepot) {
      btnNewDepot.style.display = isAdmin ? 'inline-block' : 'none';
    }

    const modalAdminOwnerCard = document.getElementById('modal-admin-owner-card');
    if (modalAdminOwnerCard) {
      modalAdminOwnerCard.style.display = isAdmin ? 'block' : 'none';
    }
  }

  /* ============================================================
     WebSocket em Tempo Real
     ============================================================ */
  connectWebSocket() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?clientType=dashboard`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        const dot = document.getElementById('ws-dot');
        const st = document.getElementById('pm-ws-status');
        if (dot) dot.style.background = 'var(--status-green)';
        if (st) { st.textContent = 'ONLINE (WS)'; st.style.color = '#00C566'; }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleWebSocketMessage(msg);
        } catch (_) {}
      };

      this.ws.onclose = () => {
        const dot = document.getElementById('ws-dot');
        const st = document.getElementById('pm-ws-status');
        if (dot) dot.style.background = 'var(--status-orange)';
        if (st) { st.textContent = 'RECONECTANDO...'; st.style.color = '#FF9100'; }
        setTimeout(() => this.connectWebSocket(), 3000);
      };
    } catch (_) {}
  }

  handleWebSocketMessage(msg) {
    if (msg.type === 'INIT_STATE' || msg.type === 'DASHBOARD_UPDATE') {
      this.fetchBackendData();
    } else if (msg.type === 'TOTEM_HEARTBEAT' || msg.type === 'TOTEM_UPDATE' || msg.type === 'CYCLE_PROGRESS') {
      const data = msg.data || msg;
      if (data.totem) {
        const devno = data.devno || data.totem.devno;
        const idx = this.stations.findIndex(s => s.code === devno || s.devno === devno);
        if (idx !== -1) {
          this.stations[idx] = this.normalizeTotem(data.totem);
        } else {
          this.stations.unshift(this.normalizeTotem(data.totem));
        }
        this.renderEstacoes();
        this.renderDashboard();
        if (this.selectedStationId === devno) {
          this.openStationDetails(devno);
        }
      }
    } else if (msg.type === 'NEW_ALERT') {
      this.fetchBackendData();
      if (msg.data?.alert) {
        this.showToast(`⚠️ Alerta em ${msg.data.alert.totemName || 'Totem'}: ${msg.data.alert.message}`, 'warn');
      }
    } else if (msg.type === 'NEW_TRANSACTION') {
      this.fetchBackendData();
      if (msg.data?.transaction) {
        this.showToast(`💰 Venda aprovada: ${fmtBRL(msg.data.transaction.amount)} em ${msg.data.transaction.totemName}`, 'ok');
      }
    }
  }

  /* ============================================================
     Navegação e Controles Globais
     ============================================================ */
  attachNav() {
    const navButtons = document.querySelectorAll('.nav-tab-btn');
    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        this.switchPage(page);
      });
    });

    // Profile Dropdown
    const profileBtn = document.getElementById('profile-btn');
    const profileMenu = document.getElementById('profile-menu');
    if (profileBtn && profileMenu) {
      profileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        profileMenu.classList.toggle('open');
      });
      document.addEventListener('click', () => profileMenu.classList.remove('open'));
    }

    // Logout
    const btnLogout = document.getElementById('pm-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', () => {
        this.showToast('Sessão encerrada com segurança.', 'warn');
        localStorage.removeItem('cpx_token');
        this.token = null;
        this.currentUser = null;
        const authScreen = document.getElementById('auth-screen');
        if (authScreen) authScreen.classList.remove('hidden');
        if (profileMenu) profileMenu.classList.remove('open');
      });
    }

    // Busca Global
    const searchInput = document.getElementById('global-search');
    const clearBtn = document.getElementById('global-search-clear');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchTerm = e.target.value.trim().toLowerCase();
        if (clearBtn) clearBtn.style.display = this.searchTerm ? 'block' : 'none';
        this.renderEstacoes();
        this.renderLocais();
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        this.searchTerm = '';
        clearBtn.style.display = 'none';
        this.renderEstacoes();
        this.renderLocais();
      });
    }

    // Toggle de Visualização (Mapa / Lista)
    const btnMap = document.getElementById('btn-view-map');
    const btnList = document.getElementById('btn-view-list');
    const mapPanel = document.getElementById('estacoes-map');

    if (btnMap && btnList) {
      btnMap.addEventListener('click', () => {
        this.estacoesView = 'map';
        btnMap.classList.add('active');
        btnList.classList.remove('active');
        if (mapPanel) mapPanel.style.display = 'block';
      });
      btnList.addEventListener('click', () => {
        this.estacoesView = 'list';
        btnList.classList.add('active');
        btnMap.classList.remove('active');
        if (mapPanel) mapPanel.style.display = 'none';
      });
    }

    // Filtro de Período no Dashboard
    const periodButtons = document.querySelectorAll('#dash-period-toggle button');
    periodButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        periodButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const p = btn.dataset.period;
        this.periodo = p === 'hoje' ? 'Hoje' : p === '7d' ? '7 dias' : p === '30d' ? '30 dias' : 'Personalizado';
        const lbl = document.getElementById('dash-periodo-label');
        if (lbl) lbl.textContent = this.periodo === 'Hoje' ? 'hoje' : `últimos ${this.periodo}`;
        this.renderDashboard();
      });
    });
  }

  switchPage(pageId) {
    this.activeTab = pageId;
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === pageId);
    });
    document.querySelectorAll('.page').forEach(page => {
      page.classList.remove('active');
    });
    const target = document.getElementById(`page-${pageId}`);
    if (target) target.classList.add('active');

    if (pageId === 'estacoes') this.renderEstacoes();
    else if (pageId === 'locais') this.renderLocais();
    else if (pageId === 'dashboard') this.renderDashboard();
    else if (pageId === 'coupons') this.renderCoupons();
    else if (pageId === 'cadastros') this.renderCadastros();
  }

  attachGlobalControls() {
    const btnOpenNewDepot = document.getElementById('btn-open-new-depot');
    const btnOpenNewOwner = document.getElementById('btn-open-new-owner');
    const btnOpenNewCoupon = document.getElementById('btn-open-new-coupon');
    const btnResetCoupons = document.getElementById('btn-reset-all-coupons');

    if (btnOpenNewDepot) btnOpenNewDepot.addEventListener('click', () => this.openModal('new-depot-modal'));
    if (btnOpenNewOwner) btnOpenNewOwner.addEventListener('click', () => this.openModal('new-owner-modal'));
    if (btnOpenNewCoupon) btnOpenNewCoupon.addEventListener('click', () => this.openNewCouponModal());
    if (btnResetCoupons) btnResetCoupons.addEventListener('click', () => this.resetAllCoupons());
  }

  attachModals() {
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('open');
      });
    });
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal) modal.classList.remove('open');
      });
    });

    // Form Novo Local
    const formNewDepot = document.getElementById('form-new-depot');
    if (formNewDepot) {
      formNewDepot.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('nd-name').value.trim();
        const address = document.getElementById('nd-address').value.trim();
        const branno = document.getElementById('nd-branno').value.trim();
        const commissionPercent = Number(document.getElementById('nd-commission').value) || 0;
        const dailyTrafficEstimate = Number(document.getElementById('nd-traffic').value) || 0;

        try {
          const res = await fetch('/api/v1/admin/depots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
            body: JSON.stringify({ name, address, branno, commissionPercent, dailyTrafficEstimate })
          }).then(r => r.json());

          if (res.success) {
            this.showToast('Local cadastrado com sucesso!');
            document.getElementById('new-depot-modal').classList.remove('open');
            formNewDepot.reset();
            await this.fetchBackendData();
          } else {
            this.showToast(res.message || 'Erro ao cadastrar local.', 'err');
          }
        } catch (_) {
          this.showToast('Erro ao cadastrar local.', 'err');
        }
      });
    }


    // Botão Editar Meu Perfil (Menu de Perfil)
    const btnOpenEditProfile = document.getElementById('pm-btn-edit-profile');
    if (btnOpenEditProfile) {
      btnOpenEditProfile.addEventListener('click', () => {
        const pm = document.getElementById('profile-menu');
        if (pm) pm.classList.remove('open');

        if (this.currentUser) {
          const epResp = document.getElementById('ep-responsible');
          const epEmail = document.getElementById('ep-email');
          const epPhone = document.getElementById('ep-phone');
          const epComp = document.getElementById('ep-company');
          const epPass = document.getElementById('ep-password');

          if (epResp) epResp.value = this.currentUser.responsible_name || this.currentUser.username || '';
          if (epEmail) epEmail.value = this.currentUser.email || '';
          if (epPhone) epPhone.value = this.currentUser.phone || '';
          if (epComp) epComp.value = this.currentUser.company_name || '';
          if (epPass) epPass.value = '';
        }

        const modal = document.getElementById('edit-profile-modal');
        if (modal) modal.classList.add('open');
      });
    }

    // Form Editar Perfil
    const formEditProfile = document.getElementById('form-edit-profile');
    if (formEditProfile) {
      formEditProfile.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          responsible_name: document.getElementById('ep-responsible').value.trim(),
          email: document.getElementById('ep-email').value.trim(),
          phone: document.getElementById('ep-phone').value.trim(),
          company_name: document.getElementById('ep-company').value.trim(),
          password: document.getElementById('ep-password').value.trim() || undefined
        };

        try {
          const res = await fetch('/api/v1/auth/profile', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.token}`
            },
            body: JSON.stringify(payload)
          }).then(r => r.json());

          if (res.success && res.data) {
            this.currentUser = res.data;
            this.updateUserUI();
            this.showToast('✅ Perfil atualizado com sucesso!', 'ok');
            document.getElementById('edit-profile-modal').classList.remove('open');
            await this.fetchBackendData();
          } else {
            this.showToast(res.message || 'Erro ao atualizar perfil.', 'err');
          }
        } catch (err) {
          this.showToast('Erro ao comunicar com o servidor.', 'err');
        }
      });
    }

    // Botão Abrir Modal Novo Dono (Página Cadastros - Admin)
    const btnOpenNewOwner = document.getElementById('btn-open-new-owner');
    if (btnOpenNewOwner) {
      btnOpenNewOwner.addEventListener('click', () => {
        const modal = document.getElementById('new-owner-modal');
        if (modal) modal.classList.add('open');
      });
    }

    // Form Novo Dono (Admin)
    const formNewOwner = document.getElementById('form-new-owner');
    if (formNewOwner) {
      formNewOwner.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          cnpj: document.getElementById('no-cnpj').value.trim(),
          responsible_name: document.getElementById('no-responsible').value.trim(),
          company_name: document.getElementById('no-company').value.trim(),
          email: document.getElementById('no-email').value.trim(),
          phone: document.getElementById('no-phone').value.trim(),
          password: document.getElementById('no-password').value
        };

        try {
          const res = await fetch('/api/v1/auth/register', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.token}`
            },
            body: JSON.stringify(payload)
          }).then(r => r.json());

          if (res.success) {
            this.showToast(`🎉 Novo dono ${payload.responsible_name} cadastrado com sucesso!`, 'ok');
            document.getElementById('new-owner-modal').classList.remove('open');
            formNewOwner.reset();
            await this.fetchBackendData();
          } else {
            this.showToast(res.message || 'Erro ao cadastrar dono.', 'err');
          }
        } catch (_) {
          this.showToast('Erro ao cadastrar dono.', 'err');
        }
      });
    }

    // Form Quick Transfer Owner
    const formQuickTransfer = document.getElementById('form-quick-transfer-owner');
    if (formQuickTransfer) {
      formQuickTransfer.addEventListener('submit', async (e) => {
        e.preventDefault();
        const devno = document.getElementById('quick-transfer-totem').value;
        const newOwner = document.getElementById('quick-transfer-owner').value;

        if (!devno || !newOwner) {
          this.showToast('⚠️ Selecione a máquina e o novo dono.', 'warn');
          return;
        }

        try {
          const res = await fetch(`/api/v1/admin/totems/${encodeURIComponent(devno)}/owner`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
            body: JSON.stringify({ owner: newOwner })
          }).then(r => r.json());

          if (res.success) {
            this.showToast(`✅ ${res.message || `Titularidade de ${devno} reatribuída com sucesso!`}`, 'ok');
            await this.fetchBackendData();
          } else {
            this.showToast(`❌ ${res.message || 'Erro ao reatribuir máquina.'}`, 'err');
          }
        } catch (err) {
          this.showToast('❌ Falha na comunicação com o servidor.', 'err');
        }
      });
    }

    // Form Move Station
    const formMove = document.getElementById('form-move-station');
    if (formMove) {
      formMove.addEventListener('submit', async (e) => {
        e.preventDefault();
        const devno = document.getElementById('move-select-totem').value;
        const newLocation = document.getElementById('move-new-location').value;

        try {
          const res = await fetch(`/api/v1/admin/totems/${encodeURIComponent(devno)}/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
            body: JSON.stringify({ location: newLocation })
          }).then(r => r.json());

          document.getElementById('move-modal').classList.remove('open');
          this.showToast(`Estação ${devno} realocada para ${newLocation}.`);
          await this.fetchBackendData();
        } catch (_) {}
      });
    }

    // Ações de Comando Remoto do Totem
    const btnActUnlock = document.getElementById('btn-act-unlock');
    const btnActMist = document.getElementById('btn-act-mist');
    const btnActPurge = document.getElementById('btn-act-purge');
    const btnActTest = document.getElementById('btn-act-test');
    const btnActOpenOM = document.getElementById('btn-act-open-om');
    const btnOpenConfig = document.getElementById('btn-open-config');
    const btnConfirmOwner = document.getElementById('modal-btn-confirm-owner');

    const sendCmd = async (cmd, params = {}) => {
      if (!this.selectedStationId) return;
      try {
        await fetch('/api/v1/admin/remote-command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
          body: JSON.stringify({ devno: this.selectedStationId, command: cmd, params })
        });
      } catch (_) {}
    };

    if (btnActUnlock) btnActUnlock.addEventListener('click', () => { sendCmd('UNLOCK_DOOR'); this.showToast('🔓 Comando de destravamento enviado. Porta liberada por 30s.'); });
    if (btnActMist) btnActMist.addEventListener('click', () => { sendCmd('START_MIST'); this.showToast('💨 Ciclo de névoa sanitizante disparado remotamente.'); });
    if (btnActPurge) btnActPurge.addEventListener('click', () => { sendCmd('PURGE_LINES'); this.showToast('🚿 Purga de linhas iniciada — 45s.'); });
    if (btnActTest) btnActTest.addEventListener('click', () => { sendCmd('SELF_TEST'); this.showToast('⚡ Autoteste em execução no totem.'); });
    if (btnActOpenOM) btnActOpenOM.addEventListener('click', () => {
      const lbl = document.getElementById('om-totem-label');
      if (lbl) lbl.value = this.selectedStationId ? `Estação ${this.selectedStationId}` : '';
      this.openModal('om-modal');
    });
    if (btnOpenConfig) btnOpenConfig.addEventListener('click', () => this.openModal('config-modal'));

    if (btnConfirmOwner) {
      btnConfirmOwner.addEventListener('click', async () => {
        const newOwner = document.getElementById('modal-select-new-owner').value;
        if (!this.selectedStationId || !newOwner) {
          this.showToast('⚠️ Selecione o novo dono.', 'warn');
          return;
        }

        try {
          const res = await fetch(`/api/v1/admin/totems/${encodeURIComponent(this.selectedStationId)}/owner`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
            body: JSON.stringify({ owner: newOwner })
          }).then(r => r.json());

          if (res.success) {
            this.showToast(`✅ ${res.message || 'Titularidade reatribuída com sucesso!'}`, 'ok');
            await this.fetchBackendData();
            this.openStationDetails(this.selectedStationId);
          } else {
            this.showToast(`❌ ${res.message || 'Erro ao reatribuir titularidade.'}`, 'err');
          }
        } catch (err) {
          this.showToast('❌ Falha na comunicação ao reatribuir titularidade.', 'err');
        }
      });
    }

    // Configurações de Estação (Salvar)
    const formConfig = document.getElementById('form-totem-config');
    if (formConfig) {
      formConfig.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!this.selectedStationId) return;

        const payload = {
          basicPrice: Number(document.getElementById('conf-basic-price').value),
          intermediatePrice: Number(document.getElementById('conf-inter-price').value),
          advancedPrice: Number(document.getElementById('conf-adv-price').value),
          modes: {
            basica: {
              isEnabled: document.getElementById('conf-basic-enabled').checked,
              priceInCents: Math.round(Number(document.getElementById('conf-basic-price').value) * 100),
              uvSeconds: Number(document.getElementById('conf-basic-uv').value),
              mistSpraySeconds: Number(document.getElementById('conf-basic-mist').value),
              mistSaturationSeconds: Number(document.getElementById('conf-basic-sat').value),
              thermalDryingSeconds: Number(document.getElementById('conf-basic-dry').value),
              ozoneExhaustSeconds: Number(document.getElementById('conf-basic-ozone').value),
              fragranceSeconds: Number(document.getElementById('conf-basic-frag').value)
            },
            intermediaria: {
              isEnabled: document.getElementById('conf-inter-enabled').checked,
              priceInCents: Math.round(Number(document.getElementById('conf-inter-price').value) * 100),
              uvSeconds: Number(document.getElementById('conf-inter-uv').value),
              mistSpraySeconds: Number(document.getElementById('conf-inter-mist').value),
              mistSaturationSeconds: Number(document.getElementById('conf-inter-sat').value),
              thermalDryingSeconds: Number(document.getElementById('conf-inter-dry').value),
              ozoneExhaustSeconds: Number(document.getElementById('conf-inter-ozone').value),
              fragranceSeconds: Number(document.getElementById('conf-inter-frag').value)
            },
            avancada: {
              isEnabled: document.getElementById('conf-adv-enabled').checked,
              priceInCents: Math.round(Number(document.getElementById('conf-adv-price').value) * 100),
              uvSeconds: Number(document.getElementById('conf-adv-uv').value),
              mistSpraySeconds: Number(document.getElementById('conf-adv-mist').value),
              mistSaturationSeconds: Number(document.getElementById('conf-adv-sat').value),
              thermalDryingSeconds: Number(document.getElementById('conf-adv-dry').value),
              ozoneExhaustSeconds: Number(document.getElementById('conf-adv-ozone').value),
              fragranceSeconds: Number(document.getElementById('conf-adv-frag').value)
            }
          },
          paymentMethods: {
            isPixEnabled: document.getElementById('conf-pay-pix').checked,
            isCreditEnabled: document.getElementById('conf-pay-credit').checked,
            isDebitEnabled: document.getElementById('conf-pay-debit').checked,
            isCouponsEnabled: document.getElementById('conf-pay-free').checked
          }
        };

        const cieloId = document.getElementById('conf-cielo-id')?.value.trim();
        const cieloKey = document.getElementById('conf-cielo-key')?.value.trim();
        if (cieloId) payload.cieloMerchantId = cieloId;
        if (cieloKey) payload.cieloMerchantKey = cieloKey;

        try {
          const res = await fetch(`/api/v1/totems/${encodeURIComponent(this.selectedStationId)}/config`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.token}`
            },
            body: JSON.stringify(payload)
          }).then(r => r.json());

          if (res.success) {
            document.getElementById('config-modal').classList.remove('open');
            this.showToast('✅ Configurações salvas e persistidas no banco!', 'ok');
            await this.fetchBackendData();
            if (this.selectedStationId) {
              this.openStationDetails(this.selectedStationId);
            }
          } else {
            this.showToast(res.message || 'Erro ao salvar configurações.', 'warn');
          }
        } catch (_) {
          this.showToast('Falha na comunicação com o servidor.', 'warn');
        }
      });
    }

    // Modal Cupons
    const totemsScopeSelect = document.getElementById('nc-totems-scope');
    const totemsCheckboxesDiv = document.getElementById('nc-totems-checkboxes');
    if (totemsScopeSelect && totemsCheckboxesDiv) {
      totemsScopeSelect.addEventListener('change', (e) => {
        totemsCheckboxesDiv.style.display = e.target.value === 'ESPECIFICAS' ? 'block' : 'none';
      });
    }
    const formCoupon = document.getElementById('form-new-coupon');
    if (formCoupon) formCoupon.addEventListener('submit', (e) => this.submitNewCoupon(e));

    // QR Code Modal Buttons
    const btnDownloadQr = document.getElementById('btn-qr-download');
    const btnPrintQr = document.getElementById('btn-qr-print');
    const btnCopyCode = document.getElementById('btn-qr-copy-code');
    if (btnDownloadQr) btnDownloadQr.addEventListener('click', () => this.downloadCurrentCouponQr());
    if (btnPrintQr) btnPrintQr.addEventListener('click', () => this.printCurrentCouponQr());
    if (btnCopyCode) btnCopyCode.addEventListener('click', () => this.copyCurrentCouponCode());

    // Configuração dos controles de Upload de Vídeo de Higienização
    this.setupVideoUploadControls();
  }

  extractYouTubeEmbedUrl(url) {
    if (!url) return null;
    const str = url.trim();
    const regExp = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?|shorts)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = str.match(regExp);
    if (match && match[1]) {
      return `https://www.youtube-nocookie.com/embed/${match[1]}?autoplay=1&mute=1&loop=1&playlist=${match[1]}&controls=1&modestbranding=1&rel=0`;
    }
    return null;
  }

  updateVideoUI(videoUrl) {
    const videoPreview = document.getElementById('conf-video-preview');
    const youtubePreview = document.getElementById('conf-youtube-preview');
    const videoPlaceholder = document.getElementById('conf-video-placeholder');
    const statusBadge = document.getElementById('conf-video-status-badge');
    const urlInput = document.getElementById('conf-video-url-input');
    const btnRemove = document.getElementById('btn-remove-custom-video');
    const btnUpload = document.getElementById('btn-upload-video-now');
    const progressWrap = document.getElementById('conf-video-progress-wrap');

    if (progressWrap) progressWrap.style.display = 'none';
    if (btnUpload) btnUpload.style.display = 'none';

    const ytEmbed = this.extractYouTubeEmbedUrl(videoUrl);

    if (videoUrl) {
      if (ytEmbed) {
        if (youtubePreview) {
          youtubePreview.src = ytEmbed;
          youtubePreview.style.display = 'block';
        }
        if (videoPreview) {
          videoPreview.src = '';
          videoPreview.style.display = 'none';
        }
      } else {
        if (videoPreview) {
          videoPreview.src = videoUrl;
          videoPreview.style.display = 'block';
        }
        if (youtubePreview) {
          youtubePreview.src = '';
          youtubePreview.style.display = 'none';
        }
      }

      if (videoPlaceholder) videoPlaceholder.style.display = 'none';
      if (statusBadge) {
        statusBadge.textContent = ytEmbed ? '🔴 Vídeo YouTube Ativo' : 'Vídeo Customizado Ativo';
        statusBadge.style.background = ytEmbed ? 'rgba(255, 61, 87, 0.18)' : 'rgba(0, 240, 255, 0.15)';
        statusBadge.style.borderColor = ytEmbed ? '#FF3D57' : '#00F0FF';
        statusBadge.style.color = ytEmbed ? '#FF6B7F' : '#00F0FF';
      }
      if (urlInput) urlInput.value = videoUrl;
      if (btnRemove) btnRemove.style.display = 'inline-block';
    } else {
      if (videoPreview) {
        videoPreview.src = '';
        videoPreview.style.display = 'none';
      }
      if (youtubePreview) {
        youtubePreview.src = '';
        youtubePreview.style.display = 'none';
      }
      if (videoPlaceholder) videoPlaceholder.style.display = 'block';
      if (statusBadge) {
        statusBadge.textContent = 'Animação Padrão';
        statusBadge.style.background = 'rgba(85,135,179,0.15)';
        statusBadge.style.borderColor = '#5587B3';
        statusBadge.style.color = '#7fb2dd';
      }
      if (urlInput) urlInput.value = '';
      if (btnRemove) btnRemove.style.display = 'none';
    }
  }

  setupVideoUploadControls() {
    const dropzone = document.getElementById('conf-video-dropzone');
    const fileInput = document.getElementById('conf-video-file-input');
    const btnUpload = document.getElementById('btn-upload-video-now');
    const btnRemove = document.getElementById('btn-remove-custom-video');
    const btnSaveUrl = document.getElementById('btn-save-video-url');
    const urlInput = document.getElementById('conf-video-url-input');
    const progressWrap = document.getElementById('conf-video-progress-wrap');
    const progressBar = document.getElementById('conf-video-progress-bar');
    const progressPct = document.getElementById('conf-video-progress-pct');
    const videoPreview = document.getElementById('conf-video-preview');
    const videoPlaceholder = document.getElementById('conf-video-placeholder');

    let selectedVideoFile = null;

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = '#00F0FF';
        dropzone.style.background = 'rgba(0, 240, 255, 0.08)';
      });

      dropzone.addEventListener('dragleave', () => {
        dropzone.style.borderColor = 'rgba(85,135,179,0.4)';
        dropzone.style.background = 'rgba(255,255,255,0.02)';
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = 'rgba(85,135,179,0.4)';
        dropzone.style.background = 'rgba(255,255,255,0.02)';
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleFileSelected(e.dataTransfer.files[0]);
        }
      });

      fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files[0]) {
          handleFileSelected(fileInput.files[0]);
        }
      });
    }

    const handleFileSelected = (file) => {
      if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|mkv)$/i.test(file.name)) {
        this.showToast('⚠️ Por favor selecione um arquivo de vídeo válido (.mp4, .webm).', 'warn');
        return;
      }
      if (file.size > 150 * 1024 * 1024) {
        this.showToast('⚠️ O vídeo excede o limite de 150 MB.', 'warn');
        return;
      }

      selectedVideoFile = file;
      const objectUrl = URL.createObjectURL(file);
      if (videoPreview) {
        videoPreview.src = objectUrl;
        videoPreview.style.display = 'block';
        videoPreview.play().catch(() => {});
      }
      if (videoPlaceholder) videoPlaceholder.style.display = 'none';
      if (btnUpload) {
        btnUpload.style.display = 'inline-block';
        btnUpload.textContent = `⬆️ Enviar "${file.name.slice(0, 18)}..." (${(file.size / (1024*1024)).toFixed(1)} MB)`;
      }
      this.showToast(`Arquivo "${file.name}" selecionado! Clique em "Iniciar Envio".`, 'ok');
    };

    if (btnUpload) {
      btnUpload.addEventListener('click', async () => {
        if (!selectedVideoFile || !this.selectedStationId) {
          this.showToast('⚠️ Selecione um arquivo de vídeo para enviar.', 'warn');
          return;
        }

        const formData = new FormData();
        formData.append('video', selectedVideoFile);

        if (progressWrap) progressWrap.style.display = 'block';
        if (progressBar) progressBar.style.width = '0%';
        if (progressPct) progressPct.textContent = '0%';
        btnUpload.disabled = true;

        try {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `/api/v1/totems/${encodeURIComponent(this.selectedStationId)}/video`);
          if (this.token) {
            xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);
          }

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              if (progressBar) progressBar.style.width = `${pct}%`;
              if (progressPct) progressPct.textContent = `${pct}%`;
            }
          };

          xhr.onload = async () => {
            btnUpload.disabled = false;
            if (xhr.status >= 200 && xhr.status < 300) {
              const res = JSON.parse(xhr.responseText);
              if (res.success && res.data?.videoUrl) {
                this.updateVideoUI(res.data.videoUrl);
                this.showToast('🎉 Vídeo de higienização enviado e sincronizado com o Totem!', 'ok');
                selectedVideoFile = null;
                await this.fetchBackendData();
              } else {
                this.showToast(res.message || 'Erro ao enviar vídeo.', 'err');
              }
            } else {
              this.showToast('Falha no upload do vídeo.', 'err');
            }
          };

          xhr.onerror = () => {
            btnUpload.disabled = false;
            this.showToast('Erro de conexão durante o upload do vídeo.', 'err');
          };

          xhr.send(formData);
        } catch (err) {
          btnUpload.disabled = false;
          this.showToast('Erro ao iniciar envio do vídeo.', 'err');
        }
      });
    }

    if (btnSaveUrl) {
      btnSaveUrl.addEventListener('click', async () => {
        const url = (urlInput ? urlInput.value.trim() : '');
        if (!url || !this.selectedStationId) {
          this.showToast('⚠️ Insira uma URL de vídeo válida.', 'warn');
          return;
        }

        try {
          const res = await fetch(`/api/v1/totems/${encodeURIComponent(this.selectedStationId)}/video`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.token}`
            },
            body: JSON.stringify({ videoUrl: url })
          }).then(r => r.json());

          if (res.success && res.data?.videoUrl) {
            this.updateVideoUI(res.data.videoUrl);
            this.showToast('✅ URL de vídeo vinculada à máquina com sucesso!', 'ok');
            await this.fetchBackendData();
          } else {
            this.showToast(res.message || 'Erro ao salvar URL do vídeo.', 'err');
          }
        } catch (err) {
          this.showToast('Erro ao comunicar com o servidor.', 'err');
        }
      });
    }

    if (btnRemove) {
      btnRemove.addEventListener('click', async () => {
        if (!confirm('Deseja realmente remover o vídeo customizado desta máquina e voltar à animação padrão?')) {
          return;
        }
        if (!this.selectedStationId) return;

        try {
          const res = await fetch(`/api/v1/totems/${encodeURIComponent(this.selectedStationId)}/video`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${this.token}` }
          }).then(r => r.json());

          if (res.success) {
            this.updateVideoUI(null);
            this.showToast('✅ Vídeo removido. Máquina restaurada para a animação padrão.', 'ok');
            await this.fetchBackendData();
          } else {
            this.showToast(res.message || 'Erro ao remover vídeo.', 'err');
          }
        } catch (err) {
          this.showToast('Erro ao comunicar com o servidor.', 'err');
        }
      });
    }
  }

  openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add('open');
  }

  showToast(msg, kind = 'ok') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast-msg';

    const icons = { ok: '✅', warn: '🛠️', admin: '🔒', err: '⚠️' };
    const borders = {
      ok: 'rgba(0,197,102,.45)',
      warn: 'rgba(255,145,0,.5)',
      admin: 'rgba(253,203,36,.5)',
      err: 'rgba(255,61,87,.5)'
    };

    toast.style.borderColor = borders[kind] || borders.ok;
    toast.innerHTML = `<span style="font-size:16px; margin-right:8px;">${icons[kind] || '✅'}</span><span>${msg}</span>`;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  /* ============================================================
     Sincronização com o Backend
     ============================================================ */
  async fetchBackendData() {
    try {
      const headers = this.token ? { 'Authorization': `Bearer ${this.token}` } : {};

      const [resTotems, resDepots, resUsers, resAlerts, resTransactions, resCoupons, resStats] = await Promise.all([
        fetch('/api/v1/admin/totems', { headers }).then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/v1/admin/depots', { headers }).then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/v1/admin/users', { headers }).then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/v1/admin/alerts', { headers }).then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/v1/admin/transactions', { headers }).then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/v1/coupons').then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/v1/admin/stats', { headers }).then(r => r.json()).catch(() => ({ success: false }))
      ]);

      if (resTotems.success && Array.isArray(resTotems.data)) {
        this.stations = resTotems.data.map(t => this.normalizeTotem(t));
        this.state.totems = this.stations;
      }

      if (resDepots.success && Array.isArray(resDepots.data)) {
        this.locais = resDepots.data;
        this.state.depots = this.locais;
      }

      if (resUsers.success && Array.isArray(resUsers.data)) {
        this.state.users = resUsers.data;
        this.donosList = resUsers.data.map(u => u.responsible_name || u.company_name || u.username);
      }

      if (resAlerts.success && Array.isArray(resAlerts.data)) {
        this.oms = resAlerts.data;
        this.state.alerts = this.oms;
      }

      if (resTransactions.success && Array.isArray(resTransactions.data)) {
        this.transactions = resTransactions.data;
        this.state.transactions = this.transactions;
      }

      if (resCoupons.success && Array.isArray(resCoupons.data)) {
        this.state.coupons = resCoupons.data;
      }

      if (resStats.success && resStats.data) {
        this.state.stats = resStats.data;
      }

      this.renderAll();
    } catch (_) {}
  }

  normalizeTotem(t) {
    const pos = hashPosition(t.devno);
    const statusKey = (t.status || 'IDLE').toUpperCase();
    const isOnline = t.status !== 'OFFLINE';

    return {
      id: t.devno,
      nome: t.name || `Totem #${t.devno}`,
      code: t.devno,
      devno: t.devno,
      local: t.location || 'Ponto a Cadastrar',
      filial: t.branno || 'SP Regional',
      endereco: t.location || 'Ponto de Instalação',
      ponto: t.location || 'Ponto de Instalação',
      dono: t.owner || 'Jonathan Silveira',
      status: statusKey,
      plano: 'Intermediária',
      etapa: t.currentCycle?.step || (statusKey === 'CLEANING' ? 'Higienização em andamento' : (statusKey === 'IDLE' ? 'Ocioso — pronto para uso' : statusKey)),
      pct: statusKey === 'CLEANING' ? 45 : (statusKey === 'IDLE' ? 100 : 0),
      restante: '—',
      temp: `${t.temperature || 32} °C`,
      trava: t.doorLocked ? 'Travada' : 'Destravada',
      uv: t.liquidLevelPercent !== undefined ? t.liquidLevelPercent : 100,
      fr: t.fragranceLevelPercent !== undefined ? t.fragranceLevelPercent : 100,
      fat: fmtBRL(t.revenueToday || 0),
      fatVal: t.revenueToday || 0,
      ciclos: t.totalCyclesToday || 0,
      x: pos.left,
      y: pos.top,
      raw: t
    };
  }

  /* ============================================================
     Renderizadores de Páginas
     ============================================================ */
  renderAll() {
    this.renderEstacoes();
    this.renderLocais();
    this.renderDashboard();
    this.renderCoupons();
    this.renderCadastros();
    this.populateSelectors();
  }

  populateSelectors() {
    const users = this.state.users || [];
    let ownerOptions = '';
    if (users.length > 0) {
      ownerOptions = users.map(u => {
        const label = u.role === 'CRPADMIN'
          ? `${u.responsible_name || u.username} (Super Admin)`
          : `${u.responsible_name || u.username}${u.company_name ? ` — ${u.company_name}` : ''}`;
        return `<option value="${u.id}">${label}</option>`;
      }).join('');
    } else {
      ownerOptions = '<option value="USR-CRPADMIN">Jonathan (Super Admin)</option>';
    }

    const totemOptions = (this.stations.length > 0 ? this.stations : [])
      .map(s => `<option value="${s.devno}">${s.nome} (${s.devno}) — ${s.local}</option>`).join('');

    const depotOptions = (this.locais.length > 0 ? this.locais : [])
      .map(l => `<option value="${l.name}">${l.name}</option>`).join('');

    const selQuickTotem = document.getElementById('quick-transfer-totem');
    const selQuickOwner = document.getElementById('quick-transfer-owner');
    const selModalOwner = document.getElementById('modal-select-new-owner');
    const selMoveTotem = document.getElementById('move-select-totem');
    const selMoveLoc = document.getElementById('move-new-location');

    if (selQuickTotem) selQuickTotem.innerHTML = totemOptions || '<option value="">Nenhuma máquina cadastrada</option>';
    if (selQuickOwner) selQuickOwner.innerHTML = ownerOptions;
    if (selModalOwner) selModalOwner.innerHTML = ownerOptions;
    if (selMoveTotem) selMoveTotem.innerHTML = totemOptions || '<option value="">Nenhuma máquina cadastrada</option>';
    if (selMoveLoc && depotOptions) selMoveLoc.innerHTML = depotOptions;

    // Profile counters
    const pmActive = document.getElementById('pm-active-totems');
    const pmTotal = document.getElementById('pm-total-totems');
    const pmLocais = document.getElementById('pm-locais-count');
    const pmAlerts = document.getElementById('pm-alerts-count');

    const onlineCount = this.stations.filter(s => s.status === 'IDLE' || s.status === 'CLEANING').length;
    if (pmActive) pmActive.textContent = onlineCount;
    if (pmTotal) pmTotal.textContent = this.stations.length;
    if (pmLocais) pmLocais.textContent = this.locais.length;
    if (pmAlerts) pmAlerts.textContent = this.oms.length;
  }

  // --- 1. ESTAÇÕES ---
  renderEstacoes() {
    const q = this.searchTerm;
    const list = this.stations.filter(s => {
      if (!q) return true;
      return s.nome.toLowerCase().includes(q) ||
             s.code.toLowerCase().includes(q) ||
             s.local.toLowerCase().includes(q) ||
             s.dono.toLowerCase().includes(q);
    });

    const totalRevenueToday = list.reduce((acc, s) => acc + (s.fatVal || 0), 0);
    const totalCyclesToday = list.reduce((acc, s) => acc + (s.ciclos || 0), 0);
    const activeCount = list.filter(s => s.status === 'IDLE' || s.status === 'CLEANING').length;
    const cleaningCount = list.filter(s => s.status === 'CLEANING').length;
    const alertsCount = list.filter(s => s.status === 'ERROR' || s.status === 'MAINTENANCE').length;
    const failuresCount = list.filter(s => s.status === 'ERROR').length;
    const maintCount = list.filter(s => s.status === 'MAINTENANCE').length;

    const elRev = document.getElementById('kpi-revenue');
    const elCycles = document.getElementById('kpi-cycles');
    const elActive = document.getElementById('kpi-totems');
    const elCleaning = document.getElementById('kpi-cleaning-count');
    const elAlerts = document.getElementById('kpi-alerts');
    const elAlertsSub = document.getElementById('kpi-alerts-sub');

    if (elRev) elRev.textContent = fmtBRL(totalRevenueToday);
    if (elCycles) elCycles.textContent = totalCyclesToday;
    if (elActive) elActive.innerHTML = `${activeCount}<span style="color:#8a97a7">/${list.length}</span> <span style="font-size:13px; color:#8a97a7; font-family:var(--font-body); font-weight:500;">online</span>`;
    if (elCleaning) elCleaning.textContent = cleaningCount;
    if (elAlerts) elAlerts.textContent = alertsCount;
    if (elAlertsSub) elAlertsSub.textContent = alertsCount === 0 ? 'Nenhum alerta ativo' : `${failuresCount} em falha · ${maintCount} em manutenção`;

    // Render Map Pins
    const mapContainer = document.getElementById('estacoes-map-markers');
    if (mapContainer) {
      if (list.length === 0) {
        mapContainer.innerHTML = '';
      } else {
        mapContainer.innerHTML = list.map(s => {
          const m = this.meta[s.status] || this.meta.IDLE;
          const isRun = s.status === 'CLEANING';
          return `
            <button class="map-marker ${isRun ? 'is-cleaning' : ''}" style="left:${s.x}; top:${s.y}; --dot-color:${m.color};" onclick="window.app.openStationDetails('${s.id}')" title="${s.nome} — ${m.label}">
              <span class="pin-tag">${s.code}</span>
              <span class="pin-dot"></span>
            </button>
          `;
        }).join('');
      }
    }

    // Render Grouped Stations by Location
    const container = document.getElementById('estacoes-grouped-container');
    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = `
        <div style="background:rgba(255,255,255,0.03); border:1px dashed rgba(255,255,255,0.15); border-radius:16px; padding:40px; text-align:center; color:#8a97a7;">
          <div style="font-size:32px; margin-bottom:10px;">🏍️</div>
          <div style="font-size:16px; font-weight:700; color:#fff; margin-bottom:6px;">Aguardando conexão de totens na rede</div>
          <div style="font-size:13px; max-width:560px; margin:0 auto; line-height:1.5;">Assim que uma estação de higienização se conectar ao servidor e enviar o primeiro heartbeat, ela aparecerá automaticamente aqui sob o perfil ADMIN e poderá ser repassada para outro dono.</div>
        </div>
      `;
      return;
    }

    const grupos = {};
    list.forEach(s => {
      const locKey = s.local || 'Ponto a Cadastrar';
      if (!grupos[locKey]) {
        grupos[locKey] = { nome: locKey, filial: s.filial, stations: [], soma: 0 };
      }
      grupos[locKey].stations.push(s);
      grupos[locKey].soma += s.fatVal || 0;
    });

    container.innerHTML = Object.values(grupos).map(g => `
      <div class="station-group">
        <div class="station-group-head">
          <h2>${g.nome}</h2>
          <span class="sub">${g.filial}</span>
          <div class="rule"></div>
          <span class="rev">${fmtBRL(g.soma)}</span>
        </div>
        <div class="totem-grid">
          ${g.stations.map(s => {
            const m = this.meta[s.status] || this.meta.IDLE;
            const isRun = s.status === 'CLEANING';
            const isIdle = s.status === 'IDLE';
            const pct = isRun ? (s.pct || 0) : (isIdle ? 100 : 0);

            return `
              <div class="totem-card status-${s.status.toLowerCase()}" onclick="window.app.openStationDetails('${s.id}')">
                <div class="totem-card-top">
                  <span class="name">${s.nome}</span>
                  <span class="status-pill ${isRun ? 'is-cleaning' : ''}" style="--pill-bg:${m.chip}; --pill-fg:${m.color};">
                    <i></i>${m.label}
                  </span>
                </div>
                <div class="totem-card-loc">${s.ponto} · dono ${s.dono}</div>
                <div class="cycle-box ${isRun ? 'is-active' : ''}">
                  <div class="cycle-box-top">
                    <span class="gear">⚙️</span>
                    <div class="cycle-box-info">
                      <div class="title">${s.etapa}</div>
                      <div class="sub">${isRun ? `Plano ${s.plano} · em andamento` : (isIdle ? `Plano padrão · pronto` : 'Aguardando')}</div>
                    </div>
                    <span class="cycle-box-pct" style="color:${m.color};">${isRun ? `${pct}%` : (isIdle ? 'Pronto' : '—')}</span>
                  </div>
                  <div class="cycle-bar-bg">
                    <div class="cycle-bar-fill ${isRun ? 'animated' : 'solid'}" style="width:${pct}%; --fill-color:${m.color};"></div>
                  </div>
                </div>
                <div class="totem-card-foot">
                  <span class="rev">${s.fat}</span>
                  <span>${s.ciclos} ciclos</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `).join('');
  }

  // Abre Modal de Detalhes da Estação
  openStationDetails(stationId) {
    const s = this.stations.find(st => st.id === stationId || st.devno === stationId);
    if (!s) return;
    this.selectedStationId = s.devno || s.id;

    const m = this.meta[s.status] || this.meta.IDLE;
    const isRun = s.status === 'CLEANING';

    document.getElementById('modal-totem-name').textContent = s.nome;
    document.getElementById('modal-totem-location').textContent = `${s.endereco} · ${s.filial}`;
    document.getElementById('modal-owner-val').textContent = s.dono;
    document.getElementById('modal-ponto-val').textContent = s.ponto;
    document.getElementById('modal-cycle-stage').textContent = s.etapa;
    document.getElementById('modal-cycle-sub').textContent = isRun ? `Plano ${s.plano} · em andamento` : 'Ocioso — pronto para higienizar';
    document.getElementById('modal-cycle-pct').textContent = isRun ? `${s.pct}%` : (s.status === 'IDLE' ? 'Pronto' : '—');
    document.getElementById('modal-cycle-bar').style.width = isRun ? `${s.pct}%` : (s.status === 'IDLE' ? '100%' : '0%');
    document.getElementById('modal-stat-temp').textContent = s.temp;
    document.getElementById('modal-stat-door').textContent = s.trava;
    document.getElementById('modal-stat-door').style.color = s.trava === 'Travada' ? '#00C566' : '#FF9100';
    document.getElementById('modal-stat-rev').textContent = s.fat;
    document.getElementById('modal-stat-cycles').textContent = s.ciclos;
    document.getElementById('modal-current-owner-lbl').textContent = `Dono atual: ${s.dono}`;

    const selModalOwner = document.getElementById('modal-select-new-owner');
    if (selModalOwner && s.raw?.owner_id) {
      selModalOwner.value = s.raw.owner_id;
    }

    // Admin Ownership Card: visível apenas para CRPADMIN
    const modalAdminOwnerCard = document.getElementById('modal-admin-owner-card');
    if (modalAdminOwnerCard) {
      modalAdminOwnerCard.style.display = (this.currentUser?.role === 'CRPADMIN') ? 'block' : 'none';
    }

    // Status Pill
    const pill = document.getElementById('modal-status-pill');
    pill.style.background = m.chip;
    pill.style.color = m.color;
    document.getElementById('modal-status-text').textContent = m.label;
    document.getElementById('modal-status-dot').style.background = m.color;

    // Rings - Nível de Sanitizante UV e Fragrância do sensor real da máquina
    const uvRing = document.getElementById('modal-uv-ring');
    const frRing = document.getElementById('modal-fr-ring');
    const uvText = document.getElementById('modal-uv-text');
    const frText = document.getElementById('modal-fr-text');
    const uvSub = document.getElementById('modal-uv-sensor-sub');

    const isLiquidOk = s.raw?.isLiquidLevelOk !== undefined ? Boolean(s.raw.isLiquidLevelOk) : (s.uv > 10);
    const liquidPct = s.raw?.liquidLevelPercent !== undefined ? s.raw.liquidLevelPercent : (isLiquidOk ? 100 : 0);
    const liquidColor = isLiquidOk ? '#00C566' : '#FF3D57';

    if (uvText) {
      uvText.textContent = isLiquidOk ? `${liquidPct}%` : 'BAIXO';
      uvText.style.color = liquidColor;
    }
    if (uvSub) {
      uvSub.textContent = isLiquidOk ? '✓ Sensor: Nível Normal / OK' : '⚠️ Sensor: Nível Baixo (Reabastecer)';
      uvSub.style.color = isLiquidOk ? '#7fb2dd' : '#FF6B7F';
    }
    if (uvRing) {
      uvRing.style.background = `conic-gradient(${liquidColor} ${liquidPct * 3.6}deg, rgba(255,255,255,.09) 0deg)`;
    }

    if (frText) frText.textContent = `${s.fr}%`;
    if (frRing) frRing.style.background = `conic-gradient(#FDCB24 ${s.fr * 3.6}deg, rgba(255,255,255,.09) 0deg)`;

    // Carrega campos do form config
    const rawCfg = s.raw?.config || {};
    const modes = rawCfg.modes || {};
    const basica = modes.basica || {};
    const inter = modes.intermediaria || {};
    const avanc = modes.avancada || {};
    const pm = rawCfg.paymentMethods || {};

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = Boolean(val); };

    // Básica
    setChk('conf-basic-enabled', basica.isEnabled !== false);
    setVal('conf-basic-price', rawCfg.basicPrice ? Number(rawCfg.basicPrice).toFixed(2) : (basica.priceInCents ? (basica.priceInCents / 100).toFixed(2) : '14.00'));
    setVal('conf-basic-uv', basica.uvSeconds ?? 60);
    setVal('conf-basic-mist', basica.mistSpraySeconds ?? 15);
    setVal('conf-basic-sat', basica.mistSaturationSeconds ?? 45);
    setVal('conf-basic-dry', basica.thermalDryingSeconds ?? 120);
    setVal('conf-basic-ozone', basica.ozoneExhaustSeconds ?? 115);
    setVal('conf-basic-frag', basica.fragranceSeconds ?? 5);

    // Intermediária
    setChk('conf-inter-enabled', inter.isEnabled !== false);
    setVal('conf-inter-price', rawCfg.intermediatePrice ? Number(rawCfg.intermediatePrice).toFixed(2) : (inter.priceInCents ? (inter.priceInCents / 100).toFixed(2) : '17.00'));
    setVal('conf-inter-uv', inter.uvSeconds ?? 75);
    setVal('conf-inter-mist', inter.mistSpraySeconds ?? 20);
    setVal('conf-inter-sat', inter.mistSaturationSeconds ?? 45);
    setVal('conf-inter-dry', inter.thermalDryingSeconds ?? 150);
    setVal('conf-inter-ozone', inter.ozoneExhaustSeconds ?? 125);
    setVal('conf-inter-frag', inter.fragranceSeconds ?? 5);

    // Avançada
    setChk('conf-adv-enabled', avanc.isEnabled !== false);
    setVal('conf-adv-price', rawCfg.advancedPrice ? Number(rawCfg.advancedPrice).toFixed(2) : (avanc.priceInCents ? (avanc.priceInCents / 100).toFixed(2) : '20.00'));
    setVal('conf-adv-uv', avanc.uvSeconds ?? 90);
    setVal('conf-adv-mist', avanc.mistSpraySeconds ?? 25);
    setVal('conf-adv-sat', avanc.mistSaturationSeconds ?? 45);
    setVal('conf-adv-dry', avanc.thermalDryingSeconds ?? 180);
    setVal('conf-adv-ozone', avanc.ozoneExhaustSeconds ?? 135);
    setVal('conf-adv-frag', avanc.fragranceSeconds ?? 5);

    // Métodos de pagamento
    setChk('conf-pay-pix', pm.isPixEnabled !== false && rawCfg.isPixEnabled !== false);
    setChk('conf-pay-credit', Boolean(pm.isCreditEnabled || rawCfg.isCreditEnabled));
    setChk('conf-pay-debit', Boolean(pm.isDebitEnabled || rawCfg.isDebitEnabled));
    setChk('conf-pay-free', pm.isCouponsEnabled !== false && rawCfg.isCouponsEnabled !== false);

    // Credenciais Cielo
    setVal('conf-cielo-id', rawCfg.cieloMerchantId || '');
    setVal('conf-cielo-key', rawCfg.cieloMerchantKey || '');

    // Atualiza labels de tempo total
    const updateTimeLabels = () => {
      const bSec = (Number(document.getElementById('conf-basic-uv')?.value) || 60) + (Number(document.getElementById('conf-basic-mist')?.value) || 15) + (Number(document.getElementById('conf-basic-sat')?.value) || 45) + (Number(document.getElementById('conf-basic-dry')?.value) || 120) + (Number(document.getElementById('conf-basic-ozone')?.value) || 115) + (Number(document.getElementById('conf-basic-frag')?.value) || 5);
      const iSec = (Number(document.getElementById('conf-inter-uv')?.value) || 75) + (Number(document.getElementById('conf-inter-mist')?.value) || 20) + (Number(document.getElementById('conf-inter-sat')?.value) || 45) + (Number(document.getElementById('conf-inter-dry')?.value) || 150) + (Number(document.getElementById('conf-inter-ozone')?.value) || 125) + (Number(document.getElementById('conf-inter-frag')?.value) || 5);
      const aSec = (Number(document.getElementById('conf-adv-uv')?.value) || 90) + (Number(document.getElementById('conf-adv-mist')?.value) || 25) + (Number(document.getElementById('conf-adv-sat')?.value) || 45) + (Number(document.getElementById('conf-adv-dry')?.value) || 180) + (Number(document.getElementById('conf-adv-ozone')?.value) || 135) + (Number(document.getElementById('conf-adv-frag')?.value) || 5);

      const elBTotal = document.getElementById('lbl-basic-total'); if (elBTotal) elBTotal.textContent = bSec;
      const elBMin = document.getElementById('lbl-basic-min'); if (elBMin) elBMin.textContent = Math.round(bSec / 60);
      const elITotal = document.getElementById('lbl-inter-total'); if (elITotal) elITotal.textContent = iSec;
      const elIMin = document.getElementById('lbl-inter-min'); if (elIMin) elIMin.textContent = Math.round(iSec / 60);
      const elATotal = document.getElementById('lbl-adv-total'); if (elATotal) elATotal.textContent = aSec;
      const elAMin = document.getElementById('lbl-adv-min'); if (elAMin) elAMin.textContent = Math.round(aSec / 60);
    };
    updateTimeLabels();

    // Sincroniza estado do vídeo de higienização
    this.updateVideoUI(rawCfg.cleaningVideoUrl || s.raw?.cleaningVideoUrl || null);

    this.openModal('detail-modal');
  }

  // --- 2. LOCAIS ---
  renderLocais() {
    const isAdmin = this.currentUser?.role === 'CRPADMIN';
    const q = this.searchTerm;
    const list = this.locais.filter(l => {
      if (!q) return true;
      return (l.name || '').toLowerCase().includes(q) ||
             (l.depotno || '').toLowerCase().includes(q) ||
             (l.branno || '').toLowerCase().includes(q);
    });

    const countEl = document.getElementById('locais-table-count');
    if (countEl) countEl.textContent = `${list.length} registros`;

    const tbody = document.getElementById('locais-tbody');
    if (tbody) {
      if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${isAdmin ? 10 : 9}" style="text-align:center; padding:24px; color:#8a97a7;">Nenhum local cadastrado.</td></tr>`;
      } else {
        tbody.innerHTML = list.map(l => `
          <tr>
            <td class="mono accent">${l.depotno || 'LC'}</td>
            <td style="font-weight:600; color:#fff;">${l.name}</td>
            <td class="muted">${l.branno || 'SP Regional'}</td>
            <td class="muted">${l.address || '—'}</td>
            <td class="mono">${l.totemCount ? `${l.totemCount} totem(s)` : '—'}</td>
            <td class="muted">${l.dailyTrafficEstimate ? `${l.dailyTrafficEstimate}/dia` : '—'}</td>
            <td class="mono yellow">${l.commissionPercent || 0}%</td>
            <td class="mono green">${fmtBRL(l.revenueToday || 0)}</td>
            <td><span class="status-chip active">Ativo</span></td>
            ${isAdmin ? `
            <td style="text-align:right;">
              <button class="btn btn-blue" style="padding:6px 12px; font-size:11.5px;" onclick="window.app.openMoveModal('${l.depotno}', '${l.name}')">Mudar Local</button>
            </td>` : ''}
          </tr>
        `).join('');
      }
    }

    // Mapa de Pontos
    const mapMarkers = document.getElementById('locais-map-markers');
    if (mapMarkers) {
      mapMarkers.innerHTML = this.stations.map(s => {
        const m = this.meta[s.status] || this.meta.IDLE;
        return `
          <button class="map-marker" style="left:${s.x}; top:${s.y}; --dot-color:${m.color};" onclick="window.app.openStationDetails('${s.id}')" title="${s.local}">
            <span class="pin-tag">${s.code}</span>
            <span class="pin-dot"></span>
          </button>
        `;
      }).join('');
    }

    // Lista de Realocações Rápidas
    const relocList = document.getElementById('realocacoes-list');
    if (relocList) {
      if (this.stations.length === 0) {
        relocList.innerHTML = `<div style="color:#8a97a7; font-size:12.5px;">Nenhuma máquina disponível para realocação.</div>`;
      } else {
        relocList.innerHTML = this.stations.map(s => {
          const m = this.meta[s.status] || this.meta.IDLE;
          return `
            <div class="reloc-row">
              <span class="reloc-dot" style="background:${m.color};"></span>
              <div class="reloc-info">
                <div class="name">${s.nome}</div>
                <div class="loc">atualmente em ${s.local}</div>
              </div>
              <button class="btn btn-yellow-outline" style="padding:7px 13px; font-size:11.5px;" onclick="window.app.openMoveModal('${s.devno}', '${s.local}')">Mudar Local</button>
            </div>
          `;
        }).join('');
      }
    }
  }

  openMoveModal(totemName, currentLoc) {
    document.getElementById('move-current-location').value = currentLoc || 'Ponto a Cadastrar';
    const sel = document.getElementById('move-select-totem');
    if (sel) {
      sel.innerHTML = this.stations.map(s => `<option value="${s.devno}" ${s.devno === totemName ? 'selected' : ''}>${s.nome} (${s.devno})</option>`).join('');
    }
    const selLoc = document.getElementById('move-new-location');
    if (selLoc) {
      if (this.locais.length === 0) {
        selLoc.innerHTML = `<option value="">Nenhum outro local cadastrado</option>`;
      } else {
        selLoc.innerHTML = this.locais.map(l => `<option value="${l.depotno}">${l.name} (${l.depotno})</option>`).join('');
      }
    }
    this.openModal('move-modal');
  }

  // --- 3. DASHBOARD GERAL ---
  renderDashboard() {
    const totalRev = this.stations.reduce((acc, s) => acc + (s.fatVal || 0), 0);
    const totalCyc = this.stations.reduce((acc, s) => acc + (s.ciclos || 0), 0);
    const activeTotems = this.stations.filter(s => s.status === 'IDLE' || s.status === 'CLEANING').length;
    const openOms = this.oms.length;

    const elTotalRev = document.getElementById('dash-total-revenue');
    const elTotalCycles = document.getElementById('dash-total-cycles');
    const elActiveTotems = document.getElementById('dash-active-totems-count');
    const elOpenOms = document.getElementById('dash-open-oms-count');
    const elPeriodTotal = document.getElementById('dash-chart-period-total');

    if (elTotalRev) elTotalRev.textContent = fmtBRL(totalRev);
    if (elTotalCycles) elTotalCycles.textContent = totalCyc;
    if (elActiveTotems) elActiveTotems.innerHTML = `${activeTotems}<span style="color:#8a97a7">/${this.stations.length}</span>`;
    if (elOpenOms) elOpenOms.textContent = openOms;
    if (elPeriodTotal) elPeriodTotal.textContent = `${fmtBRL(totalRev)} no período`;

    // 1. Gráfico SVG de Histórico Real
    const dias = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Hoje'];
    const serieRaw = [0, 0, 0, 0, 0, 0, totalRev];
    const maxS = Math.max(...serieRaw, 100);
    const minS = 0;
    const W = 720, H = 210, pad = 8;

    const px = i => pad + i * (W - pad * 2) / (serieRaw.length - 1);
    const py = v => H - 14 - (v - minS) / (maxS - minS || 1) * (H - 40);
    const pts = serieRaw.map((v, i) => ({ x: px(i), y: py(v), v, label: dias[i] }));

    let linePath = '';
    pts.forEach((p, i) => {
      if (!i) { linePath += `M${p.x},${p.y}`; return; }
      const q = pts[i - 1], cx = (q.x + p.x) / 2;
      linePath += ` C${cx},${q.y} ${cx},${p.y} ${p.x},${p.y}`;
    });
    const areaPath = linePath + ` L${pts[pts.length - 1].x},${H} L${pts[0].x},${H} Z`;

    const elSvgLine = document.getElementById('dash-svg-line');
    const elSvgArea = document.getElementById('dash-svg-area');
    const elSvgGrid = document.getElementById('dash-svg-grid-lines');
    const elSvgPts = document.getElementById('dash-svg-points');
    const elXAxis = document.getElementById('dash-chart-x-axis');

    if (elSvgLine) elSvgLine.setAttribute('d', linePath);
    if (elSvgArea) elSvgArea.setAttribute('d', areaPath);
    if (elSvgGrid) {
      elSvgGrid.innerHTML = [0, 0.25, 0.5, 0.75, 1].map(t => {
        const y = 14 + t * (H - 40);
        return `<line x1="0" x2="720" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.06)" stroke-width="1"></line>`;
      }).join('');
    }
    if (elSvgPts) {
      elSvgPts.innerHTML = pts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#0c0e11" stroke="#00C566" stroke-width="2"></circle>`).join('');
    }
    if (elXAxis) {
      elXAxis.innerHTML = pts.map(p => `<span>${p.label}</span>`).join('');
    }

    // 2. Ranking por Máquina
    const elRankMaq = document.getElementById('dash-ranking-maquinas');
    if (elRankMaq) {
      if (this.stations.length === 0) {
        elRankMaq.innerHTML = `<div style="color:#8a97a7; font-size:12px;">Nenhuma transação acumulada.</div>`;
      } else {
        const sorted = [...this.stations].sort((a, b) => (b.fatVal || 0) - (a.fatVal || 0));
        const maxVal = sorted[0]?.fatVal || 1;
        elRankMaq.innerHTML = sorted.map((m, idx) => `
          <div class="rank-item">
            <div class="rank-row">
              <span class="rank-idx">${idx + 1}</span>
              <span class="rank-name">${m.nome}</span>
              <span class="rank-val">${m.fat}</span>
            </div>
            <div class="rank-bar-bg">
              <div class="rank-bar-fill" style="width:${Math.max(8, Math.round(((m.fatVal || 0) / maxVal) * 100))}%;"></div>
            </div>
          </div>
        `).join('');
      }
    }

    // 3. Ranking por Dono
    const elRankDono = document.getElementById('dash-ranking-donos');
    if (elRankDono) {
      const donosMap = {};
      this.stations.forEach(s => {
        if (!donosMap[s.dono]) donosMap[s.dono] = { name: s.dono, fat: 0, count: 0 };
        donosMap[s.dono].fat += s.fatVal || 0;
        donosMap[s.dono].count += 1;
      });
      const donosArr = Object.values(donosMap);
      if (donosArr.length === 0) {
        elRankDono.innerHTML = `<div style="color:#8a97a7; font-size:12px;">Nenhum dono cadastrado.</div>`;
      } else {
        const maxD = Math.max(...donosArr.map(d => d.fat), 1);
        elRankDono.innerHTML = donosArr.map(d => `
          <div class="rank-item">
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:5px;">
              <span style="color:#c8d2de;">${d.name}</span>
              <span style="font-family:var(--font-mono); color:#FDCB24;">${fmtBRL(d.fat)}</span>
            </div>
            <div style="height:8px; border-radius:999px; background:rgba(255,255,255,.07); overflow:hidden;">
              <div style="height:100%; width:${Math.max(10, Math.round((d.fat / maxD) * 100))}%; background:linear-gradient(90deg,#8a6a00,#FDCB24); border-radius:999px;"></div>
            </div>
            <div style="font-size:11px; color:#6d7a8a; margin-top:4px;">${d.count} máquina(s) atribuída(s)</div>
          </div>
        `).join('');
      }
    }

    // 4. Payback por Máquina
    const elPayback = document.getElementById('dash-payback-list');
    if (elPayback) {
      if (this.stations.length === 0) {
        elPayback.innerHTML = `<div style="color:#8a97a7; font-size:12px; padding:10px 0;">Nenhuma estação registrada para cálculo de payback.</div>`;
      } else {
        elPayback.innerHTML = this.stations.map(s => {
          const investido = 18500;
          const recuperado = s.fatVal || 0;
          const p = Math.min(100, Math.round((recuperado / investido) * 100));
          return `
            <div class="payback-row">
              <div>
                <div style="font-size:13px; font-weight:600; color:#fff;">${s.nome}</div>
                <div style="font-size:11px; color:#6d7a8a;">${s.dono}</div>
              </div>
              <div class="payback-bar-cell">
                <div style="height:8px; border-radius:999px; background:rgba(255,255,255,.07); overflow:hidden;">
                  <div style="height:100%; width:${Math.max(4, p)}%; background:linear-gradient(90deg, #00C566, rgba(255,255,255,.6)); border-radius:999px;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:10.5px; color:#6d7a8a; margin-top:5px;">
                  <span>investido ${fmtBRL(investido)}</span>
                  <span>recuperado ${fmtBRL(recuperado)}</span>
                </div>
              </div>
              <div style="text-align:right; font-family:var(--font-mono); font-size:17px; font-weight:700; color:#00C566;">${p}%</div>
              <div class="payback-hide-mobile" style="text-align:right;">
                <div style="font-family:var(--font-mono); font-size:13px; color:#e7edf4;">${fmtBRL(recuperado)}</div>
                <div style="font-size:10.5px; color:#6d7a8a;">receita total</div>
              </div>
              <div class="payback-hide-mobile" style="text-align:right;">
                <div style="font-family:var(--font-mono); font-size:13px; color:#00C566;">Em operação</div>
                <div style="font-size:10.5px; color:#6d7a8a;">status atual</div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 5. Tabela de OMs
    const elOMs = document.getElementById('dash-oms-tbody');
    if (elOMs) {
      if (this.oms.length === 0) {
        elOMs.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:18px; color:#8a97a7;">Nenhum alerta ou ordem de manutenção aberta.</td></tr>`;
      } else {
        elOMs.innerHTML = this.oms.map(o => `
          <tr>
            <td style="font-weight:600; color:#fff;">${o.totemName || o.devno}</td>
            <td class="muted">${o.message || o.type}</td>
            <td><span style="padding:4px 9px; border-radius:999px; font-size:11px; font-weight:700; background:rgba(255,145,0,.16); color:#FFB454;">${o.severity || 'MÉDIA'}</span></td>
            <td class="mono muted">${o.timestamp ? new Date(o.timestamp).toLocaleDateString() : 'Hoje'}</td>
            <td class="muted">${o.resolved ? 'Resolvido' : 'Equipe Técnica'}</td>
            <td style="color:#e7edf4;">${o.resolved ? 'Concluída' : 'Aberta'}</td>
          </tr>
        `).join('');
      }
    }
  }

  // --- 4. CUPONS & VOUCHERS ---
  renderCoupons() {
    const tbody = document.getElementById('coupons-tbody');
    if (!tbody) return;

    const list = this.state.coupons || [];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:36px; color:var(--text-muted); font-size:13.5px;">Nenhum cupom cadastrado no banco. Clique no botão acima para adicionar um novo cupom.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(c => {
      const max = c.maxUsages || 1;
      const current = c.currentUsages || 0;
      const isExhausted = current >= max || c.isUsed;
      const modeLabel = c.applicableMode ? c.applicableMode : 'Todas as Modalidades';
      const totemsLabel = (c.allowedTotems && c.allowedTotems.length > 0)
        ? `<span class="coupon-scope-badge specific" title="Válido para: ${c.allowedTotems.join(', ')}">📍 ${c.allowedTotems.join(', ')}</span>`
        : `<span class="coupon-scope-badge all">🌐 Todas as Máquinas</span>`;

      return `
        <tr>
          <td>
            <span class="coupon-code-pill" onclick="window.app.openCouponQrModal('${c.code}')" title="Clique para ver o QR Code">
              <span class="c-icon">🎟️</span> ${c.code}
            </span>
          </td>
          <td><div class="coupon-desc-text">${c.description || '--'}</div></td>
          <td>
            <span class="coupon-discount-badge">
              ${c.discountPercent}% OFF
            </span>
          </td>
          <td><span class="coupon-mode-badge">${modeLabel}</span></td>
          <td>${totemsLabel}</td>
          <td>
            <div class="coupon-usage-wrap">
              <div class="coupon-usage-text">
                <span class="usage-curr ${isExhausted ? 'exhausted' : ''}">${current}</span>
                <span class="usage-slash">/</span>
                <span class="usage-max">${max}</span>
                <span class="usage-unit">usos</span>
              </div>
              <div class="coupon-progress-track">
                <div class="coupon-progress-bar ${isExhausted ? 'exhausted' : ''}" style="width:${Math.min(100, Math.round((current / max) * 100))}%"></div>
              </div>
            </div>
          </td>
          <td>
            <span class="coupon-status-chip ${isExhausted ? 'exhausted' : 'active'}">
              <span class="status-dot"></span>
              ${isExhausted ? 'Esgotado' : 'Ativo'}
            </span>
          </td>
          <td style="text-align:right;">
            <div class="coupon-actions-row">
              <button class="btn-coupon-qr" onclick="window.app.openCouponQrModal('${c.code}')">
                <span>📱</span> QR Code
              </button>
              <button class="btn-coupon-reset" onclick="window.app.resetCoupon('${c.code}')">
                <span>🔄</span> Resetar
              </button>
              <button class="btn-coupon-delete" title="Excluir cupom" onclick="window.app.deleteCoupon('${c.code}')">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // --- 5. CADASTROS ---
  renderCadastros() {
    const tbody = document.getElementById('cadastros-tbody');
    if (!tbody) return;

    const list = this.state.users || [];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:#8a97a7;">Nenhum usuário cadastrado.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(u => `
      <tr>
        <td style="font-weight:700; color:#fff;">${u.responsible_name || u.username}</td>
        <td class="mono muted">${u.cnpj || '—'}</td>
        <td class="muted">${u.email || '—'}</td>
        <td class="muted">${u.phone || '—'}</td>
        <td>${u.company_name || '—'}</td>
        <td><span class="user-badge-role ${u.role === 'CRPADMIN' ? 'crpadmin' : 'owner'}">${u.role}</span></td>
        <td class="mono accent">${this.stations.filter(s => s.dono === (u.responsible_name || u.username)).length} máquina(s)</td>
        <td style="text-align:right;">
          <span style="color:#00C566; font-size:11px; font-weight:700;">● Ativo</span>
        </td>
      </tr>
    `).join('');
  }

  openNewCouponModal() {
    const modal = document.getElementById('new-coupon-modal');
    const scopeSelect = document.getElementById('nc-totems-scope');
    const checkboxesDiv = document.getElementById('nc-totems-checkboxes');
    if (scopeSelect) scopeSelect.value = 'TODAS';
    if (checkboxesDiv) {
      checkboxesDiv.style.display = 'none';
      checkboxesDiv.innerHTML = this.stations.map(t => `
        <label class="checkbox-row" style="margin-bottom:6px; font-size:12.5px; color:#fff; display:flex; align-items:center; gap:8px;">
          <input type="checkbox" class="nc-totem-chk" value="${t.code}">
          <span><strong>${t.code}</strong> (${t.nome} — ${t.local})</span>
        </label>
      `).join('');
    }
    this.openModal('new-coupon-modal');
  }

  openCouponQrModal(code) {
    const list = this.state.coupons || [];
    const coupon = list.find(c => c.code === code) || { code, description: 'Cupom Promocional', discountPercent: 100, maxUsages: 1, currentUsages: 0 };
    this.selectedCouponCode = code;

    const modal = document.getElementById('coupon-qrcode-modal');
    const badge = document.getElementById('qr-modal-code-badge');
    const img = document.getElementById('qr-modal-img');
    const desc = document.getElementById('qr-modal-desc');
    const discount = document.getElementById('qr-modal-discount');
    const mode = document.getElementById('qr-modal-mode');
    const totemsBadge = document.getElementById('qr-modal-totems');
    const usages = document.getElementById('qr-modal-usages');

    if (badge) badge.textContent = `🎟️ ${coupon.code}`;
    if (desc) desc.textContent = coupon.description || 'Cupom Promocional CapaXero';
    if (discount) discount.textContent = `${coupon.discountPercent}% OFF${coupon.discountPercent === 100 ? ' (GRÁTIS)' : ''}`;
    if (mode) mode.textContent = coupon.applicableMode ? `Modo: ${coupon.applicableMode}` : 'Qualquer Modalidade';
    if (totemsBadge) {
      totemsBadge.textContent = (coupon.allowedTotems && coupon.allowedTotems.length > 0)
        ? `📍 ${coupon.allowedTotems.join(', ')}`
        : '🌐 Todas as Máquinas';
    }
    if (usages) usages.textContent = `${coupon.currentUsages || 0} / ${coupon.maxUsages || 1} usos`;

    if (img) img.src = `/api/v1/coupons/${encodeURIComponent(code)}/qrcode.png?size=400&t=${Date.now()}`;
    modal.classList.add('open');
  }

  copyCurrentCouponCode() {
    if (!this.selectedCouponCode) return;
    navigator.clipboard.writeText(this.selectedCouponCode).then(() => {
      this.showToast(`📋 Código "${this.selectedCouponCode}" copiado para a área de transferência!`);
    }).catch(() => {
      this.showToast(`Código: ${this.selectedCouponCode}`);
    });
  }

  downloadCurrentCouponQr() {
    if (!this.selectedCouponCode) return;
    const a = document.createElement('a');
    a.href = `/api/v1/coupons/${encodeURIComponent(this.selectedCouponCode)}/qrcode.png?size=600`;
    a.download = `CAPAXERO_CUPOM_${this.selectedCouponCode}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    this.showToast(`💾 Download da imagem do QR Code "${this.selectedCouponCode}" iniciado.`);
  }

  printCurrentCouponQr() {
    if (!this.selectedCouponCode) return;
    const list = this.state.coupons || [];
    const coupon = list.find(c => c.code === this.selectedCouponCode) || { code: this.selectedCouponCode, discountPercent: 100 };
    const qrUrl = `/api/v1/coupons/${encodeURIComponent(this.selectedCouponCode)}/qrcode.png?size=400`;
    const totemsText = (coupon.allowedTotems && coupon.allowedTotems.length > 0)
      ? `Válido exclusivamente para as estações: ${coupon.allowedTotems.join(', ')}`
      : 'Válido em qualquer Totem da Rede CapaXero';

    const printWindow = window.open('', '_blank', 'width=600,height=700');
    if (!printWindow) {
      this.showToast('⚠️ Permita popups para imprimir o voucher.');
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Voucher CapaXero - ${coupon.code}</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: center; padding: 40px; color: #111; background: #fff; }
          .voucher-box { border: 2px dashed #000; border-radius: 16px; padding: 30px; max-width: 420px; margin: 0 auto; }
          .logo { font-size: 24px; font-weight: 900; letter-spacing: 2px; margin-bottom: 8px; }
          .discount { font-size: 32px; font-weight: 900; color: #059669; margin: 10px 0; }
          .code-box { font-size: 22px; font-weight: 800; background: #f1f5f9; padding: 10px 16px; border-radius: 8px; font-family: monospace; display: inline-block; margin: 12px 0; letter-spacing: 2px; }
          .qr-img { width: 220px; height: 220px; display: block; margin: 16px auto; border: 1px solid #ddd; border-radius: 8px; padding: 8px; }
          .totems-info { font-size: 12px; color: #2563eb; font-weight: 600; margin: 6px 0; }
          .instructions { font-size: 13px; color: #555; line-height: 1.5; margin-top: 14px; border-top: 1px solid #eee; padding-top: 14px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="voucher-box">
          <div class="logo">🏍️ CAPAXERO</div>
          <div style="font-size: 14px; color: #666;">VOUCHER DE HIGIENIZAÇÃO DE CAPACETES</div>
          <div class="discount">${coupon.discountPercent}% DE DESCONTO</div>
          <div class="code-box">🎟️ ${coupon.code}</div>
          <img class="qr-img" src="${qrUrl}" alt="QR Code ${coupon.code}">
          <div style="font-size: 13px; font-weight: bold; margin-bottom: 4px;">${coupon.description || 'Campanha Promocional'}</div>
          <div class="totems-info">📍 ${totemsText}</div>
          <div class="instructions">
            <strong>Como Utilizar:</strong><br>
            Aponte este QR Code para o leitor óptico / câmera do Totem CapaXero para liberar seu ciclo com desconto.
          </div>
        </div>
        <script>
          window.onload = function() {
            setTimeout(function() { window.print(); }, 400);
          };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }

  async submitNewCoupon(e) {
    e.preventDefault();
    const code = document.getElementById('nc-code').value.trim().toUpperCase();
    const description = document.getElementById('nc-desc').value.trim();
    const discountPercent = Number(document.getElementById('nc-discount').value);
    const maxUsages = Number(document.getElementById('nc-max-usages').value);
    const applicableMode = document.getElementById('nc-mode').value;

    const scopeVal = document.getElementById('nc-totems-scope')?.value || 'TODAS';
    let allowedTotems = null;
    if (scopeVal === 'ESPECIFICAS') {
      const selected = Array.from(document.querySelectorAll('.nc-totem-chk:checked')).map(cb => cb.value);
      if (selected.length === 0) {
        this.showToast('⚠️ Selecione pelo menos uma máquina para restringir o cupom.');
        return;
      }
      allowedTotems = selected;
    }

    if (!code) return;

    try {
      const res = await fetch('/api/v1/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, description, discountPercent, maxUsages, applicableMode, allowedTotems })
      }).then(r => r.json());

      if (res.success) {
        this.showToast(`✅ Cupom ${code} criado com sucesso!`);
        document.getElementById('new-coupon-modal').classList.remove('open');
        e.target.reset();
        await this.fetchBackendData();
        this.openCouponQrModal(code);
      } else {
        this.showToast(`❌ ${res.message}`);
      }
    } catch (err) {
      this.showToast('❌ Erro ao criar cupom.');
    }
  }

  async resetCoupon(code) {
    try {
      const res = await fetch(`/api/v1/coupons/${encodeURIComponent(code)}/reset`, { method: 'POST' }).then(r => r.json());
      if (res.success) {
        this.showToast(`🔄 Cupom ${code} resetado para disponível.`);
        await this.fetchBackendData();
      }
    } catch (_) {}
  }

  async resetAllCoupons() {
    try {
      const res = await fetch('/api/v1/coupons/reset-all', { method: 'POST' }).then(r => r.json());
      if (res.success) {
        this.showToast('🔄 Todos os cupons foram resetados.');
        await this.fetchBackendData();
      }
    } catch (_) {}
  }

  async deleteCoupon(code) {
    if (!confirm(`Deseja realmente excluir o cupom promocional "${code}"?`)) return;
    try {
      const res = await fetch(`/api/v1/coupons/${encodeURIComponent(code)}`, { method: 'DELETE' }).then(r => r.json());
      if (res.success) {
        this.showToast(`🗑️ Cupom ${code} excluído.`);
        await this.fetchBackendData();
      }
    } catch (_) {}
  }
}

// Inicializa a aplicação
document.addEventListener('DOMContentLoaded', () => {
  window.app = new CapaxeroDashboard();
});
