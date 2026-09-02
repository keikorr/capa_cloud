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

/** Somente os dígitos de um CPF (remove máscara). */
function onlyDigits(val) {
  return String(val || '').replace(/\D+/g, '');
}

/** Máscara progressiva de CPF: 000.000.000-00 */
function maskCPF(val) {
  return onlyDigits(val)
    .slice(0, 11)
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

/** Formata um CPF completo; devolve o valor original quando incompleto. */
function fmtCPF(val) {
  const d = onlyDigits(val);
  if (d.length !== 11) return String(val || '—');
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Validação oficial de CPF pelos dígitos verificadores. */
function isValidCPF(val) {
  const cpf = onlyDigits(val);
  if (cpf.length !== 11) return false;
  if (cpf.split('').every(d => d === cpf[0])) return false;

  for (let round = 9; round <= 10; round++) {
    let sum = 0;
    for (let i = 0; i < round; i++) sum += Number(cpf[i]) * (round + 1 - i);
    let digit = (sum * 10) % 11;
    if (digit === 10) digit = 0;
    if (digit !== Number(cpf[round])) return false;
  }
  return true;
}

function svgIcon(inner) {
  return `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.15em;">${inner}</svg>`;
}

// Conjunto de ícones em linha (substitui os emojis usados na interface do painel)
const ICONS = {
  ok: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>'),
  warn: svgIcon('<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>'),
  err: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>'),
  lock: svgIcon('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>'),
  unlock: svgIcon('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 017.5-2"/>'),
  gear: svgIcon('<circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.97 7.97 0 000-2l2.1-1.6-2-3.4-2.5 1a8 8 0 00-1.7-1L14.9 2h-3.8l-.4 2.9a8 8 0 00-1.7 1l-2.5-1-2 3.4L6.6 10a7.97 7.97 0 000 2l-2.1 1.7 2 3.4 2.5-1a8 8 0 001.7 1l.4 3h3.8l.4-3a8 8 0 001.7-1l2.5 1 2-3.4L19.4 13z"/>'),
  plug: svgIcon('<path d="M9 2v6M15 2v6M6 9h12l-1 4a5 5 0 01-10 0L6 9z"/><path d="M12 17v5"/>'),
  wrench: svgIcon('<path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.8 2.8-2-2 2.8-2.8z"/>'),
  film: svgIcon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 10h4M17 10h4M3 15h4M17 15h4"/>'),
  upload: svgIcon('<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/><path d="M12 11v6M9 14l3-3 3 3"/>'),
  trash: svgIcon('<path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13"/><path d="M10 11v6M14 11v6"/>'),
  ticket: svgIcon('<path d="M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-4V8z"/><path d="M10 6v12" stroke-dasharray="2 2"/>'),
  pin: svgIcon('<path d="M12 21s7-7.2 7-12a7 7 0 10-14 0c0 4.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
  globe: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>'),
  phone: svgIcon('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>'),
  download: svgIcon('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/>'),
  printer: svgIcon('<path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="8" rx="1"/><path d="M6 17v4h12v-4"/>'),
  pencil: svgIcon('<path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/><path d="M14 6l3 3"/>'),
  user: svgIcon('<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0116 0"/>'),
  sparkle: svgIcon('<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z"/>'),
  coin: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M12 6v12M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1-3 2.3c0 3 6 1.4 6 4.3 0 1.3-1.3 2.4-3 2.4s-3-1-3-2.4"/>'),
  wind: svgIcon('<path d="M3 8h11a3 3 0 100-6M3 12h15a3 3 0 110 6M3 16h9"/>'),
  droplet: svgIcon('<path d="M12 2s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z"/>'),
  zap: svgIcon('<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/>'),
  clipboard: svgIcon('<rect x="6" y="4" width="12" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 11h6M9 15h6"/>'),
  refresh: svgIcon('<path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>'),
  shield: svgIcon('<path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z"/><path d="M9 12l2 2 4-4"/>')
};

class CapaxeroDashboard {
  constructor() {
    this.token = localStorage.getItem('cpx_token') || null;
    this.currentUser = null;
    this.ws = null;

    this.activeTab = 'estacoes';
    this.ownershipFilter = 'all';
    this.periodoKey = '7d';
    const now = new Date();
    this.selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.selectedStationId = null;
    this.searchTerm = '';
    this.selectedCouponCode = null;
    this.currentCouponCpfRows = [];
    this.editingCoupon = null;

    // Mapa real do Brasil (página Locais)
    this.locaisMap = null;
    this.locaisMapMarkersLayer = null;
    this.locaisPickMarker = null;
    this.pendingDepotLatLng = null;

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
            this.showToast(`Olá, ${this.currentUser.responsible_name || this.currentUser.username}!`);
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
    if (pmRole) pmRole.innerHTML = isAdmin ? `${ICONS.lock} ADMIN — total` : `${ICONS.user} Dono da Máquina`;

    if (tabCadastros) {
      tabCadastros.style.display = isAdmin ? 'block' : 'none';
    }

    const tabManutencao = document.getElementById('tab-manutencao');
    if (tabManutencao) {
      tabManutencao.style.display = isAdmin ? 'flex' : 'none';
      // Se um dono estava na aba de manutenção quando perdeu acesso (troca de conta), volta pra Estações
      if (!isAdmin && this.activeTab === 'manutencao') this.switchPage('estacoes');
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
        this.refreshStationDetailsLive(devno);
      }
    } else if (msg.type === 'NEW_ALERT') {
      this.fetchBackendData();
      if (msg.data?.alert) {
        this.showToast(`Alerta em ${msg.data.alert.totemName || 'Totem'}: ${msg.data.alert.message}`, 'warn');
      }
    } else if (msg.type === 'NEW_TRANSACTION') {
      this.fetchBackendData();
      if (msg.data?.transaction) {
        this.showToast(`Venda aprovada: ${fmtBRL(msg.data.transaction.amount)} em ${msg.data.transaction.totemName}`, 'ok');
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

    // Filtro global de vínculo (Todos / Franqueados / Máquinas Próprias) — vale para todas as abas
    const ownershipButtons = document.querySelectorAll('#ownership-filter-toggle button');
    ownershipButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        ownershipButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.ownershipFilter = btn.dataset.ownership;
        this.renderAll();
      });
    });

    // Filtro de Período no Dashboard
    const periodButtons = document.querySelectorAll('#dash-period-toggle button');
    const monthPicker = document.getElementById('dash-month-picker');
    periodButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        periodButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.periodoKey = btn.dataset.period;
        if (monthPicker) {
          monthPicker.style.display = this.periodoKey === 'month' ? 'inline-block' : 'none';
          if (this.periodoKey === 'month' && !monthPicker.value) monthPicker.value = this.selectedMonth;
        }
        this.updateDashboardPeriodLabel();
        this.renderDashboard();
      });
    });

    if (monthPicker) {
      monthPicker.addEventListener('change', () => {
        if (!monthPicker.value) return;
        this.selectedMonth = monthPicker.value;
        this.updateDashboardPeriodLabel();
        this.renderDashboard();
      });
    }
  }

  updateDashboardPeriodLabel() {
    const lbl = document.getElementById('dash-periodo-label');
    if (!lbl) return;
    if (this.periodoKey === 'hoje') lbl.textContent = 'hoje';
    else if (this.periodoKey === '7d') lbl.textContent = 'últimos 7 dias';
    else if (this.periodoKey === '30d') lbl.textContent = 'últimos 30 dias';
    else if (this.periodoKey === 'month') {
      const [y, m] = this.selectedMonth.split('-').map(Number);
      const nomesMes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
      lbl.textContent = `${nomesMes[m - 1]} de ${y}`;
    }
  }

  getDashboardDateRange() {
    const now = new Date();
    if (this.periodoKey === 'hoje') {
      return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end: now };
    }
    if (this.periodoKey === '30d') {
      return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: now };
    }
    if (this.periodoKey === 'month') {
      const [y, m] = (this.selectedMonth || '').split('-').map(Number);
      if (y && m) return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
    }
    // padrão: 7 dias
    return { start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), end: now };
  }

  // --- Filtro global de vínculo: Todos / Franqueados / Máquinas Próprias ---
  getFranchiseTypeForOwner(ownerIdOrName) {
    if (!ownerIdOrName) return null;
    const user = (this.state.users || []).find(u =>
      u.id === ownerIdOrName || u.responsible_name === ownerIdOrName || u.username === ownerIdOrName
    );
    // Donos cadastrados antes deste campo existir não têm franchiseType salvo — trata como
    // Franqueado por padrão (mesmo default usado ao criar um dono novo sem escolha explícita).
    if (!user) return null;
    return user.franchiseType === 'PROPRIA' ? 'PROPRIA' : 'FRANQUEADO';
  }

  matchesOwnershipFilter(ownerIdOrName) {
    if (this.ownershipFilter === 'all') return true;
    return this.getFranchiseTypeForOwner(ownerIdOrName) === this.ownershipFilter;
  }

  getFilteredStations() {
    if (this.ownershipFilter === 'all') return this.stations;
    return this.stations.filter(s => this.matchesOwnershipFilter(s.raw?.owner_id || s.dono));
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

    if (btnOpenNewDepot) btnOpenNewDepot.addEventListener('click', () => {
      this.pendingDepotLatLng = null;
      if (this.locaisPickMarker && this.locaisMap) {
        this.locaisMap.removeLayer(this.locaisPickMarker);
        this.locaisPickMarker = null;
      }
      const text = document.getElementById('nd-latlng-text');
      if (text) text.textContent = 'Nenhum ponto selecionado no mapa — feche e clique no mapa de Locais para marcar a localização exata (opcional).';
      this.openModal('new-depot-modal');
    });
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
        const lat = this.pendingDepotLatLng?.lat ?? null;
        const lng = this.pendingDepotLatLng?.lng ?? null;

        try {
          const res = await fetch('/api/v1/admin/depots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
            body: JSON.stringify({ name, address, lat, lng })
          }).then(r => r.json());

          if (res.success) {
            this.showToast('Local cadastrado com sucesso!');
            document.getElementById('new-depot-modal').classList.remove('open');
            formNewDepot.reset();
            this.pendingDepotLatLng = null;
            if (this.locaisPickMarker && this.locaisMap) {
              this.locaisMap.removeLayer(this.locaisPickMarker);
              this.locaisPickMarker = null;
            }
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
            this.showToast('Perfil atualizado com sucesso!', 'ok');
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
        const franchiseTypeEl = document.querySelector('input[name="no-franchise-type"]:checked');
        const payload = {
          cnpj: document.getElementById('no-cnpj').value.trim(),
          responsible_name: document.getElementById('no-responsible').value.trim(),
          company_name: document.getElementById('no-company').value.trim(),
          franchiseType: franchiseTypeEl ? franchiseTypeEl.value : 'FRANQUEADO',
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
            this.showToast(`Novo dono ${payload.responsible_name} cadastrado com sucesso!`, 'ok');
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

    // Form Editar Dono
    const formEditOwner = document.getElementById('form-edit-owner');
    if (formEditOwner) {
      formEditOwner.addEventListener('submit', async (e) => {
        e.preventDefault();
        const userId = document.getElementById('eo-user-id').value;
        const franchiseTypeEl = document.querySelector('input[name="eo-franchise-type"]:checked');
        const payload = {
          cnpj: document.getElementById('eo-cnpj').value.trim(),
          responsible_name: document.getElementById('eo-responsible').value.trim(),
          company_name: document.getElementById('eo-company').value.trim(),
          franchiseType: franchiseTypeEl ? franchiseTypeEl.value : 'FRANQUEADO',
          email: document.getElementById('eo-email').value.trim(),
          phone: document.getElementById('eo-phone').value.trim(),
          password: document.getElementById('eo-password').value
        };

        try {
          const res = await fetch(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.token}`
            },
            body: JSON.stringify(payload)
          }).then(r => r.json());

          if (res.success) {
            this.showToast(`Dados de ${payload.responsible_name} atualizados com sucesso!`, 'ok');
            document.getElementById('edit-owner-modal').classList.remove('open');
            formEditOwner.reset();
            await this.fetchBackendData();
          } else {
            this.showToast(res.message || 'Erro ao atualizar dono.', 'err');
          }
        } catch (_) {
          this.showToast('Erro ao atualizar dono.', 'err');
        }
      });
    }

    const editOwnerCancelBtn = document.getElementById('edit-owner-cancel');
    if (editOwnerCancelBtn) {
      editOwnerCancelBtn.addEventListener('click', () => document.getElementById('edit-owner-modal').classList.remove('open'));
    }

    // Form Quick Transfer Owner
    const formQuickTransfer = document.getElementById('form-quick-transfer-owner');
    if (formQuickTransfer) {
      formQuickTransfer.addEventListener('submit', async (e) => {
        e.preventDefault();
        const devno = document.getElementById('quick-transfer-totem').value;
        const newOwner = document.getElementById('quick-transfer-owner').value;

        if (!devno || !newOwner) {
          this.showToast('Selecione a máquina e o novo dono.', 'warn');
          return;
        }

        try {
          const res = await fetch(`/api/v1/admin/totems/${encodeURIComponent(devno)}/owner`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
            body: JSON.stringify({ owner: newOwner })
          }).then(r => r.json());

          if (res.success) {
            this.showToast(`${res.message || `Titularidade de ${devno} reatribuída com sucesso!`}`, 'ok');
            await this.fetchBackendData();
          } else {
            this.showToast(`${res.message || 'Erro ao reatribuir máquina.'}`, 'err');
          }
        } catch (err) {
          this.showToast('Falha na comunicação com o servidor.', 'err');
        }
      });
    }

    // Form Move Station
    const formMove = document.getElementById('form-move-station');
    if (formMove) {
      formMove.addEventListener('submit', async (e) => {
        e.preventDefault();
        const devno = document.getElementById('move-select-totem').value;
        const depotno = document.getElementById('move-new-location').value;

        if (!devno || !depotno) {
          this.showToast('Selecione a máquina e o local de destino.', 'err');
          return;
        }

        try {
          const res = await fetch(`/api/v1/admin/totems/${encodeURIComponent(devno)}/relocate`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
            body: JSON.stringify({ depotno })
          }).then(r => r.json());

          if (res.success) {
            document.getElementById('move-modal').classList.remove('open');
            this.showToast(`Estação ${devno} alocada com sucesso.`);
            await this.fetchBackendData();
          } else {
            this.showToast(res.message || 'Erro ao alocar a máquina no local.', 'err');
          }
        } catch (_) {
          this.showToast('Falha na comunicação com o servidor.', 'err');
        }
      });
    }

    // Ações de Comando Remoto do Totem
    const btnActUnlock = document.getElementById('btn-act-unlock');
    const btnActMist = document.getElementById('btn-act-mist');
    const btnActPurge = document.getElementById('btn-act-purge');
    const btnActTest = document.getElementById('btn-act-test');
    const btnActOpenOM = document.getElementById('btn-act-open-om');
    const btnOpenConfig = document.getElementById('btn-open-config');
    const btnOpenCieloConfig = document.getElementById('btn-open-cielo-config');
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

    if (btnActUnlock) btnActUnlock.addEventListener('click', () => { sendCmd('UNLOCK_DOOR'); this.showToast('Comando de destravamento enviado. Porta liberada por 30s.'); });
    if (btnActMist) btnActMist.addEventListener('click', () => { sendCmd('START_MIST'); this.showToast('Ciclo de névoa sanitizante disparado remotamente.'); });
    if (btnActPurge) btnActPurge.addEventListener('click', () => { sendCmd('PURGE_LINES'); this.showToast('Purga de linhas iniciada — 45s.'); });
    if (btnActTest) btnActTest.addEventListener('click', () => { sendCmd('SELF_TEST'); this.showToast('Autoteste em execução no totem.'); });
    if (btnActOpenOM) btnActOpenOM.addEventListener('click', () => this.openOMModal(this.selectedStationId));

    const btnOpenNewOM = document.getElementById('btn-open-new-om');
    if (btnOpenNewOM) btnOpenNewOM.addEventListener('click', () => this.openOMModal());

    const formCreateOM = document.getElementById('form-create-om');
    if (formCreateOM) {
      formCreateOM.addEventListener('submit', async (e) => {
        e.preventDefault();
        const devno = document.getElementById('om-totem-select').value;
        if (!devno) {
          this.showToast('Selecione a máquina.', 'err');
          return;
        }
        const issueType = document.getElementById('om-issue-type').value;
        const priority = document.getElementById('om-priority').value;
        const description = document.getElementById('om-desc').value.trim();
        const assigneeRaw = document.getElementById('om-assignee').value;
        const assignee = assigneeRaw === 'Não designar agora' ? '' : assigneeRaw;

        try {
          const res = await fetch('/api/v1/admin/maintenance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
            body: JSON.stringify({ devno, issueType, priority, description, assignee })
          }).then(r => r.json());

          if (res.success) {
            document.getElementById('om-modal').classList.remove('open');
            formCreateOM.reset();
            this.showToast('Ordem de manutenção aberta com sucesso.', 'warn');
            await this.fetchBackendData();
          } else {
            this.showToast(res.message || 'Erro ao abrir a ordem de manutenção.', 'err');
          }
        } catch (_) {
          this.showToast('Falha na comunicação com o servidor.', 'err');
        }
      });
    }

    const manutFilterToggle = document.getElementById('manut-filter-toggle');
    if (manutFilterToggle) {
      manutFilterToggle.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          manutFilterToggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.manutFilter = btn.dataset.filter;
          this.renderManutencao();
        });
      });
    }

    const manutTbody = document.getElementById('manut-tbody');
    if (manutTbody) {
      manutTbody.addEventListener('click', async (e) => {
        const commentsBtn = e.target.closest('[data-comments-id]');
        if (commentsBtn) {
          this.openOMCommentsModal(commentsBtn.dataset.commentsId);
          return;
        }

        const btn = e.target.closest('[data-resolve-id]');
        if (!btn) return;
        const id = btn.dataset.resolveId;
        btn.disabled = true;
        try {
          const res = await fetch(`/api/v1/admin/alerts/${encodeURIComponent(id)}/resolve`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.token}` }
          }).then(r => r.json());

          if (res.success) {
            this.showToast('Ordem de manutenção resolvida.');
            await this.fetchBackendData();
          } else {
            this.showToast(res.message || 'Erro ao resolver a ordem.', 'err');
            btn.disabled = false;
          }
        } catch (_) {
          this.showToast('Falha na comunicação com o servidor.', 'err');
          btn.disabled = false;
        }
      });
    }

    const formOMComment = document.getElementById('form-om-comment');
    if (formOMComment) {
      formOMComment.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!this.activeOMCommentId) return;
        const textarea = document.getElementById('om-comment-text');
        const text = textarea.value.trim();
        if (!text) return;

        try {
          const res = await fetch(`/api/v1/admin/maintenance/${encodeURIComponent(this.activeOMCommentId)}/comment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
            body: JSON.stringify({ text })
          }).then(r => r.json());

          if (res.success) {
            await this.fetchBackendData();
            this.openOMCommentsModal(this.activeOMCommentId);
          } else {
            this.showToast(res.message || 'Erro ao adicionar comentário.', 'err');
          }
        } catch (_) {
          this.showToast('Falha na comunicação com o servidor.', 'err');
        }
      });
    }
    if (btnOpenConfig) btnOpenConfig.addEventListener('click', () => this.openModal('config-modal'));
    if (btnOpenCieloConfig) btnOpenCieloConfig.addEventListener('click', () => this.openCieloConfigModal());

    const cieloCancelBtn = document.getElementById('cielo-cancel');
    if (cieloCancelBtn) cieloCancelBtn.addEventListener('click', () => document.getElementById('cielo-config-modal').classList.remove('open'));

    if (btnConfirmOwner) {
      btnConfirmOwner.addEventListener('click', async () => {
        const newOwner = document.getElementById('modal-select-new-owner').value;
        if (!this.selectedStationId || !newOwner) {
          this.showToast('Selecione o novo dono.', 'warn');
          return;
        }

        try {
          const res = await fetch(`/api/v1/admin/totems/${encodeURIComponent(this.selectedStationId)}/owner`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
            body: JSON.stringify({ owner: newOwner })
          }).then(r => r.json());

          if (res.success) {
            this.showToast(`${res.message || 'Titularidade reatribuída com sucesso!'}`, 'ok');
            await this.fetchBackendData();
            this.openStationDetails(this.selectedStationId);
          } else {
            this.showToast(`${res.message || 'Erro ao reatribuir titularidade.'}`, 'err');
          }
        } catch (err) {
          this.showToast('Falha na comunicação ao reatribuir titularidade.', 'err');
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
            this.showToast('Configurações salvas e persistidas no banco!', 'ok');
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

    // Parametrização Cielo por máquina (Pinpad / Conecta / Ecommerce)
    const formCieloConfig = document.getElementById('form-cielo-config');
    if (formCieloConfig) {
      formCieloConfig.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!this.selectedStationId) return;

        const val = (id) => document.getElementById(id)?.value.trim() || '';

        const cielo = {
          pinpadLicense: val('cielo-pinpad-license'),
          pinpadCompany: val('cielo-pinpad-company'),
          pinpadComm: val('cielo-pinpad-comm') || 'USB',
          conectaEnvironment: val('cielo-conecta-env') || 'Sandbox',
          conectaClientId: val('cielo-conecta-client-id'),
          conectaClientSecret: val('cielo-conecta-client-secret'),
          conectaSubordinatedMerchantId: val('cielo-conecta-sub-merchant'),
          conectaTerminalId: val('cielo-conecta-terminal'),
          ecommerceEnvironment: val('cielo-ecom-env') || 'Sandbox',
          ecommerceMerchantId: val('cielo-ecom-merchant-id'),
          ecommerceMerchantKey: val('cielo-ecom-merchant-key'),
          pixExpirationSeconds: Number(val('cielo-pix-expiration')) || 180
        };

        try {
          const res = await fetch(`/api/v1/admin/totems/${encodeURIComponent(this.selectedStationId)}/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
            body: JSON.stringify({ cielo })
          }).then(r => r.json());

          if (res.success) {
            document.getElementById('cielo-config-modal').classList.remove('open');
            this.showToast('Credenciais Cielo atualizadas para esta máquina!', 'ok');
            await this.fetchBackendData();
          } else {
            this.showToast(res.message || 'Erro ao salvar credenciais Cielo.', 'warn');
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

    // Modal de edição do cupom (configurações + CPFs registrados)
    const closeEditModal = () => {
      document.getElementById('coupon-edit-modal').classList.remove('open');
    };
    const btnEditClose = document.getElementById('coupon-edit-close');
    const btnEditCancel = document.getElementById('coupon-edit-cancel');
    const btnCpfsExport = document.getElementById('btn-cpfs-export');
    const formEditCoupon = document.getElementById('form-edit-coupon');
    const editScopeSelect = document.getElementById('ec-totems-scope');
    const editCheckboxesDiv = document.getElementById('ec-totems-checkboxes');

    if (btnEditClose) btnEditClose.addEventListener('click', closeEditModal);
    if (btnEditCancel) btnEditCancel.addEventListener('click', closeEditModal);
    if (btnCpfsExport) btnCpfsExport.addEventListener('click', () => this.exportCouponCpfsCsv());
    if (formEditCoupon) formEditCoupon.addEventListener('submit', (e) => this.submitEditCoupon(e));

    if (editScopeSelect && editCheckboxesDiv) {
      editScopeSelect.addEventListener('change', (e) => {
        editCheckboxesDiv.style.display = e.target.value === 'ESPECIFICAS' ? 'block' : 'none';
      });
    }

    document.querySelectorAll('.coupon-edit-tab').forEach(btn => {
      btn.addEventListener('click', () => this.switchCouponEditTab(btn.dataset.editTab));
    });

    // Configuração dos controles de Upload de Vídeo de Higienização
    this.setupVideoUploadControls();
  }

  updateVideoUI(videoUrl) {
    const videoPreview = document.getElementById('conf-video-preview');
    const videoPlaceholder = document.getElementById('conf-video-placeholder');
    const statusBadge = document.getElementById('conf-video-status-badge');
    const btnRemove = document.getElementById('btn-remove-custom-video');
    const btnUpload = document.getElementById('btn-upload-video-now');
    const progressWrap = document.getElementById('conf-video-progress-wrap');

    if (progressWrap) progressWrap.style.display = 'none';
    if (btnUpload) btnUpload.style.display = 'none';

    if (videoUrl) {
      if (videoPreview) {
        videoPreview.src = videoUrl;
        videoPreview.style.display = 'block';
      }
      if (videoPlaceholder) videoPlaceholder.style.display = 'none';
      if (statusBadge) {
        statusBadge.textContent = 'Vídeo Customizado Ativo';
        statusBadge.style.background = 'rgba(0, 240, 255, 0.15)';
        statusBadge.style.borderColor = '#00F0FF';
        statusBadge.style.color = '#00F0FF';
      }
      if (btnRemove) btnRemove.style.display = 'inline-block';
    } else {
      if (videoPreview) {
        videoPreview.src = '';
        videoPreview.style.display = 'none';
      }
      if (videoPlaceholder) videoPlaceholder.style.display = 'block';
      if (statusBadge) {
        statusBadge.textContent = 'Animação Padrão';
        statusBadge.style.background = 'rgba(85,135,179,0.15)';
        statusBadge.style.borderColor = '#5587B3';
        statusBadge.style.color = '#7fb2dd';
      }
      if (btnRemove) btnRemove.style.display = 'none';
    }
  }

  setupVideoUploadControls() {
    const dropzone = document.getElementById('conf-video-dropzone');
    const fileInput = document.getElementById('conf-video-file-input');
    const btnUpload = document.getElementById('btn-upload-video-now');
    const btnRemove = document.getElementById('btn-remove-custom-video');
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
        this.showToast('Por favor selecione um arquivo de vídeo válido (.mp4, .webm).', 'warn');
        return;
      }
      if (file.size > 150 * 1024 * 1024) {
        this.showToast('O vídeo excede o limite de 150 MB.', 'warn');
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
          this.showToast('Selecione um arquivo de vídeo para enviar.', 'warn');
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
                this.showToast('Vídeo de higienização enviado e sincronizado com o Totem!', 'ok');
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
            this.showToast('Vídeo removido. Máquina restaurada para a animação padrão.', 'ok');
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

    const kindIcons = { ok: ICONS.ok, warn: ICONS.wrench, admin: ICONS.lock, err: ICONS.warn };
    const borders = {
      ok: 'rgba(0,197,102,.45)',
      warn: 'rgba(255,145,0,.5)',
      admin: 'rgba(253,203,36,.5)',
      err: 'rgba(255,61,87,.5)'
    };
    const iconColors = { ok: '#00C566', warn: '#FF9100', admin: '#FDCB24', err: '#FF3D57' };

    toast.style.borderColor = borders[kind] || borders.ok;
    toast.innerHTML = `<span style="font-size:16px; margin-right:8px; color:${iconColors[kind] || iconColors.ok};">${kindIcons[kind] || ICONS.ok}</span><span>${msg}</span>`;

    container.appendChild(toast);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add('toast-visible'));
    });

    setTimeout(() => {
      toast.classList.remove('toast-visible');
      toast.classList.add('toast-leaving');
      setTimeout(() => toast.remove(), 200);
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
        fetch('/api/v1/admin/transactions?limit=5000', { headers }).then(r => r.json()).catch(() => ({ success: false })),
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
    const statusKey = (t.status || 'IDLE').toUpperCase();
    const isOnline = t.status !== 'OFFLINE';

    return {
      id: t.devno,
      nome: t.name || `Totem #${t.devno}`,
      code: t.devno,
      devno: t.devno,
      local: t.location || 'Ponto a Cadastrar',
      endereco: t.location || 'Ponto de Instalação',
      ponto: t.location || 'Ponto de Instalação',
      dono: t.owner || 'Jonathan Silveira',
      status: statusKey,
      plano: 'Intermediária',
      etapa: t.currentCycle?.step || (statusKey === 'CLEANING' ? 'Higienização em andamento' : (statusKey === 'IDLE' ? 'Ocioso — pronto para uso' : statusKey)),
      pct: statusKey === 'CLEANING' ? 45 : (statusKey === 'IDLE' ? 100 : 0),
      restante: '—',
      trava: t.doorLocked ? 'Travada' : 'Destravada',
      uv: t.liquidLevelPercent !== undefined ? t.liquidLevelPercent : 100,
      fat: fmtBRL(t.revenueToday || 0),
      fatVal: t.revenueToday || 0,
      ciclos: t.totalCyclesToday || 0,
      raw: t
    };
  }

  /* ============================================================
     Renderizadores de Páginas
     ============================================================ */
  renderAll() {
    this.renderEstacoes();
    this.renderLocais();
    this.renderManutencao();
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
      .map(l => `<option value="${l.depotno}">${l.name} (${l.depotno})</option>`).join('');

    const selQuickTotem = document.getElementById('quick-transfer-totem');
    const selQuickOwner = document.getElementById('quick-transfer-owner');
    const selModalOwner = document.getElementById('modal-select-new-owner');
    const selMoveTotem = document.getElementById('move-select-totem');
    const selMoveLoc = document.getElementById('move-new-location');

    // Reescrever innerHTML de um <select> descarta a opção que o operador acabou de escolher.
    // Como populateSelectors() roda a cada DASHBOARD_UPDATE (o totem conectando já dispara um),
    // quem estava trocando o dono via a escolha voltar sozinha em segundos. Aqui o select só é
    // reconstruído quando a lista realmente mudou, e a seleção em andamento é preservada.
    const setOptions = (el, html) => {
      if (!el) return;
      if (el.innerHTML === html) return;

      const selecionado = el.value;
      el.innerHTML = html;
      if (selecionado && Array.from(el.options).some(o => o.value === selecionado)) {
        el.value = selecionado;
      }
    };

    const semTotens = '<option value="">Nenhuma máquina cadastrada</option>';

    setOptions(selQuickTotem, totemOptions || semTotens);
    setOptions(selQuickOwner, ownerOptions);
    setOptions(selModalOwner, ownerOptions);
    setOptions(selMoveTotem, totemOptions || semTotens);
    if (depotOptions) setOptions(selMoveLoc, depotOptions);

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
    const list = this.getFilteredStations().filter(s => {
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

    // Render Grouped Stations by Location
    const container = document.getElementById('estacoes-grouped-container');
    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = `
        <div style="background:rgba(255,255,255,0.03); border:1px dashed rgba(255,255,255,0.15); border-radius:16px; padding:40px; text-align:center; color:#8a97a7;">
          <div style="font-size:32px; margin-bottom:10px;">${ICONS.shield}</div>
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
        grupos[locKey] = { nome: locKey, stations: [], soma: 0 };
      }
      grupos[locKey].stations.push(s);
      grupos[locKey].soma += s.fatVal || 0;
    });

    container.innerHTML = Object.values(grupos).map(g => `
      <div class="station-group">
        <div class="station-group-head">
          <h2>${g.nome}</h2>
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
                    <span class="gear">${ICONS.gear}</span>
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

    this.renderStationTelemetry(s);
    this.fillStationForms(s);
    this.openModal('detail-modal');
  }

  /**
   * Atualização vinda de push em tempo real (heartbeat do totem, progresso de ciclo).
   *
   * Aqui o painel chamava openStationDetails(), que reescrevia TODOS os campos do
   * formulário e ainda reabria o modal de detalhes. Quem estava trocando o dono via o
   * valor voltar sozinho em segundos, e quem tinha entrado em outro modal era jogado
   * de volta para a tela de detalhes. Uma atualização de fundo só pode repintar
   * telemetria, e só quando o modal já estiver aberto naquela mesma máquina.
   */
  refreshStationDetailsLive(devno) {
    const modal = document.getElementById('detail-modal');
    if (!modal || !modal.classList.contains('open')) return;
    if (this.selectedStationId !== devno) return;

    const s = this.stations.find(st => st.id === devno || st.devno === devno);
    if (!s) return;

    this.renderStationTelemetry(s);
  }

  /** Somente leitura: status, ciclo, sensores e faturamento. Seguro repintar a qualquer momento. */
  renderStationTelemetry(s) {

    const m = this.meta[s.status] || this.meta.IDLE;
    const isRun = s.status === 'CLEANING';

    document.getElementById('modal-totem-name').textContent = s.nome;
    document.getElementById('modal-totem-location').textContent = s.endereco;
    document.getElementById('modal-owner-val').textContent = s.dono;
    document.getElementById('modal-ponto-val').textContent = s.ponto;
    document.getElementById('modal-cycle-stage').textContent = s.etapa;
    document.getElementById('modal-cycle-sub').textContent = isRun ? `Plano ${s.plano} · em andamento` : 'Ocioso — pronto para higienizar';
    document.getElementById('modal-cycle-pct').textContent = isRun ? `${s.pct}%` : (s.status === 'IDLE' ? 'Pronto' : '—');
    document.getElementById('modal-cycle-bar').style.width = isRun ? `${s.pct}%` : (s.status === 'IDLE' ? '100%' : '0%');
    document.getElementById('modal-stat-door').textContent = s.trava;
    document.getElementById('modal-stat-door').style.color = s.trava === 'Travada' ? '#00C566' : '#FF9100';
    document.getElementById('modal-stat-rev').textContent = s.fat;
    document.getElementById('modal-stat-cycles').textContent = s.ciclos;
    document.getElementById('modal-current-owner-lbl').textContent = `Dono atual: ${s.dono}`;

    // Status Pill
    const pill = document.getElementById('modal-status-pill');
    pill.style.background = m.chip;
    pill.style.color = m.color;
    document.getElementById('modal-status-text').textContent = m.label;
    document.getElementById('modal-status-dot').style.background = m.color;

    // Ring - Nível de Sanitizante UV do sensor real da máquina
    const uvRing = document.getElementById('modal-uv-ring');
    const uvText = document.getElementById('modal-uv-text');
    const uvSub = document.getElementById('modal-uv-sensor-sub');

    const isLiquidOk = s.raw?.isLiquidLevelOk !== undefined ? Boolean(s.raw.isLiquidLevelOk) : (s.uv > 10);
    const liquidPct = s.raw?.liquidLevelPercent !== undefined ? s.raw.liquidLevelPercent : (isLiquidOk ? 100 : 0);
    const liquidColor = isLiquidOk ? '#00C566' : '#FF3D57';

    if (uvText) {
      uvText.textContent = isLiquidOk ? `${liquidPct}%` : 'BAIXO';
      uvText.style.color = liquidColor;
    }
    if (uvSub) {
      uvSub.textContent = isLiquidOk ? '✓ Sensor: Nível Normal / OK' : 'Sensor: Nível Baixo (Reabastecer)';
      uvSub.style.color = isLiquidOk ? '#7fb2dd' : '#FF6B7F';
    }
    if (uvRing) {
      uvRing.style.background = `conic-gradient(${liquidColor} ${liquidPct * 3.6}deg, rgba(255,255,255,.09) 0deg)`;
    }

  }

  /** Campos editáveis do modal. Só no abrir explícito — nunca por atualização de fundo. */
  fillStationForms(s) {
    const selModalOwner = document.getElementById('modal-select-new-owner');
    if (selModalOwner && s.raw?.owner_id) {
      selModalOwner.value = s.raw.owner_id;
    }

    // Admin Ownership Card: visível apenas para CRPADMIN
    const modalAdminOwnerCard = document.getElementById('modal-admin-owner-card');
    if (modalAdminOwnerCard) {
      modalAdminOwnerCard.style.display = (this.currentUser?.role === 'CRPADMIN') ? 'block' : 'none';
    }

    // Botão "Parametrizar Cielo": visível apenas para CRPADMIN
    const btnOpenCieloConfig = document.getElementById('btn-open-cielo-config');
    if (btnOpenCieloConfig) {
      btnOpenCieloConfig.style.display = (this.currentUser?.role === 'CRPADMIN') ? 'inline-flex' : 'none';
    }

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

  }

  openCieloConfigModal() {
    if (this.currentUser?.role !== 'CRPADMIN') return;
    const s = this.stations.find(st => st.id === this.selectedStationId || st.devno === this.selectedStationId);
    if (!s) return;

    const cielo = s.raw?.config?.cielo || {};
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };

    document.getElementById('cielo-sub-info').textContent = `${s.nome} — credenciais Pinpad, Conecta e Ecommerce`;

    setVal('cielo-pinpad-license', cielo.pinpadLicense || '');
    setVal('cielo-pinpad-company', cielo.pinpadCompany || '');
    setVal('cielo-pinpad-comm', cielo.pinpadComm || 'USB');

    setVal('cielo-conecta-env', cielo.conectaEnvironment || 'Sandbox');
    setVal('cielo-conecta-client-id', cielo.conectaClientId || '');
    setVal('cielo-conecta-client-secret', cielo.conectaClientSecret || '');
    setVal('cielo-conecta-sub-merchant', cielo.conectaSubordinatedMerchantId || '');
    setVal('cielo-conecta-terminal', cielo.conectaTerminalId || '');

    setVal('cielo-ecom-env', cielo.ecommerceEnvironment || 'Sandbox');
    setVal('cielo-ecom-merchant-id', cielo.ecommerceMerchantId || '');
    setVal('cielo-ecom-merchant-key', cielo.ecommerceMerchantKey || '');
    setVal('cielo-pix-expiration', cielo.pixExpirationSeconds || 180);

    const lastUpdatedEl = document.getElementById('cielo-last-updated');
    if (lastUpdatedEl) {
      lastUpdatedEl.textContent = cielo.updatedAt
        ? `Última atualização: ${new Date(cielo.updatedAt).toLocaleString('pt-BR')}`
        : 'Nenhuma credencial parametrizada ainda para esta máquina.';
    }

    this.openModal('cielo-config-modal');
  }

  // --- 2. LOCAIS ---
  renderLocais() {
    const isAdmin = this.currentUser?.role === 'CRPADMIN';
    const q = this.searchTerm;
    const list = this.locais.filter(l => {
      if (l.devno && this.ownershipFilter !== 'all') {
        const station = this.stations.find(s => s.devno === l.devno);
        if (station && !this.matchesOwnershipFilter(station.raw?.owner_id || station.dono)) return false;
      }
      if (!q) return true;
      return (l.name || '').toLowerCase().includes(q) ||
             (l.depotno || '').toLowerCase().includes(q) ||
             (l.address || '').toLowerCase().includes(q);
    });

    const countEl = document.getElementById('locais-table-count');
    if (countEl) countEl.textContent = `${list.length} registros`;

    const tbody = document.getElementById('locais-tbody');
    if (tbody) {
      if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${isAdmin ? 7 : 6}" style="text-align:center; padding:24px; color:#8a97a7;">Nenhum local cadastrado.</td></tr>`;
      } else {
        tbody.innerHTML = list.map(l => `
          <tr>
            <td class="mono accent">${l.depotno || 'LC'}</td>
            <td style="font-weight:600; color:#fff;">${l.name}</td>
            <td class="muted">${l.address || '—'}</td>
            <td class="mono">${l.totemCount ? `${l.totemCount} totem(s)` : '—'}</td>
            <td class="mono green">${fmtBRL(l.revenueToday || 0)}</td>
            <td><span class="status-chip active">Ativo</span></td>
            ${isAdmin ? `
            <td style="text-align:right; white-space:nowrap;">
              <button class="btn btn-blue" style="padding:6px 12px; font-size:11.5px;" onclick="window.app.openMoveModal('${l.devno || ''}', '${l.name}', '${l.depotno}')">Alocar Máquina</button>
              <button class="btn btn-danger" style="padding:6px 12px; font-size:11.5px; margin-left:6px;" onclick="window.app.deleteDepotLocation('${l.depotno}', '${(l.name || '').replace(/'/g, "\\'")}')">Excluir</button>
            </td>` : ''}
          </tr>
        `).join('');
      }
    }

    // Mapa real do Brasil (Leaflet)
    this.initLocaisMap();
    this.updateLocaisMapMarkers();

    // Lista de Realocações Rápidas
    const relocList = document.getElementById('realocacoes-list');
    if (relocList) {
      const relocStations = this.getFilteredStations();
      if (relocStations.length === 0) {
        relocList.innerHTML = `<div style="color:#8a97a7; font-size:12.5px;">Nenhuma máquina disponível para realocação.</div>`;
      } else {
        relocList.innerHTML = relocStations.map(s => {
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

  initLocaisMap() {
    const container = document.getElementById('locais-real-map');
    if (!container || typeof L === 'undefined') return;

    if (!this.locaisMap) {
      this.locaisMap = L.map(container, {
        center: [-14.235, -51.9253], // centro geográfico do Brasil
        zoom: 4,
        minZoom: 3,
        maxZoom: 19 // permite zoom até nível de rua
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        subdomains: 'abc',
        maxZoom: 19,
        className: 'cpx-dark-tiles'
      }).addTo(this.locaisMap);

      this.locaisMapMarkersLayer = L.layerGroup().addTo(this.locaisMap);

      this.locaisMap.on('click', (e) => {
        if (this.currentUser?.role !== 'CRPADMIN') return;
        this.pickDepotLocation(e.latlng.lat, e.latlng.lng);
      });

      this.initLocaisMapSearch();
    }

    // Garante renderização correta ao trocar de aba (container estava oculto no boot)
    setTimeout(() => { if (this.locaisMap) this.locaisMap.invalidateSize(); }, 80);
  }

  initLocaisMapSearch() {
    const input = document.getElementById('locais-map-search-input');
    const btn = document.getElementById('locais-map-search-btn');
    const resultsBox = document.getElementById('locais-map-search-results');
    if (!input || !btn || !resultsBox || input.dataset.wired) return;
    input.dataset.wired = '1';

    let debounceTimer = null;
    let lastQuery = '';

    const runSearch = async () => {
      const q = input.value.trim();
      if (!q || q === lastQuery) return;
      lastQuery = q;
      resultsBox.style.display = 'block';
      resultsBox.innerHTML = `<div class="map-search-result" style="cursor:default;">Buscando...</div>`;

      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=10&countrycodes=br&q=${encodeURIComponent(q)}`;
        const raw = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } }).then(r => r.json());

        // O OpenStreetMap às vezes não tem o número da casa mapeado nesse trecho da via —
        // quando isso acontece ele "recua" e devolve a rua inteira, repetida uma vez por CEP/
        // segmento (visualmente quase idêntica). Deduplica por rua+bairro pra não poluir a lista.
        const seen = new Set();
        const results = (Array.isArray(raw) ? raw : []).filter(r => {
          const key = `${r.address?.house_number || ''}|${r.address?.road || r.name || ''}|${r.address?.suburb || r.address?.city || ''}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(0, 6);

        if (results.length === 0) {
          resultsBox.innerHTML = `<div class="map-search-result" style="cursor:default; color:var(--text-dim);">Nenhum resultado encontrado.</div>`;
          return;
        }

        const queryHasNumber = /\d/.test(q);
        resultsBox.innerHTML = results.map((r, i) => {
          const hasHouseNumber = Boolean(r.address?.house_number);
          const caveat = (queryHasNumber && !hasHouseNumber)
            ? `<div style="font-size:10.5px; color:var(--brand-yellow); margin-top:3px;">Número não localizado no mapa — ponto aproximado da via, ajuste clicando no mapa</div>`
            : '';
          return `<div class="map-search-result" data-idx="${i}"><div>${r.display_name}</div>${caveat}</div>`;
        }).join('');
        resultsBox.querySelectorAll('.map-search-result[data-idx]').forEach(el => {
          el.addEventListener('click', () => {
            const r = results[Number(el.dataset.idx)];
            const lat = Number(r.lat);
            const lng = Number(r.lon);
            this.locaisMap.setView([lat, lng], 17);
            this.pickDepotLocation(lat, lng);

            const addrInput = document.getElementById('nd-address');
            if (addrInput && !addrInput.value.trim()) addrInput.value = r.display_name;

            resultsBox.style.display = 'none';
            input.value = r.display_name;
            lastQuery = r.display_name;
          });
        });
      } catch (_) {
        resultsBox.innerHTML = `<div class="map-search-result" style="cursor:default; color:#FF6B7F;">Erro ao buscar endereço. Tente novamente.</div>`;
      }
    };

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      if (!input.value.trim()) { resultsBox.style.display = 'none'; return; }
      debounceTimer = setTimeout(runSearch, 600);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(debounceTimer); runSearch(); }
    });
    btn.addEventListener('click', (e) => { e.preventDefault(); clearTimeout(debounceTimer); runSearch(); });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#locais-map-search')) resultsBox.style.display = 'none';
    });
  }

  updateLocaisMapMarkers() {
    if (!this.locaisMap || !this.locaisMapMarkersLayer) return;
    this.locaisMapMarkersLayer.clearLayers();

    const withCoords = (this.locais || []).filter(l => {
      if (l.lat === undefined || l.lat === null || l.lng === undefined || l.lng === null) return false;
      if (l.devno && this.ownershipFilter !== 'all') {
        const station = this.stations.find(s => s.devno === l.devno);
        if (station && !this.matchesOwnershipFilter(station.raw?.owner_id || station.dono)) return false;
      }
      return true;
    });

    withCoords.forEach(l => {
      const hasTotem = Boolean(l.devno);
      const statusMeta = hasTotem ? (this.meta[l.totemStatus] || this.meta.OFFLINE) : null;
      const pinColor = statusMeta ? statusMeta.color : '#FDCB24';
      const isCleaning = hasTotem && l.totemStatus === 'CLEANING';

      const icon = L.divIcon({
        className: '',
        html: `<div class="cpx-depot-pin" style="--pin-color:${pinColor};"><span class="pin-tag">${l.name || l.depotno}</span><span class="pin-dot${isCleaning ? ' is-cleaning' : ''}"></span></div>`,
        iconSize: [0, 0],
        iconAnchor: [7, 28]
      });
      const marker = L.marker([l.lat, l.lng], { icon }).addTo(this.locaisMapMarkersLayer);
      marker.bindPopup(`
        <div class="cpx-popup-title">${l.name || l.depotno}</div>
        <div class="cpx-popup-row">${l.address || 'Endereço não informado'}</div>
        <div class="cpx-popup-row">${hasTotem ? `<span style="color:${pinColor};">${statusMeta.label}</span>` : 'sem totem vinculado'}</div>
      `, { className: 'cpx-leaflet-popup' });
    });

    // Se nenhum local tem coordenadas ainda, mantém a visão geral do Brasil.
    // Caso existam pontos, enquadra todos automaticamente.
    if (withCoords.length > 0) {
      const bounds = L.latLngBounds(withCoords.map(l => [l.lat, l.lng]));
      this.locaisMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }

  pickDepotLocation(lat, lng) {
    this.pendingDepotLatLng = { lat, lng };

    if (this.locaisPickMarker) {
      this.locaisMap.removeLayer(this.locaisPickMarker);
    }
    this.locaisPickMarker = L.marker([lat, lng], {
      icon: L.divIcon({ className: '', html: `<div class="cpx-pick-pin"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] })
    }).addTo(this.locaisMap);

    const text = document.getElementById('nd-latlng-text');
    if (text) text.textContent = `Ponto selecionado: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    this.openModal('new-depot-modal');
  }

  openMoveModal(totemDevno, currentLoc, targetDepotno) {
    document.getElementById('move-current-location').value = currentLoc || 'Ponto a Cadastrar';
    const sel = document.getElementById('move-select-totem');
    if (sel) {
      sel.innerHTML = this.stations.map(s => `<option value="${s.devno}" ${s.devno === totemDevno ? 'selected' : ''}>${s.nome} (${s.devno})</option>`).join('');
    }
    const selLoc = document.getElementById('move-new-location');
    if (selLoc) {
      if (this.locais.length === 0) {
        selLoc.innerHTML = `<option value="">Nenhum outro local cadastrado</option>`;
      } else {
        selLoc.innerHTML = this.locais.map(l => `<option value="${l.depotno}" ${l.depotno === targetDepotno ? 'selected' : ''}>${l.name} (${l.depotno})</option>`).join('');
      }
    }
    this.openModal('move-modal');
  }

  async deleteDepotLocation(depotno, name) {
    if (!confirm(`Deseja realmente excluir o local "${name}"? Essa ação não pode ser desfeita.`)) return;

    try {
      const res = await fetch(`/api/v1/admin/depots/${encodeURIComponent(depotno)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.token}` }
      }).then(r => r.json());

      if (res.success) {
        this.showToast(`Local "${name}" excluído.`);
        await this.fetchBackendData();
      } else {
        this.showToast(res.message || 'Erro ao excluir o local.', 'err');
      }
    } catch (_) {
      this.showToast('Falha na comunicação com o servidor.', 'err');
    }
  }

  openOMModal(devno) {
    const sel = document.getElementById('om-totem-select');
    if (sel) {
      const options = this.stations.map(s => `<option value="${s.devno}" ${s.devno === devno ? 'selected' : ''}>${s.nome} (${s.devno}) — ${s.local}</option>`).join('');
      sel.innerHTML = `<option value="">Selecione uma estação...</option>${options}`;
    }
    this.openModal('om-modal');
  }

  // --- 3.5 CONTROLE DE MANUTENÇÃO ---
  renderManutencao() {
    const filter = this.manutFilter || 'open';
    const oms = this.oms || [];

    const openCount = oms.filter(o => !o.resolved).length;
    const machinesInMaint = this.stations.filter(s => s.status === 'MAINTENANCE').length;
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const resolvedRecently = oms.filter(o => o.resolved && o.resolvedAt && (Date.now() - new Date(o.resolvedAt).getTime()) <= thirtyDaysMs).length;

    const elOpen = document.getElementById('manut-kpi-open');
    const elMachines = document.getElementById('manut-kpi-machines');
    const elResolved = document.getElementById('manut-kpi-resolved');
    if (elOpen) elOpen.textContent = openCount;
    if (elMachines) elMachines.textContent = machinesInMaint;
    if (elResolved) elResolved.textContent = resolvedRecently;

    const tbody = document.getElementById('manut-tbody');
    if (!tbody) return;

    const list = oms.filter(o => {
      if (filter === 'open') return !o.resolved;
      if (filter === 'resolved') return o.resolved;
      return true;
    });

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:24px; color:#8a97a7;">Nenhuma ordem de manutenção encontrada.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(o => {
      const station = this.stations.find(s => s.devno === o.devno);
      return `
        <tr>
          <td style="font-weight:600; color:#fff;">${o.totemName || station?.nome || o.devno}</td>
          <td class="muted">${station?.local || '—'}</td>
          <td class="muted">${o.issueType || o.type || '—'}</td>
          <td><span style="padding:4px 9px; border-radius:999px; font-size:11px; font-weight:700; background:rgba(255,145,0,.16); color:#FFB454;">${o.priority || o.severity || 'Média'}</span></td>
          <td class="muted">${o.message || '—'}</td>
          <td class="mono muted">${o.timestamp ? new Date(o.timestamp).toLocaleDateString() : '—'}</td>
          <td><span class="status-chip ${o.resolved ? 'inactive' : 'active'}">${o.resolved ? 'Resolvida' : 'Aberta'}</span></td>
          <td style="text-align:right; white-space:nowrap;">
            <button class="btn btn-outline" style="padding:6px 12px; font-size:11.5px;" data-comments-id="${o.id}">Comentários${o.comments?.length ? ` (${o.comments.length})` : ''}</button>
            ${o.resolved ? '' : `<button class="btn btn-blue" style="padding:6px 12px; font-size:11.5px; margin-left:6px;" data-resolve-id="${o.id}">Resolver</button>`}
          </td>
        </tr>
      `;
    }).join('');

    this.renderManutRoute();
  }

  renderManutRoute() {
    const el = document.getElementById('manut-route-list');
    const countEl = document.getElementById('manut-route-count');
    if (!el) return;

    const priorityRank = { 'Alta': 0, 'Média': 1, 'Baixa': 2 };
    const priorityColor = { 'Alta': '#FF3D57', 'Média': '#FF9100', 'Baixa': '#5587B3' };

    const stops = (this.oms || [])
      .filter(o => !o.resolved)
      .slice()
      .sort((a, b) => {
        const pa = priorityRank[a.priority] ?? 1;
        const pb = priorityRank[b.priority] ?? 1;
        if (pa !== pb) return pa - pb;
        return new Date(a.timestamp) - new Date(b.timestamp);
      });

    if (countEl) countEl.textContent = `${stops.length} parada${stops.length === 1 ? '' : 's'}`;

    if (stops.length === 0) {
      el.innerHTML = `<div style="text-align:center; padding:20px; color:#8a97a7; font-size:12.5px;">Nenhuma ordem em aberto — rota livre esta semana.</div>`;
      return;
    }

    el.innerHTML = stops.map((o, i) => {
      const station = this.stations.find(s => s.devno === o.devno);
      const daysOpen = Math.max(0, Math.floor((Date.now() - new Date(o.timestamp).getTime()) / (24 * 60 * 60 * 1000)));
      const color = priorityColor[o.priority] || '#7fb2dd';
      return `
        <div style="display:flex; align-items:center; gap:14px; padding:11px 0; border-bottom:1px solid var(--border);">
          <div style="width:26px; height:26px; border-radius:50%; background:rgba(255,255,255,.06); display:flex; align-items:center; justify-content:center; font-family:var(--font-mono); font-size:12px; color:#8a97a7; flex-shrink:0;">${i + 1}</div>
          <div style="flex:1; min-width:0;">
            <div style="font-weight:600; color:#fff; font-size:13px;">${o.totemName || station?.nome || o.devno}</div>
            <div style="font-size:11.5px; color:#8a97a7; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${station?.local || 'Local não informado'}</div>
          </div>
          <div style="text-align:right; flex-shrink:0;">
            <span style="padding:3px 9px; border-radius:999px; font-size:10.5px; font-weight:700; background:${color}22; color:${color};">${o.priority || 'Média'}</span>
            <div style="font-size:10.5px; color:#5f7186; margin-top:3px;">${daysOpen === 0 ? 'aberta hoje' : `${daysOpen}d em aberto`}${o.assignee ? ` · ${o.assignee}` : ''}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  openOMCommentsModal(id) {
    const om = (this.oms || []).find(o => o.id === id);
    if (!om) return;

    this.activeOMCommentId = id;
    const station = this.stations.find(s => s.devno === om.devno);

    const subtitle = document.getElementById('om-comments-subtitle');
    if (subtitle) subtitle.textContent = `${om.totemName || station?.nome || om.devno} — ${station?.local || 'Local não informado'}`;

    const list = document.getElementById('om-comments-list');
    if (list) {
      const comments = om.comments || [];
      list.innerHTML = comments.length === 0
        ? `<div style="text-align:center; padding:14px; color:#8a97a7; font-size:12.5px;">Nenhum comentário ainda.</div>`
        : comments.map(c => `
          <div style="background:rgba(255,255,255,.04); border:1px solid var(--border); border-radius:10px; padding:10px 12px;">
            <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:4px;">
              <span style="font-size:12px; font-weight:700; color:#FFB454;">${c.author}</span>
              <span style="font-size:10.5px; color:#5f7186; font-family:var(--font-mono);">${new Date(c.timestamp).toLocaleString()}</span>
            </div>
            <div style="font-size:12.5px; color:#e7edf4; white-space:pre-wrap;">${c.text}</div>
          </div>
        `).join('');
    }

    const textarea = document.getElementById('om-comment-text');
    if (textarea) textarea.value = '';

    this.openModal('om-comments-modal');
  }

  // --- 3. DASHBOARD GERAL ---
  renderDashboard() {
    // Filtra as transações reais dentro do período selecionado (Hoje / 7 dias / 30 dias / Mês)
    const { start, end } = this.getDashboardDateRange();
    const filteredStations = this.getFilteredStations();
    const txsPeriod = (this.transactions || []).filter(t => {
      if (t.status && t.status !== 'APPROVED') return false;
      if (this.ownershipFilter !== 'all') {
        const station = this.stations.find(s => s.devno === t.devno);
        if (!station || !this.matchesOwnershipFilter(station.raw?.owner_id || station.dono)) return false;
      }
      const d = new Date(t.timestamp);
      return d >= start && d < end;
    });

    const totalRev = txsPeriod.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    const totalCyc = txsPeriod.length;
    const activeTotems = filteredStations.filter(s => s.status === 'IDLE' || s.status === 'CLEANING').length;
    const openOms = this.oms.length;

    const elTotalRev = document.getElementById('dash-total-revenue');
    const elTotalCycles = document.getElementById('dash-total-cycles');
    const elActiveTotems = document.getElementById('dash-active-totems-count');
    const elOpenOms = document.getElementById('dash-open-oms-count');
    const elPeriodTotal = document.getElementById('dash-chart-period-total');

    if (elTotalRev) elTotalRev.textContent = fmtBRL(totalRev);
    if (elTotalCycles) elTotalCycles.textContent = totalCyc;
    if (elActiveTotems) elActiveTotems.innerHTML = `${activeTotems}<span style="color:#8a97a7">/${filteredStations.length}</span>`;
    if (elOpenOms) elOpenOms.textContent = openOms;
    if (elPeriodTotal) elPeriodTotal.textContent = `${fmtBRL(totalRev)} no período`;

    // 1. Gráfico SVG — faturamento real agregado por dia, dentro do período selecionado
    const dayMs = 24 * 60 * 60 * 1000;
    const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const totalsByDay = {};
    txsPeriod.forEach(t => {
      const d = new Date(t.timestamp);
      totalsByDay[dayKey(d)] = (totalsByDay[dayKey(d)] || 0) + (Number(t.amount) || 0);
    });

    const renderEnd = new Date(Math.min(end.getTime() - 1, Date.now()));
    const dayList = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const lastDay = new Date(renderEnd.getFullYear(), renderEnd.getMonth(), renderEnd.getDate());
    while (cursor <= lastDay) {
      dayList.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    if (dayList.length === 0) dayList.push(new Date(start));
    if (dayList.length === 1) dayList.unshift(new Date(dayList[0].getTime() - dayMs));

    const dias = dayList.map(d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`);
    const serieRaw = dayList.map(d => totalsByDay[dayKey(d)] || 0);
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

    // 2. Ranking por Máquina — faturamento real do período, por transação
    const elRankMaq = document.getElementById('dash-ranking-maquinas');
    if (elRankMaq) {
      const maqMap = {};
      txsPeriod.forEach(t => {
        if (!maqMap[t.devno]) {
          const st = this.stations.find(s => s.devno === t.devno);
          maqMap[t.devno] = { devno: t.devno, nome: st?.nome || t.totemName || t.devno, fat: 0 };
        }
        maqMap[t.devno].fat += Number(t.amount) || 0;
      });
      const sorted = Object.values(maqMap).sort((a, b) => b.fat - a.fat);
      if (sorted.length === 0) {
        elRankMaq.innerHTML = `<div style="color:#8a97a7; font-size:12px;">Nenhuma transação no período selecionado.</div>`;
      } else {
        const maxVal = sorted[0]?.fat || 1;
        elRankMaq.innerHTML = sorted.map((m, idx) => `
          <div class="rank-item">
            <div class="rank-row">
              <span class="rank-idx">${idx + 1}</span>
              <span class="rank-name">${m.nome}</span>
              <span class="rank-val">${fmtBRL(m.fat)}</span>
            </div>
            <div class="rank-bar-bg">
              <div class="rank-bar-fill" style="width:${Math.max(8, Math.round((m.fat / maxVal) * 100))}%;"></div>
            </div>
          </div>
        `).join('');
      }
    }

    // 3. Ranking por Dono — faturamento real do período, por transação
    const elRankDono = document.getElementById('dash-ranking-donos');
    if (elRankDono) {
      const donosMap = {};
      txsPeriod.forEach(t => {
        const st = this.stations.find(s => s.devno === t.devno);
        const nome = st?.dono || 'Desconhecido';
        if (!donosMap[nome]) donosMap[nome] = { name: nome, fat: 0, count: 0 };
        donosMap[nome].fat += Number(t.amount) || 0;
        donosMap[nome].count += 1;
      });
      const donosArr = Object.values(donosMap).sort((a, b) => b.fat - a.fat);
      if (donosArr.length === 0) {
        elRankDono.innerHTML = `<div style="color:#8a97a7; font-size:12px;">Nenhuma transação no período selecionado.</div>`;
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
      if (filteredStations.length === 0) {
        elPayback.innerHTML = `<div style="color:#8a97a7; font-size:12px; padding:10px 0;">Nenhuma estação registrada para cálculo de payback.</div>`;
      } else {
        elPayback.innerHTML = filteredStations.map(s => {
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

    this.renderDashboardTrends();
  }

  // 6. Análise de Tendências — comparativos de lavagens e mapa de calor de horários de pico
  renderDashboardTrends() {
    const approved = (this.transactions || []).filter(t => !(t.status && t.status !== 'APPROVED'));
    const dayMs = 24 * 60 * 60 * 1000;
    const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const wk = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const now = new Date();

    // Comparativo semanal (janela móvel de 7 dias)
    const todayStart = startOfDay(now);
    const semAtualStart = new Date(todayStart.getTime() - 6 * dayMs);
    const semAtualEnd = new Date(todayStart.getTime() + dayMs);
    const semAnteriorStart = new Date(todayStart.getTime() - 13 * dayMs);
    const semAnteriorEnd = semAtualStart;

    const semAtualByDay = [0, 0, 0, 0, 0, 0, 0];
    const semAnteriorByDay = [0, 0, 0, 0, 0, 0, 0];
    let semAtualTotal = 0, semAnteriorTotal = 0;
    approved.forEach(t => {
      const d = new Date(t.timestamp);
      if (d >= semAtualStart && d < semAtualEnd) { semAtualByDay[d.getDay()]++; semAtualTotal++; }
      else if (d >= semAnteriorStart && d < semAnteriorEnd) { semAnteriorByDay[d.getDay()]++; semAnteriorTotal++; }
    });

    const orderedIdx = Array.from({ length: 7 }, (_, i) => (semAtualStart.getDay() + i) % 7);
    const semMax = Math.max(1, ...orderedIdx.map(i => semAtualByDay[i]), ...orderedIdx.map(i => semAnteriorByDay[i]));

    const elWeekBars = document.getElementById('dash-trend-week-bars');
    if (elWeekBars) {
      elWeekBars.innerHTML = orderedIdx.map(i => `
        <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:8px; height:100%; justify-content:flex-end;">
          <div style="display:flex; align-items:flex-end; gap:4px; height:100%;">
            <div style="width:11px; border-radius:3px 3px 0 0; background:#5587B3; opacity:.55; height:${Math.round(semAnteriorByDay[i] / semMax * 100)}%;"></div>
            <div style="width:11px; border-radius:3px 3px 0 0; background:#00C566; height:${Math.round(semAtualByDay[i] / semMax * 100)}%;"></div>
          </div>
          <span style="font-size:9.5px; color:#6d7a8a;">${wk[i]}</span>
        </div>
      `).join('');
    }

    const semDelta = semAnteriorTotal > 0 ? Math.round((semAtualTotal - semAnteriorTotal) / semAnteriorTotal * 100) : (semAtualTotal > 0 ? 100 : 0);
    const semBadge = document.getElementById('dash-trend-week-badge');
    if (semBadge) {
      semBadge.textContent = `${semDelta >= 0 ? '+' : ''}${semDelta}% vs. semana anterior`;
      semBadge.style.background = semDelta >= 0 ? 'rgba(0,197,102,.14)' : 'rgba(255,61,87,.14)';
      semBadge.style.color = semDelta >= 0 ? '#00C566' : '#FF6B7F';
    }
    const semLegendAtual = document.getElementById('dash-trend-week-legend-atual');
    if (semLegendAtual) semLegendAtual.textContent = `Semana atual (${semAtualTotal})`;
    const semLegendAnterior = document.getElementById('dash-trend-week-legend-anterior');
    if (semLegendAnterior) semLegendAnterior.textContent = `Semana anterior (${semAnteriorTotal})`;

    // Comparativo mensal (mês-calendário atual x anterior)
    const mesAtualStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const mesAnteriorStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const mesAnteriorEnd = mesAtualStart;

    let mesAtualTotal = 0, mesAnteriorTotal = 0;
    approved.forEach(t => {
      const d = new Date(t.timestamp);
      if (d >= mesAtualStart) mesAtualTotal++;
      else if (d >= mesAnteriorStart && d < mesAnteriorEnd) mesAnteriorTotal++;
    });

    const mesMax = Math.max(1, mesAtualTotal, mesAnteriorTotal);
    const elMesAtual = document.getElementById('dash-trend-month-current');
    const elMesAnterior = document.getElementById('dash-trend-month-previous');
    const elMesAtualBar = document.getElementById('dash-trend-month-current-bar');
    const elMesAnteriorBar = document.getElementById('dash-trend-month-previous-bar');
    if (elMesAtual) elMesAtual.textContent = `${mesAtualTotal} lavagens`;
    if (elMesAnterior) elMesAnterior.textContent = `${mesAnteriorTotal} lavagens`;
    if (elMesAtualBar) elMesAtualBar.style.width = `${Math.round(mesAtualTotal / mesMax * 100)}%`;
    if (elMesAnteriorBar) elMesAnteriorBar.style.width = `${Math.round(mesAnteriorTotal / mesMax * 100)}%`;

    const mesDelta = mesAnteriorTotal > 0 ? Math.round((mesAtualTotal - mesAnteriorTotal) / mesAnteriorTotal * 100) : (mesAtualTotal > 0 ? 100 : 0);
    const mesBadge = document.getElementById('dash-trend-month-badge');
    if (mesBadge) {
      mesBadge.textContent = `${mesDelta >= 0 ? '+' : ''}${mesDelta}% vs. mês anterior`;
      mesBadge.style.background = mesDelta >= 0 ? 'rgba(0,197,102,.14)' : 'rgba(255,61,87,.14)';
      mesBadge.style.color = mesDelta >= 0 ? '#00C566' : '#FF6B7F';
    }

    // Mapa de calor — dia da semana x faixa horária
    const heatHoras = ['00h', '02h', '04h', '06h', '08h', '10h', '12h', '14h', '16h', '18h', '20h', '22h'];
    const heatMatrix = wk.map(() => new Array(heatHoras.length).fill(0));
    approved.forEach(t => {
      const d = new Date(t.timestamp);
      heatMatrix[d.getDay()][Math.floor(d.getHours() / 2)]++;
    });

    const heatOrder = [1, 2, 3, 4, 5, 6, 0]; // Seg..Dom
    const heatMax = Math.max(1, ...heatMatrix.flat());
    let peak = { day: heatOrder[0], hourIdx: 0, v: -1 };
    heatOrder.forEach(dow => {
      heatMatrix[dow].forEach((v, hi) => { if (v > peak.v) peak = { day: dow, hourIdx: hi, v }; });
    });

    const theadRow = document.getElementById('dash-heatmap-head');
    if (theadRow) {
      theadRow.innerHTML = '<th></th>' + heatHoras.map(h => `<th style="font-weight:600; font-size:9.5px; color:#6d7a8a; font-family:var(--font-mono); padding-bottom:2px;">${h}</th>`).join('');
    }
    const tbody = document.getElementById('dash-heatmap-body');
    if (tbody) {
      tbody.innerHTML = heatOrder.map(dow => `
        <tr>
          <td style="font-size:10.5px; color:#8a97a7; padding-right:8px; white-space:nowrap;">${wk[dow]}</td>
          ${heatMatrix[dow].map((v, hi) => {
            const inten = v / heatMax;
            return `<td title="${wk[dow]} ${heatHoras[hi]} — ${v} lavagens" style="width:26px; height:22px; border-radius:5px; background:rgba(0,197,102,${(0.08 + inten * 0.82).toFixed(2)});"></td>`;
          }).join('')}
        </tr>
      `).join('');
    }
    const caption = document.getElementById('dash-heatmap-caption');
    if (caption) {
      caption.textContent = peak.v > 0
        ? `Pico de movimento: ${wk[peak.day]}, por volta das ${heatHoras[peak.hourIdx]} (${peak.v} lavagens)`
        : 'Ainda não há dados suficientes para identificar horários de pico.';
    }
  }

  // --- 4. CUPONS & VOUCHERS ---
  renderCoupons() {
    const tbody = document.getElementById('coupons-tbody');
    if (!tbody) return;

    const list = (this.state.coupons || []).filter(c => {
      if (this.ownershipFilter === 'all') return true;
      if (!c.allowedTotems || c.allowedTotems.length === 0) return true; // cupom global, não é restrito a um dono
      return c.allowedTotems.some(devno => {
        const station = this.stations.find(s => s.devno === devno);
        return station && this.matchesOwnershipFilter(station.raw?.owner_id || station.dono);
      });
    });
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:36px; color:var(--text-muted); font-size:13.5px;">Nenhum cupom cadastrado no banco. Clique no botão acima para adicionar um novo cupom.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(c => {
      const max = c.maxUsages || 1;
      const current = c.currentUsages || 0;
      const isExhausted = current >= max || c.isUsed;
      const modeLabel = c.applicableMode ? c.applicableMode : 'Todas as Modalidades';
      const totemsLabel = (c.allowedTotems && c.allowedTotems.length > 0)
        ? `<span class="coupon-scope-badge specific" title="Válido para: ${c.allowedTotems.join(', ')}">${ICONS.pin} ${c.allowedTotems.join(', ')}</span>`
        : `<span class="coupon-scope-badge all">${ICONS.globe} Todas as Máquinas</span>`;

      // Controle por CPF
      const perCpf = Number(c.maxUsagesPerCpf) > 0 ? Number(c.maxUsagesPerCpf) : 1;
      const requireCpf = c.requireCpf !== false;
      const redemptions = Array.isArray(c.redemptions) ? c.redemptions : [];
      const uniqueCpfs = new Set(redemptions.map(r => onlyDigits(r.cpf)).filter(Boolean)).size;

      const perCpfLabel = requireCpf
        ? `<span class="coupon-cpf-limit-badge">${ICONS.shield} ${perCpf}x por CPF</span>`
        : `<span class="coupon-cpf-limit-badge off">${ICONS.globe} Sem controle de CPF</span>`;

      const cpfsLabel = uniqueCpfs > 0
        ? `<button class="coupon-cpf-count" onclick="window.app.openCouponEditModal('${c.code}', 'cpfs')" title="Ver os CPFs que utilizaram este cupom">
             ${ICONS.user} <strong>${uniqueCpfs}</strong> CPF${uniqueCpfs > 1 ? 's' : ''}
           </button>`
        : `<button class="coupon-cpf-count empty" onclick="window.app.openCouponEditModal('${c.code}', 'cpfs')" title="Abrir o registro de CPFs">Nenhum CPF ainda</button>`;

      return `
        <tr>
          <td>
            <span class="coupon-code-pill" onclick="window.app.openCouponQrModal('${c.code}')" title="Clique para ver o QR Code">
              <span class="c-icon">${ICONS.ticket}</span> ${c.code}
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
          <td>${perCpfLabel}</td>
          <td>${cpfsLabel}</td>
          <td>
            <span class="coupon-status-chip ${isExhausted ? 'exhausted' : 'active'}">
              <span class="status-dot"></span>
              ${isExhausted ? 'Esgotado' : 'Ativo'}
            </span>
          </td>
          <td style="text-align:right;">
            <div class="coupon-actions-row">
              <button class="btn-coupon-edit" onclick="window.app.openCouponEditModal('${c.code}', 'config')" title="Editar regras, estações e ver CPFs">
                <span>${ICONS.pencil}</span> Editar
              </button>
              <button class="btn-coupon-qr" onclick="window.app.openCouponQrModal('${c.code}')">
                <span>${ICONS.phone}</span> QR Code
              </button>
              <button class="btn-coupon-reset" onclick="window.app.resetCoupon('${c.code}')">
                <span>${ICONS.refresh}</span> Resetar
              </button>
              <button class="btn-coupon-delete" title="Excluir cupom" onclick="window.app.deleteCoupon('${c.code}')">
                ${ICONS.trash}
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

    const list = (this.state.users || []).filter(u => {
      if (this.ownershipFilter === 'all' || u.role === 'CRPADMIN') return true;
      return (u.franchiseType === 'PROPRIA' ? 'PROPRIA' : 'FRANQUEADO') === this.ownershipFilter;
    });
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:20px; color:#8a97a7;">Nenhum usuário cadastrado.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(u => {
      const isFranqueado = u.franchiseType !== 'PROPRIA';
      const vinculoBadge = u.role === 'CRPADMIN'
        ? '<span class="muted">—</span>'
        : `<span class="user-badge-role ${isFranqueado ? 'owner' : 'crpadmin'}">${isFranqueado ? 'Franqueado' : 'Máquina Própria'}</span>`;
      return `
      <tr>
        <td style="font-weight:700; color:#fff;">${u.responsible_name || u.username}</td>
        <td class="mono muted">${u.cnpj || '—'}</td>
        <td class="muted">${u.email || '—'}</td>
        <td class="muted">${u.phone || '—'}</td>
        <td>${u.company_name || '—'}</td>
        <td><span class="user-badge-role ${u.role === 'CRPADMIN' ? 'crpadmin' : 'owner'}">${u.role}</span></td>
        <td>${vinculoBadge}</td>
        <td class="mono accent">${this.stations.filter(s => s.dono === (u.responsible_name || u.username)).length} máquina(s)</td>
        <td style="text-align:right; white-space:nowrap;">
          <span style="color:#00C566; font-size:11px; font-weight:700; margin-right:10px;">● Ativo</span>
          ${u.role === 'CRPADMIN' ? '' : `<button class="btn btn-blue" style="padding:6px 12px; font-size:11.5px;" onclick="window.app.openEditOwnerModal('${u.id}')">Editar</button>`}
        </td>
      </tr>
    `;
    }).join('');
  }

  openEditOwnerModal(userId) {
    const u = (this.state.users || []).find(x => x.id === userId);
    if (!u) return;

    document.getElementById('eo-user-id').value = u.id;
    document.getElementById('eo-cnpj').value = u.cnpj || '';
    document.getElementById('eo-responsible').value = u.responsible_name || '';
    document.getElementById('eo-company').value = u.company_name || '';
    document.getElementById('eo-email').value = u.email || '';
    document.getElementById('eo-phone').value = u.phone || '';
    document.getElementById('eo-password').value = '';

    const isPropria = u.franchiseType === 'PROPRIA';
    document.getElementById('eo-type-franqueado').checked = !isPropria;
    document.getElementById('eo-type-propria').checked = isPropria;

    this.openModal('edit-owner-modal');
  }

  openNewCouponModal() {
    const modal = document.getElementById('new-coupon-modal');
    const scopeSelect = document.getElementById('nc-totems-scope');
    const checkboxesDiv = document.getElementById('nc-totems-checkboxes');
    if (scopeSelect) scopeSelect.value = 'TODAS';
    const perCpfInput = document.getElementById('nc-max-per-cpf');
    const requireCpfSelect = document.getElementById('nc-require-cpf');
    if (perCpfInput) perCpfInput.value = '1';
    if (requireCpfSelect) requireCpfSelect.value = '1';
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

    if (badge) badge.innerHTML = `${ICONS.ticket} ${coupon.code}`;
    if (desc) desc.textContent = coupon.description || 'Cupom Promocional CapaXero';
    if (discount) discount.textContent = `${coupon.discountPercent}% OFF${coupon.discountPercent === 100 ? ' (GRÁTIS)' : ''}`;
    if (mode) mode.textContent = coupon.applicableMode ? `Modo: ${coupon.applicableMode}` : 'Qualquer Modalidade';
    if (totemsBadge) {
      totemsBadge.innerHTML = (coupon.allowedTotems && coupon.allowedTotems.length > 0)
        ? `${ICONS.pin} ${coupon.allowedTotems.join(', ')}`
        : `${ICONS.globe} Todas as Máquinas`;
    }
    if (usages) usages.textContent = `${coupon.currentUsages || 0} / ${coupon.maxUsages || 1} usos`;

    if (img) img.src = `/api/v1/coupons/${encodeURIComponent(code)}/qrcode.png?size=400&t=${Date.now()}`;
    modal.classList.add('open');
  }

  copyCurrentCouponCode() {
    if (!this.selectedCouponCode) return;
    navigator.clipboard.writeText(this.selectedCouponCode).then(() => {
      this.showToast(`Código "${this.selectedCouponCode}" copiado para a área de transferência!`);
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
    this.showToast(`Download da imagem do QR Code "${this.selectedCouponCode}" iniciado.`);
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
      this.showToast('Permita popups para imprimir o voucher.', 'warn');
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
          <div class="logo">${ICONS.shield} CAPAXERO</div>
          <div style="font-size: 14px; color: #666;">VOUCHER DE HIGIENIZAÇÃO DE CAPACETES</div>
          <div class="discount">${coupon.discountPercent}% DE DESCONTO</div>
          <div class="code-box">${ICONS.ticket} ${coupon.code}</div>
          <img class="qr-img" src="${qrUrl}" alt="QR Code ${coupon.code}">
          <div style="font-size: 13px; font-weight: bold; margin-bottom: 4px;">${coupon.description || 'Campanha Promocional'}</div>
          <div class="totems-info">${ICONS.pin} ${totemsText}</div>
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

  /**
   * Abre o modal de edição do cupom.
   * @param {string} code  código do cupom
   * @param {string} tab   'config' (padrão) ou 'cpfs'
   */
  openCouponEditModal(code, tab = 'config') {
    const coupon = (this.state.coupons || []).find(c => c.code === code);
    if (!coupon) {
      this.showToast('Cupom não encontrado.', 'err');
      return;
    }

    this.selectedCouponCode = code;
    this.editingCoupon = coupon;

    const badge = document.getElementById('edit-modal-code-badge');
    if (badge) badge.innerHTML = `${ICONS.ticket} ${coupon.code}`;

    const subtitle = document.getElementById('edit-modal-subtitle');
    if (subtitle) {
      subtitle.textContent = `${coupon.discountPercent}% OFF — ${coupon.currentUsages || 0} de ${coupon.maxUsages || 1} utilizações`;
    }

    // --- Preenche o formulário com os valores atuais ---
    const setVal = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    };

    setVal('ec-code', coupon.code);
    setVal('ec-desc', coupon.description || '');
    setVal('ec-discount', coupon.discountPercent || 10);
    setVal('ec-max-usages', coupon.maxUsages || 1);
    setVal('ec-max-per-cpf', Number(coupon.maxUsagesPerCpf) > 0 ? coupon.maxUsagesPerCpf : 1);
    setVal('ec-require-cpf', coupon.requireCpf === false ? '0' : '1');
    setVal('ec-mode', coupon.applicableMode || 'TODOS');

    // --- Estações permitidas ---
    const allowed = Array.isArray(coupon.allowedTotems) ? coupon.allowedTotems : [];
    const isSpecific = allowed.length > 0;
    const scopeSelect = document.getElementById('ec-totems-scope');
    const checkboxesDiv = document.getElementById('ec-totems-checkboxes');

    if (scopeSelect) scopeSelect.value = isSpecific ? 'ESPECIFICAS' : 'TODAS';
    if (checkboxesDiv) {
      checkboxesDiv.style.display = isSpecific ? 'block' : 'none';
      checkboxesDiv.innerHTML = this.stations.map(t => {
        const checked = allowed.some(a => String(a).toUpperCase() === String(t.code).toUpperCase()) ? 'checked' : '';
        return `
          <label class="checkbox-row" style="margin-bottom:6px; font-size:12.5px; color:#fff; display:flex; align-items:center; gap:8px;">
            <input type="checkbox" class="ec-totem-chk" value="${t.code}" ${checked}>
            <span><strong>${t.code}</strong> (${t.nome} — ${t.local})</span>
          </label>
        `;
      }).join('');

      if (this.stations.length === 0) {
        checkboxesDiv.innerHTML = `<div style="color:#8a97a7; font-size:12.5px;">Nenhuma estação cadastrada na rede.</div>`;
      }
    }

    this.switchCouponEditTab(tab);
    this.openModal('coupon-edit-modal');
    this.loadCouponCpfs(code);
  }

  /** Alterna entre as abas Configurações / CPFs Registrados. */
  switchCouponEditTab(tab) {
    document.querySelectorAll('.coupon-edit-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.editTab === tab);
    });
    document.querySelectorAll('.coupon-edit-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `edit-pane-${tab}`);
    });
  }

  /** Carrega o registro de CPFs que utilizaram o cupom. */
  async loadCouponCpfs(code) {
    const tbody = document.getElementById('coupon-cpfs-tbody');
    const summary = document.getElementById('cpfs-modal-summary');
    const tabCount = document.getElementById('edit-tab-cpf-count');

    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--text-muted);">Carregando CPFs...</td></tr>`;
    if (summary) summary.innerHTML = '';

    try {
      const res = await fetch(`/api/v1/coupons/${encodeURIComponent(code)}/redemptions`).then(r => r.json());
      if (!res.success) throw new Error(res.message || 'Falha ao carregar');

      const rows = res.data || [];
      this.currentCouponCpfRows = rows;

      // Contagem de usos por CPF
      const usageByCpf = {};
      for (const r of rows) {
        const key = onlyDigits(r.cpf);
        usageByCpf[key] = (usageByCpf[key] || 0) + 1;
      }

      const sm = res.summary || {};
      if (tabCount) tabCount.textContent = sm.uniqueCpfs || 0;

      if (summary) {
        summary.innerHTML = `
          <div class="cpf-summary-box">
            <div class="lbl">CPFs Únicos</div>
            <div class="val accent">${sm.uniqueCpfs || 0}</div>
          </div>
          <div class="cpf-summary-box">
            <div class="lbl">Total de Resgates</div>
            <div class="val">${sm.totalRedemptions || 0} / ${sm.maxUsages || 1}</div>
          </div>
          <div class="cpf-summary-box">
            <div class="lbl">Limite por CPF</div>
            <div class="val">${sm.requireCpf ? `${sm.maxUsagesPerCpf || 1}x` : 'Livre'}</div>
          </div>
          <div class="cpf-summary-box">
            <div class="lbl">Desconto</div>
            <div class="val accent">${sm.discountPercent || 0}% OFF</div>
          </div>
        `;
      }

      if (!tbody) return;
      if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:28px; color:var(--text-muted); font-size:13px;">Nenhum CPF utilizou este cupom até o momento.</td></tr>`;
        return;
      }

      tbody.innerHTML = rows.map(r => {
        const when = r.redeemedAt ? new Date(r.redeemedAt).toLocaleString('pt-BR') : '—';
        const uses = usageByCpf[onlyDigits(r.cpf)] || 1;
        return `
          <tr>
            <td><span class="cpf-pill">${ICONS.user} ${r.cpfFormatted || fmtCPF(r.cpf)}</span></td>
            <td class="mono muted">${when}</td>
            <td class="mono">${r.totemId || '—'}</td>
            <td class="muted">${r.selectedMode || 'Qualquer'}</td>
            <td class="mono accent">${uses}x</td>
            <td style="text-align:right;">
              <button class="btn-cpf-release" title="Liberar este CPF para usar o cupom novamente"
                onclick="window.app.releaseCouponCpf('${r.id}', '${r.cpfFormatted || fmtCPF(r.cpf)}')">
                ${ICONS.refresh} Liberar
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--status-red);">Erro ao carregar os CPFs deste cupom.</td></tr>`;
    }
  }

  /** Remove o registro de um CPF, liberando-o para usar o cupom de novo. */
  async releaseCouponCpf(redemptionId, cpfLabel) {
    if (!this.selectedCouponCode) return;
    if (!confirm(`Liberar o CPF ${cpfLabel} para utilizar o cupom "${this.selectedCouponCode}" novamente?`)) return;

    try {
      const res = await fetch(
        `/api/v1/coupons/${encodeURIComponent(this.selectedCouponCode)}/redemptions/${encodeURIComponent(redemptionId)}`,
        { method: 'DELETE' }
      ).then(r => r.json());

      if (res.success) {
        this.showToast(`CPF ${cpfLabel} liberado com sucesso.`);
        await this.fetchBackendData();
        await this.loadCouponCpfs(this.selectedCouponCode);
      } else {
        this.showToast(res.message || 'Não foi possível liberar o CPF.', 'err');
      }
    } catch (_) {
      this.showToast('Erro ao liberar o CPF.', 'err');
    }
  }

  /** Salva as alterações do cupom. */
  async submitEditCoupon(e) {
    e.preventDefault();
    if (!this.selectedCouponCode) return;

    const description = document.getElementById('ec-desc').value.trim();
    const discountPercent = Number(document.getElementById('ec-discount').value);
    const maxUsages = Number(document.getElementById('ec-max-usages').value);
    const maxUsagesPerCpf = Number(document.getElementById('ec-max-per-cpf').value);
    const requireCpf = document.getElementById('ec-require-cpf').value === '1';
    const applicableMode = document.getElementById('ec-mode').value;

    const scopeVal = document.getElementById('ec-totems-scope')?.value || 'TODAS';
    let allowedTotems = null;
    if (scopeVal === 'ESPECIFICAS') {
      const selected = Array.from(document.querySelectorAll('.ec-totem-chk:checked')).map(cb => cb.value);
      if (selected.length === 0) {
        this.showToast('Selecione pelo menos uma máquina para restringir o cupom.', 'warn');
        return;
      }
      allowedTotems = selected;
    }

    try {
      const res = await fetch(`/api/v1/coupons/${encodeURIComponent(this.selectedCouponCode)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description, discountPercent, maxUsages,
          maxUsagesPerCpf, requireCpf, applicableMode, allowedTotems
        })
      }).then(r => r.json());

      if (res.success) {
        this.showToast(res.message || 'Cupom atualizado com sucesso!');
        document.getElementById('coupon-edit-modal').classList.remove('open');
        await this.fetchBackendData();
      } else {
        this.showToast(res.message || 'Erro ao salvar o cupom.', 'err');
      }
    } catch (err) {
      this.showToast('Erro ao salvar o cupom.', 'err');
    }
  }

  /** Exporta o registro de CPFs do cupom aberto em CSV. */
  exportCouponCpfsCsv() {
    const rows = this.currentCouponCpfRows || [];
    if (rows.length === 0) {
      this.showToast('Nenhum CPF registrado para exportar.', 'warn');
      return;
    }

    const header = 'CPF;Data;Estacao;Modalidade;Cupom';
    const lines = rows.map(r => [
      r.cpfFormatted || fmtCPF(r.cpf),
      r.redeemedAt ? new Date(r.redeemedAt).toLocaleString('pt-BR') : '',
      r.totemId || '',
      r.selectedMode || '',
      this.selectedCouponCode || ''
    ].join(';'));

    const csv = [header, ...lines].join(String.fromCharCode(10));
    const blob = new Blob([String.fromCharCode(0xFEFF) + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cpfs_cupom_${this.selectedCouponCode || 'capaxero'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('Registro de CPFs exportado em CSV.');
  }

  async submitNewCoupon(e) {
    e.preventDefault();
    const code = document.getElementById('nc-code').value.trim().toUpperCase();
    const description = document.getElementById('nc-desc').value.trim();
    const discountPercent = Number(document.getElementById('nc-discount').value);
    const maxUsages = Number(document.getElementById('nc-max-usages').value);
    const maxUsagesPerCpf = Number(document.getElementById('nc-max-per-cpf')?.value || 1);
    const requireCpf = (document.getElementById('nc-require-cpf')?.value || '1') === '1';
    const applicableMode = document.getElementById('nc-mode').value;

    const scopeVal = document.getElementById('nc-totems-scope')?.value || 'TODAS';
    let allowedTotems = null;
    if (scopeVal === 'ESPECIFICAS') {
      const selected = Array.from(document.querySelectorAll('.nc-totem-chk:checked')).map(cb => cb.value);
      if (selected.length === 0) {
        this.showToast('Selecione pelo menos uma máquina para restringir o cupom.', 'warn');
        return;
      }
      allowedTotems = selected;
    }

    if (!code) return;

    try {
      const res = await fetch('/api/v1/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, description, discountPercent, maxUsages, maxUsagesPerCpf, requireCpf, applicableMode, allowedTotems })
      }).then(r => r.json());

      if (res.success) {
        this.showToast(`Cupom ${code} criado com sucesso!`);
        document.getElementById('new-coupon-modal').classList.remove('open');
        e.target.reset();
        await this.fetchBackendData();
        this.openCouponQrModal(code);
      } else {
        this.showToast(`${res.message}`);
      }
    } catch (err) {
      this.showToast('Erro ao criar cupom.');
    }
  }

  async resetCoupon(code) {
    try {
      const res = await fetch(`/api/v1/coupons/${encodeURIComponent(code)}/reset`, { method: 'POST' }).then(r => r.json());
      if (res.success) {
        this.showToast(`Cupom ${code} resetado para disponível.`);
        await this.fetchBackendData();
      }
    } catch (_) {}
  }

  async resetAllCoupons() {
    try {
      const res = await fetch('/api/v1/coupons/reset-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'ALL_COUPONS' })
      }).then(r => r.json());
      if (res.success) {
        this.showToast('Todos os cupons foram resetados (usos e CPFs registrados).');
        await this.fetchBackendData();
      }
    } catch (_) {}
  }

  async deleteCoupon(code) {
    if (!confirm(`Deseja realmente excluir o cupom promocional "${code}"?`)) return;
    try {
      const res = await fetch(`/api/v1/coupons/${encodeURIComponent(code)}`, { method: 'DELETE' }).then(r => r.json());
      if (res.success) {
        this.showToast(`Cupom ${code} excluído.`);
        await this.fetchBackendData();
      }
    } catch (_) {}
  }
}

// Inicializa a aplicação
document.addEventListener('DOMContentLoaded', () => {
  window.app = new CapaxeroDashboard();
});
