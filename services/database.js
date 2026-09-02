/**
 * Capaxero Cloud — Camada de Banco de Dados Relacional
 * Suporte a Usuários (Donos & CRPADMIN), Totens, Transações, Alertas, Depots e Filiais.
 * Persistência atômica em disco (data/capaxero_database.json / data/capaxero_db.json)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sanitizeCpf, isValidCpf, formatCpf, COUPON_CPF_ENABLED } = require('./cpf');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'capaxero_database.json');
const LEGACY_DB_FILE = path.join(DATA_DIR, 'capaxero_db.json');

// Função segura para hash de senhas usando scrypt
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

class RelationalDatabase {
  constructor() {
    this.tables = {
      users: [],
      totems: [],
      depots: [],
      branches: [],
      transactions: [],
      alerts: [],
      coupons: [],
      systemSettings: {
        defaultCieloMerchantId: "5e4fc2b8-11e3-4f9c-ab97-fb7baaea405b",
        defaultCieloMerchantKey: "FMnlYedXdu5Xoa5n3hczfHh8yAMbYF7logQQ4qPL"
      }
    };

    this.pendingOrders = new Map();
    this.ensureDataDir();
    this.initDatabase();
  }

  ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  initDatabase() {
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.tables = JSON.parse(raw);
        console.log(`[DATABASE] Banco de dados carregado de ${DB_FILE}`);
      } catch (err) {
        console.error('[DATABASE] Erro ao ler banco:', err);
      }
    } else if (fs.existsSync(LEGACY_DB_FILE)) {
      // Migra do formato legado
      try {
        const raw = fs.readFileSync(LEGACY_DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.tables.totems = parsed.totems || [];
        this.tables.depots = parsed.depots || [];
        this.tables.branches = parsed.branches || [];
        this.tables.transactions = parsed.transactions || [];
        this.tables.alerts = parsed.alerts || [];
        this.tables.coupons = parsed.coupons || [];
        this.tables.systemSettings = parsed.systemSettings || {
          defaultCieloMerchantId: "5e4fc2b8-11e3-4f9c-ab97-fb7baaea405b",
          defaultCieloMerchantKey: "FMnlYedXdu5Xoa5n3hczfHh8yAMbYF7logQQ4qPL"
        };
        console.log(`[DATABASE] Dados migrados do legado (${this.tables.totems.length} totens encontrados)`);
      } catch (err) {
        console.error('[DATABASE] Erro na migração legada:', err);
      }
    }

    this.ensureTables();
    this.seedDefaultUsers();
    this.seedDefaultCoupons();
    this.save();
  }

  ensureTables() {
    if (!Array.isArray(this.tables.users)) this.tables.users = [];
    if (!Array.isArray(this.tables.totems)) this.tables.totems = [];
    if (!Array.isArray(this.tables.depots)) this.tables.depots = [];
    if (!Array.isArray(this.tables.branches)) this.tables.branches = [];
    if (!Array.isArray(this.tables.transactions)) this.tables.transactions = [];
    if (!Array.isArray(this.tables.alerts)) this.tables.alerts = [];
    if (!Array.isArray(this.tables.coupons)) this.tables.coupons = [];

    // Migração: cupons criados antes do controle por CPF
    for (const cp of this.tables.coupons) {
      if (!Array.isArray(cp.redemptions)) cp.redemptions = [];
      if (cp.maxUsagesPerCpf === undefined) cp.maxUsagesPerCpf = 1;
      if (cp.requireCpf === undefined) cp.requireCpf = true;
    }

    if (!this.tables.systemSettings || typeof this.tables.systemSettings !== 'object') {
      this.tables.systemSettings = {
        defaultCieloMerchantId: "5e4fc2b8-11e3-4f9c-ab97-fb7baaea405b",
        defaultCieloMerchantKey: "FMnlYedXdu5Xoa5n3hczfHh8yAMbYF7logQQ4qPL"
      };
    }
  }

  seedDefaultCoupons() {
    const defaultCoupons = [
      {
        code: "GRATIS-CAPAXERO-100",
        description: "Gratuidade Total (100% OFF)",
        discountPercent: 100,
        applicableMode: null,
        isUsed: false,
        maxUsages: 1,
        maxUsagesPerCpf: 1,
        requireCpf: true,
        currentUsages: 0,
        redemptions: []
      },
      {
        code: "DESC20-GERAL",
        description: "Desconto 20% em Qualquer Modalidade",
        discountPercent: 20,
        applicableMode: null,
        isUsed: false,
        maxUsages: 1,
        maxUsagesPerCpf: 1,
        requireCpf: true,
        currentUsages: 0,
        redemptions: []
      },
      {
        code: "INTER50-CAPAXERO",
        description: "Desconto 50% na Higienização Intermediária",
        discountPercent: 50,
        applicableMode: "INTERMEDIARIA",
        isUsed: false,
        maxUsages: 1,
        maxUsagesPerCpf: 1,
        requireCpf: true,
        currentUsages: 0,
        redemptions: []
      }
    ];

    for (const cp of defaultCoupons) {
      if (!this.tables.coupons.find(c => c.code === cp.code)) {
        this.tables.coupons.push({ ...cp, createdAt: new Date().toISOString() });
      }
    }
  }

  seedDefaultUsers() {
    // Garante que o Super Admin CRPADMIN (Jonathan, senha 210602) exista
    let admin = this.tables.users.find(u => u.username.toUpperCase() === 'CRPADMIN' || u.role === 'CRPADMIN');
    if (!admin) {
      admin = {
        id: 'USR-CRPADMIN',
        username: 'CRPADMIN',
        email: 'jonathan@capaxero.com.br',
        password_hash: hashPassword('210602'),
        role: 'CRPADMIN',
        cnpj: '00.000.000/0001-00',
        responsible_name: 'Jonathan',
        phone: '(11) 99999-9999',
        company_name: 'Capaxero Tecnologia',
        created_at: new Date().toISOString()
      };
      this.tables.users.unshift(admin);
      console.log('[DATABASE] Super Admin CRPADMIN (Jonathan) provisionado com sucesso.');
    } else {
      // Atualiza senha se necessário para garantir acesso com 210602
      if (!verifyPassword('210602', admin.password_hash)) {
        admin.password_hash = hashPassword('210602');
      }
      admin.role = 'CRPADMIN';
      admin.responsible_name = admin.responsible_name || 'Jonathan';
      admin.username = 'CRPADMIN';
    }
  }

  save() {
    try {
      const payload = JSON.stringify(this.tables, null, 2);
      fs.writeFileSync(DB_FILE, payload, 'utf-8');
      // Mantém compatibilidade com o legado também
      fs.writeFileSync(LEGACY_DB_FILE, payload, 'utf-8');
    } catch (err) {
      console.error('[DATABASE] Erro ao salvar dados:', err);
    }
  }

  // ==========================================
  // USUÁRIOS & AUTENTICAÇÃO
  // ==========================================

  createUser(userData) {
    const { username, email, password, cnpj, responsible_name, phone, company_name, role, franchiseType } = userData;

    // Normalização
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanCnpj = (cnpj || '').trim().replace(/\D/g, '');

    // Validações
    if (!cleanEmail) throw new Error('E-mail é obrigatório.');
    if (!password || password.length < 4) throw new Error('Senha deve ter pelo menos 4 caracteres.');
    if (!responsible_name) throw new Error('Nome do responsável é obrigatório.');

    const existingEmail = this.tables.users.find(u => u.email.toLowerCase() === cleanEmail);
    if (existingEmail) throw new Error('Este e-mail já está cadastrado.');

    if (cleanCnpj) {
      const existingCnpj = this.tables.users.find(u => (u.cnpj || '').replace(/\D/g, '') === cleanCnpj);
      if (existingCnpj) throw new Error('Este CNPJ já está cadastrado.');
    }

    const newUser = {
      id: 'USR-' + Date.now().toString(36).toUpperCase(),
      username: username ? username.trim() : (cleanEmail.split('@')[0] || 'dono'),
      email: cleanEmail,
      password_hash: hashPassword(password),
      role: role === 'CRPADMIN' ? 'CRPADMIN' : 'OWNER',
      cnpj: cnpj || '',
      responsible_name: responsible_name.trim(),
      phone: phone || '',
      company_name: company_name || responsible_name.trim(),
      franchiseType: franchiseType === 'PROPRIA' ? 'PROPRIA' : 'FRANQUEADO',
      created_at: new Date().toISOString()
    };

    this.tables.users.push(newUser);
    this.save();

    const { password_hash, ...safeUser } = newUser;
    return safeUser;
  }

  authenticateUser(loginIdentifier, password) {
    if (!loginIdentifier || !password) return null;
    const identifierLower = loginIdentifier.trim().toLowerCase();
    const cleanIdDigits = loginIdentifier.replace(/\D/g, '');

    const user = this.tables.users.find(u =>
      u.username.toLowerCase() === identifierLower ||
      u.email.toLowerCase() === identifierLower ||
      (cleanIdDigits && (u.cnpj || '').replace(/\D/g, '') === cleanIdDigits)
    );

    if (!user) return null;
    if (!verifyPassword(password, user.password_hash)) return null;

    const { password_hash, ...safeUser } = user;
    return safeUser;
  }

  getUserById(id) {
    const u = this.tables.users.find(user => user.id === id);
    if (!u) return null;
    const { password_hash, ...safeUser } = u;
    return safeUser;
  }

  updateUserProfile(userId, updates = {}) {
    const user = this.tables.users.find(u => u.id === userId);
    if (!user) {
      throw new Error('Usuário não encontrado.');
    }

    if (updates.email && updates.email !== user.email) {
      const emailExists = this.tables.users.some(u => u.id !== userId && u.email.toLowerCase() === updates.email.toLowerCase());
      if (emailExists) {
        throw new Error('Já existe outro usuário cadastrado com este e-mail.');
      }
      user.email = updates.email.trim();
    }

    if (updates.phone !== undefined) {
      user.phone = updates.phone.trim();
    }

    if (updates.responsible_name) {
      const oldName = user.responsible_name;
      user.responsible_name = updates.responsible_name.trim();

      // Atualiza o nome de dono nas máquinas associadas se aplicável
      this.tables.totems.forEach(t => {
        if (t.owner_id === user.id || t.owner === oldName) {
          t.owner = user.responsible_name;
        }
      });
    }

    if (updates.company_name !== undefined) {
      user.company_name = updates.company_name.trim();
    }

    if (updates.cnpj !== undefined) {
      const cleanCnpj = updates.cnpj.replace(/\D/g, '');
      if (cleanCnpj) {
        const cnpjExists = this.tables.users.some(u => u.id !== userId && (u.cnpj || '').replace(/\D/g, '') === cleanCnpj);
        if (cnpjExists) {
          throw new Error('Já existe outro usuário cadastrado com este CNPJ.');
        }
      }
      user.cnpj = updates.cnpj.trim();
    }

    if (updates.franchiseType !== undefined) {
      user.franchiseType = updates.franchiseType === 'PROPRIA' ? 'PROPRIA' : 'FRANQUEADO';
    }

    if (updates.password && updates.password.trim().length > 0) {
      user.password_hash = hashPassword(updates.password.trim());
    }

    user.updated_at = new Date().toISOString();
    this.save();

    const { password_hash, ...safeUser } = user;
    return safeUser;
  }

  getUsersList() {
    return this.tables.users.map(u => {
      const assignedTotems = this.tables.totems.filter(t => t.owner_id === u.id || t.owner === u.responsible_name || t.owner === u.username);
      const { password_hash, ...safeUser } = u;
      return {
        ...safeUser,
        totemsCount: assignedTotems.length,
        totems: assignedTotems.map(t => ({ devno: t.devno, name: t.name, status: t.status }))
      };
    });
  }

  deleteUser(userId) {
    const user = this.tables.users.find(u => u.id === userId);
    if (!user) return false;
    if (user.role === 'CRPADMIN' || user.username.toUpperCase() === 'CRPADMIN') {
      throw new Error('O usuário Super Admin CRPADMIN não pode ser excluído.');
    }
    this.tables.users = this.tables.users.filter(u => u.id !== userId);
    // Remove vínculo dos totens que pertenciam a esse dono
    this.tables.totems.forEach(t => {
      if (t.owner_id === userId) {
        t.owner_id = 'USR-CRPADMIN';
        t.owner = 'Jonathan';
      }
    });
    this.save();
    return true;
  }

  // ==========================================
  // TOTENS & GESTÃO DE MÁQUINAS
  // ==========================================

  setTotemOwner(devno, ownerOrId) {
    return this.transferTotemOwner(devno, ownerOrId);
  }

  transferTotemOwner(devno, targetUserOrId) {
    const totem = this.tables.totems.find(t => t.devno === devno);
    if (!totem) throw new Error(`Totem ${devno} não encontrado.`);

    // Tenta encontrar usuário correspondente por id, username, responsible_name ou company_name
    const targetUser = this.tables.users.find(u =>
      u.id === targetUserOrId ||
      u.username.toLowerCase() === String(targetUserOrId).toLowerCase() ||
      (u.responsible_name && u.responsible_name.toLowerCase() === String(targetUserOrId).toLowerCase()) ||
      (u.company_name && u.company_name.toLowerCase() === String(targetUserOrId).toLowerCase())
    );

    if (targetUser) {
      totem.owner_id = targetUser.id;
      totem.owner = targetUser.responsible_name || targetUser.company_name || targetUser.username;
    } else {
      totem.owner = String(targetUserOrId);
      totem.owner_id = 'USR-CUSTOM';
    }

    this.save();
    console.log(`[DATABASE] 🔄 Máquina ${devno} reatribuída com sucesso para: ${totem.owner} (${totem.owner_id})`);
    return totem;
  }

  deleteTotem(devno) {
    if (!devno) return false;
    const initialLen = this.tables.totems.length;
    this.tables.totems = this.tables.totems.filter(t => t.devno !== devno);
    // Desvincula dos depots
    this.tables.depots.forEach(d => {
      if (d.devno === devno) d.devno = '';
    });
    this.save();
    return this.tables.totems.length < initialLen;
  }

  getTotemsList(userFilter = null) {
    let totems = this.tables.totems;

    if (userFilter && userFilter.role !== 'CRPADMIN') {
      // Donos normais só veem suas próprias máquinas
      totems = totems.filter(t =>
        t.owner_id === userFilter.id ||
        (t.owner && (t.owner === userFilter.responsible_name || t.owner === userFilter.username))
      );
    }

    // Mascara credenciais Cielo para quem não for CRPADMIN
    return totems.map(t => {
      const isOwner = userFilter && userFilter.role === 'CRPADMIN';
      const config = { ...(t.config || {}) };
      if (!isOwner) {
        delete config.cieloMerchantKey;
        delete config.cielo;
        if (config.cieloMerchantId) {
          config.cieloMerchantId = config.cieloMerchantId.slice(0, 4) + '****-****-' + config.cieloMerchantId.slice(-4);
        }
      }
      const { revenueToday, cyclesToday } = this.getTodayMetrics(t.devno);
      return { ...t, config, revenueToday, totalCyclesToday: cyclesToday };
    });
  }

  getTotem(devno) {
    return this.tables.totems.find(t => t.devno === devno);
  }

  // Faturamento e ciclos realmente de HOJE, calculados a partir do histórico de transações
  // (t.revenueToday/t.totalCyclesToday no registro do totem são contadores que só somam e nunca
  // zeram — não servem para exibir "hoje", só para o total histórico da máquina).
  getTodayMetrics(devno) {
    const todayIso = new Date().toISOString().slice(0, 10);
    const todayTxs = this.tables.transactions.filter(t =>
      t.devno === devno && t.status === 'APPROVED' && t.timestamp && t.timestamp.slice(0, 10) === todayIso
    );
    return {
      revenueToday: todayTxs.reduce((acc, t) => acc + Number(t.amount || 0), 0),
      cyclesToday: todayTxs.length
    };
  }

  upsertTotem(data) {
    const devno = data.devno || data.totemId;
    if (!devno) return null;

    let index = this.tables.totems.findIndex(t => t.devno === devno);
    const existing = index !== -1 ? this.tables.totems[index] : null;

    const doorLocked = data.doorLocked !== undefined ? data.doorLocked : (data.isDoorClosed !== undefined ? data.isDoorClosed : true);
    let liquidLevel = data.liquidLevelPercent;
    if (liquidLevel === undefined && data.isLiquidLevelOk !== undefined) {
      liquidLevel = data.isLiquidLevelOk ? 100 : 10;
    }

    const base = existing || {
      devno: devno,
      name: data.name || data.machineName || `Totem #${devno}`,
      location: data.location || "Ponto a Cadastrar",
      depotno: data.depotno || "DEP-01",
      branno: data.branno || "BR-01",
      owner_id: data.owner_id || "USR-CRPADMIN",
      owner: data.owner || "Jonathan",
      boxCount: 1,
      status: "IDLE",
      totalCyclesToday: 0,
      revenueToday: 0,
      liquidLevelPercent: 100,
      doorLocked: true,
      config: {
        basicPrice: 14.0,
        intermediatePrice: 17.0,
        advancedPrice: 20.0,
        basicDurationSec: 360,
        intermediateDurationSec: 420,
        advancedDurationSec: 480,
        isPixEnabled: true,
        isCreditEnabled: true,
        isDebitEnabled: true,
        isCouponsEnabled: true,
        modes: {
          basica: { isEnabled: true, priceInCents: 1400, uvSeconds: 60, mistSpraySeconds: 15, mistSaturationSeconds: 45, thermalDryingSeconds: 120, ozoneExhaustSeconds: 115, fragranceSeconds: 5 },
          intermediaria: { isEnabled: true, priceInCents: 1700, uvSeconds: 75, mistSpraySeconds: 20, mistSaturationSeconds: 45, thermalDryingSeconds: 150, ozoneExhaustSeconds: 125, fragranceSeconds: 5 },
          avancada: { isEnabled: true, priceInCents: 2000, uvSeconds: 90, mistSpraySeconds: 25, mistSaturationSeconds: 45, thermalDryingSeconds: 180, ozoneExhaustSeconds: 135, fragranceSeconds: 5 }
        },
        cieloMerchantId: "",
        cieloMerchantKey: ""
      }
    };

    const updated = {
      ...base,
      ...data,
      devno: devno,
      name: data.name || data.machineName || base.name,
      owner_id: data.owner_id || base.owner_id || "USR-CRPADMIN",
      owner: data.owner || base.owner || "Jonathan",
      doorLocked: doorLocked,
      liquidLevelPercent: liquidLevel !== undefined ? liquidLevel : base.liquidLevelPercent,
      status: data.status || (data.machineState ? (data.machineState.includes('CLEAN') ? 'CLEANING' : (data.machineState === 'MAINTENANCE' ? 'MAINTENANCE' : 'IDLE')) : base.status),
      config: base.config, // Preserva integralmente as configurações salvas em banco
      lastHeartbeat: new Date().toISOString()
    };

    if (index !== -1) {
      this.tables.totems[index] = updated;
    } else {
      this.tables.totems.push(updated);
      console.log(`[DATABASE] ✨ Novo Totem registrado com sucesso: ${devno} (${updated.name})`);
    }

    this.save();
    return updated;
  }

  updateTotemConfig(devno, newConfig, userRole = 'CRPADMIN') {
    let totem = this.getTotem(devno);
    if (!totem) {
      totem = this.upsertTotem({ devno });
    }

    // Se NÃO for CRPADMIN, impede alteração de credenciais Cielo (Ecommerce, Conecta, Pinpad)
    const safeConfig = { ...newConfig };
    if (userRole !== 'CRPADMIN') {
      delete safeConfig.cieloMerchantId;
      delete safeConfig.cieloMerchantKey;
      delete safeConfig.cielo;
    }

    // Merge profundo de config
    const oldConfig = totem.config || {};
    const oldModes = oldConfig.modes || {};
    const oldPayment = oldConfig.paymentMethods || {};

    const incomingModes = safeConfig.modes || {};
    const incomingPayment = safeConfig.paymentMethods || {};

    const mergedModes = {
      basica: {
        isEnabled: incomingModes.basica?.isEnabled !== undefined ? Boolean(incomingModes.basica.isEnabled) : (safeConfig.basicEnabled !== undefined ? Boolean(safeConfig.basicEnabled) : (oldModes.basica?.isEnabled !== false)),
        priceInCents: incomingModes.basica?.priceInCents !== undefined ? Number(incomingModes.basica.priceInCents) : (safeConfig.basicPrice !== undefined ? Math.round(Number(safeConfig.basicPrice) * 100) : (oldModes.basica?.priceInCents || 1400)),
        uvSeconds: incomingModes.basica?.uvSeconds !== undefined ? Number(incomingModes.basica.uvSeconds) : (safeConfig.basicUvTime !== undefined ? Number(safeConfig.basicUvTime) : (oldModes.basica?.uvSeconds || 60)),
        mistSpraySeconds: incomingModes.basica?.mistSpraySeconds !== undefined ? Number(incomingModes.basica.mistSpraySeconds) : (safeConfig.basicSmokeControlTime !== undefined ? Number(safeConfig.basicSmokeControlTime) : (oldModes.basica?.mistSpraySeconds || 15)),
        mistSaturationSeconds: incomingModes.basica?.mistSaturationSeconds !== undefined ? Number(incomingModes.basica.mistSaturationSeconds) : (oldModes.basica?.mistSaturationSeconds || 45),
        thermalDryingSeconds: incomingModes.basica?.thermalDryingSeconds !== undefined ? Number(incomingModes.basica.thermalDryingSeconds) : (safeConfig.basicDryingTime !== undefined ? Number(safeConfig.basicDryingTime) : (oldModes.basica?.thermalDryingSeconds || 120)),
        ozoneExhaustSeconds: incomingModes.basica?.ozoneExhaustSeconds !== undefined ? Number(incomingModes.basica.ozoneExhaustSeconds) : (safeConfig.basicExhaustTime !== undefined ? Number(safeConfig.basicExhaustTime) : (oldModes.basica?.ozoneExhaustSeconds || 115)),
        fragranceSeconds: incomingModes.basica?.fragranceSeconds !== undefined ? Number(incomingModes.basica.fragranceSeconds) : (oldModes.basica?.fragranceSeconds || 5)
      },
      intermediaria: {
        isEnabled: incomingModes.intermediaria?.isEnabled !== undefined ? Boolean(incomingModes.intermediaria.isEnabled) : (safeConfig.interEnabled !== undefined ? Boolean(safeConfig.interEnabled) : (oldModes.intermediaria?.isEnabled !== false)),
        priceInCents: incomingModes.intermediaria?.priceInCents !== undefined ? Number(incomingModes.intermediaria.priceInCents) : (safeConfig.intermediatePrice !== undefined ? Math.round(Number(safeConfig.intermediatePrice) * 100) : (oldModes.intermediaria?.priceInCents || 1700)),
        uvSeconds: incomingModes.intermediaria?.uvSeconds !== undefined ? Number(incomingModes.intermediaria.uvSeconds) : (safeConfig.interUvTime !== undefined ? Number(safeConfig.interUvTime) : (oldModes.intermediaria?.uvSeconds || 75)),
        mistSpraySeconds: incomingModes.intermediaria?.mistSpraySeconds !== undefined ? Number(incomingModes.intermediaria.mistSpraySeconds) : (safeConfig.interSmokeControlTime !== undefined ? Number(safeConfig.interSmokeControlTime) : (oldModes.intermediaria?.mistSpraySeconds || 20)),
        mistSaturationSeconds: incomingModes.intermediaria?.mistSaturationSeconds !== undefined ? Number(incomingModes.intermediaria.mistSaturationSeconds) : (oldModes.intermediaria?.mistSaturationSeconds || 45),
        thermalDryingSeconds: incomingModes.intermediaria?.thermalDryingSeconds !== undefined ? Number(incomingModes.intermediaria.thermalDryingSeconds) : (safeConfig.interDryingTime !== undefined ? Number(safeConfig.interDryingTime) : (oldModes.intermediaria?.thermalDryingSeconds || 150)),
        ozoneExhaustSeconds: incomingModes.intermediaria?.ozoneExhaustSeconds !== undefined ? Number(incomingModes.intermediaria.ozoneExhaustSeconds) : (safeConfig.interExhaustTime !== undefined ? Number(safeConfig.interExhaustTime) : (oldModes.intermediaria?.ozoneExhaustSeconds || 125)),
        fragranceSeconds: incomingModes.intermediaria?.fragranceSeconds !== undefined ? Number(incomingModes.intermediaria.fragranceSeconds) : (oldModes.intermediaria?.fragranceSeconds || 5)
      },
      avancada: {
        isEnabled: incomingModes.avancada?.isEnabled !== undefined ? Boolean(incomingModes.avancada.isEnabled) : (safeConfig.advEnabled !== undefined ? Boolean(safeConfig.advEnabled) : (oldModes.avancada?.isEnabled !== false)),
        priceInCents: incomingModes.avancada?.priceInCents !== undefined ? Number(incomingModes.avancada.priceInCents) : (safeConfig.advancedPrice !== undefined ? Math.round(Number(safeConfig.advancedPrice) * 100) : (oldModes.avancada?.priceInCents || 2000)),
        uvSeconds: incomingModes.avancada?.uvSeconds !== undefined ? Number(incomingModes.avancada.uvSeconds) : (safeConfig.advUvTime !== undefined ? Number(safeConfig.advUvTime) : (oldModes.avancada?.uvSeconds || 90)),
        mistSpraySeconds: incomingModes.avancada?.mistSpraySeconds !== undefined ? Number(incomingModes.avancada.mistSpraySeconds) : (safeConfig.advSmokeControlTime !== undefined ? Number(safeConfig.advSmokeControlTime) : (oldModes.avancada?.mistSpraySeconds || 25)),
        mistSaturationSeconds: incomingModes.avancada?.mistSaturationSeconds !== undefined ? Number(incomingModes.avancada.mistSaturationSeconds) : (oldModes.avancada?.mistSaturationSeconds || 45),
        thermalDryingSeconds: incomingModes.avancada?.thermalDryingSeconds !== undefined ? Number(incomingModes.avancada.thermalDryingSeconds) : (safeConfig.advDryingTime !== undefined ? Number(safeConfig.advDryingTime) : (oldModes.avancada?.thermalDryingSeconds || 180)),
        ozoneExhaustSeconds: incomingModes.avancada?.ozoneExhaustSeconds !== undefined ? Number(incomingModes.avancada.ozoneExhaustSeconds) : (safeConfig.advExhaustTime !== undefined ? Number(safeConfig.advExhaustTime) : (oldModes.avancada?.ozoneExhaustSeconds || 135)),
        fragranceSeconds: incomingModes.avancada?.fragranceSeconds !== undefined ? Number(incomingModes.avancada.fragranceSeconds) : (oldModes.avancada?.fragranceSeconds || 5)
      }
    };

    const mergedPayment = {
      isPixEnabled: incomingPayment.isPixEnabled !== undefined ? Boolean(incomingPayment.isPixEnabled) : (safeConfig.isPixEnabled !== undefined ? Boolean(safeConfig.isPixEnabled) : (oldPayment.isPixEnabled !== false)),
      isCreditEnabled: incomingPayment.isCreditEnabled !== undefined ? Boolean(incomingPayment.isCreditEnabled) : (safeConfig.isCreditEnabled !== undefined ? Boolean(safeConfig.isCreditEnabled) : Boolean(oldPayment.isCreditEnabled)),
      isDebitEnabled: incomingPayment.isDebitEnabled !== undefined ? Boolean(incomingPayment.isDebitEnabled) : (safeConfig.isDebitEnabled !== undefined ? Boolean(safeConfig.isDebitEnabled) : Boolean(oldPayment.isDebitEnabled)),
      isCouponsEnabled: incomingPayment.isCouponsEnabled !== undefined ? Boolean(incomingPayment.isCouponsEnabled) : (safeConfig.isCouponsEnabled !== undefined ? Boolean(safeConfig.isCouponsEnabled) : (oldPayment.isCouponsEnabled !== false))
    };

    // Merge profundo das credenciais Cielo (Pinpad/Conecta/Ecommerce) — parametrização remota por máquina
    const mergedCielo = safeConfig.cielo
      ? { ...(oldConfig.cielo || {}), ...safeConfig.cielo, devno, updatedAt: new Date().toISOString() }
      : oldConfig.cielo;

    totem.config = {
      ...oldConfig,
      ...safeConfig,
      basicPrice: mergedModes.basica.priceInCents / 100,
      intermediatePrice: mergedModes.intermediaria.priceInCents / 100,
      advancedPrice: mergedModes.avancada.priceInCents / 100,
      basicEnabled: mergedModes.basica.isEnabled,
      interEnabled: mergedModes.intermediaria.isEnabled,
      advEnabled: mergedModes.avancada.isEnabled,
      isPixEnabled: mergedPayment.isPixEnabled,
      isCreditEnabled: mergedPayment.isCreditEnabled,
      isDebitEnabled: mergedPayment.isDebitEnabled,
      isCouponsEnabled: mergedPayment.isCouponsEnabled,
      modes: mergedModes,
      paymentMethods: mergedPayment,
      cielo: mergedCielo
    };

    this.save();
    return totem;
  }

  transferTotemOwner(devno, targetUserId) {
    const totem = this.getTotem(devno);
    if (!totem) throw new Error(`Totem ${devno} não encontrado.`);

    const user = this.getUserById(targetUserId);
    if (!user) throw new Error(`Usuário ${targetUserId} não encontrado.`);

    totem.owner_id = user.id;
    totem.owner = user.responsible_name || user.username;
    this.save();

    console.log(`[DATABASE] Totem ${devno} transferido com sucesso para ${user.responsible_name} (${user.id})`);
    return totem;
  }

  relocateTotem(devno, newDepotno) {
    const oldDepot = this.tables.depots.find(d => d.devno === devno);
    if (oldDepot) oldDepot.devno = "";

    const newDepot = this.tables.depots.find(d => d.depotno === newDepotno);
    if (!newDepot) return null;
    newDepot.devno = devno;

    const totem = this.getTotem(devno) || this.upsertTotem({ devno });
    totem.depotno = newDepot.depotno;
    totem.branno = newDepot.branno;
    totem.location = newDepot.address || newDepot.depotna;

    this.save();
    return { totem, depot: newDepot };
  }

  // ==========================================
  // DEPOTS & FILIAIS
  // ==========================================

  getDepotsList(userFilter = null) {
    let depots = this.tables.depots;
    return depots.map(d => {
      const totem = this.getTotem(d.devno);
      const { revenueToday, cyclesToday } = totem ? this.getTodayMetrics(totem.devno) : { revenueToday: 0, cyclesToday: 0 };
      return {
        ...d,
        totemStatus: totem ? totem.status : 'OFFLINE',
        revenueToday,
        cyclesToday,
        totemOwner: totem ? (totem.owner || totem.owner_id) : ''
      };
    });
  }

  addDepot(depotData) {
    const depot = {
      depotno: depotData.depotno || `DEP-${this.tables.depots.length + 1}`,
      depotna: depotData.depotna || "Ponto de Instalação",
      branno: depotData.branno || "BR-01",
      address: depotData.address || "",
      contactPerson: depotData.contactPerson || "",
      phone: depotData.phone || "",
      devno: depotData.devno || "",
      dailyTrafficMotos: Number(depotData.dailyTrafficMotos || 0),
      commissionPercent: Number(depotData.commissionPercent || 0),
      createdAt: new Date().toISOString(),
      ...depotData
    };
    this.tables.depots.push(depot);
    this.save();
    return depot;
  }

  deleteDepot(depotno) {
    if (!depotno) return false;
    const initialLen = this.tables.depots.length;
    this.tables.depots = this.tables.depots.filter(d => d.depotno !== depotno);
    this.save();
    return this.tables.depots.length < initialLen;
  }

  getBranchesList() {
    return this.tables.branches;
  }

  addBranch(branchData) {
    const branch = {
      branno: branchData.branno || `BR-${this.tables.branches.length + 1}`,
      branna: branchData.branna || "Filial Regional",
      cocode: branchData.cocode || "CAPAXERO",
      compno: branchData.compno || "87550094",
      manager: branchData.manager || "",
      phone: branchData.phone || "",
      active: true,
      createdAt: new Date().toISOString(),
      ...branchData
    };
    this.tables.branches.push(branch);
    this.save();
    return branch;
  }

  getOwnersList() {
    return this.tables.users.map(u => ({
      id: u.id,
      name: u.responsible_name || u.username,
      company: u.company_name,
      cnpj: u.cnpj,
      email: u.email,
      role: u.role
    }));
  }

  setTotemOwner(devno, ownerName) {
    const totem = this.getTotem(devno) || this.upsertTotem({ devno });
    totem.owner = ownerName;
    const matchedUser = this.tables.users.find(u => u.responsible_name === ownerName || u.username === ownerName);
    if (matchedUser) {
      totem.owner_id = matchedUser.id;
    }
    this.save();
    return totem;
  }

  // ==========================================
  // TRANSAÇÕES & TELEMETRIA
  // ==========================================

  addTransaction(tx) {
    const newTx = {
      id: "TX-" + Date.now().toString().slice(-6),
      timestamp: new Date().toISOString(),
      status: "APPROVED",
      ...tx
    };

    this.tables.transactions.unshift(newTx);
    if (this.tables.transactions.length > 1000) {
      this.tables.transactions.pop();
    }

    let totem = this.getTotem(tx.devno);
    if (!totem && tx.devno) {
      totem = this.upsertTotem({ devno: tx.devno, name: tx.totemName });
    }

    if (totem && newTx.status === "APPROVED") {
      totem.totalCyclesToday = (totem.totalCyclesToday || 0) + 1;
      totem.revenueToday = (totem.revenueToday || 0) + Number(newTx.amount || 0);
    }

    this.save();
    return newTx;
  }

  getTransactions(limit = 50, userFilter = null) {
    let txs = this.tables.transactions;
    if (userFilter && userFilter.role !== 'CRPADMIN') {
      const ownedDevnos = new Set(this.getTotemsList(userFilter).map(t => t.devno));
      txs = txs.filter(t => ownedDevnos.has(t.devno));
    }
    return txs.slice(0, limit);
  }

  updateHeartbeat(devno, telemetry) {
    let totem = this.getTotem(devno);
    if (!totem) {
      totem = this.upsertTotem({ devno, ...telemetry });
    }

    // Sem sensor real de temperatura ou nível de fragrância na máquina (ver Upus3Packet do APK,
    // que só define canais para porta e nível de líquido) — esses dois campos não são aceitos
    // aqui de propósito, para não persistir números fabricados como se fossem telemetria real.
    totem.status = telemetry.status || totem.status;
    if (telemetry.doorLocked !== undefined) totem.doorLocked = telemetry.doorLocked;
    if (telemetry.liquidLevelPercent !== undefined) totem.liquidLevelPercent = telemetry.liquidLevelPercent;
    if (telemetry.currentCycle !== undefined) totem.currentCycle = telemetry.currentCycle;
    delete totem.temperature;
    delete totem.fragranceLevelPercent;
    totem.lastHeartbeat = new Date().toISOString();

    this.save();
    return totem;
  }

  // Marca como OFFLINE qualquer totem sem heartbeat há mais de `timeoutMs`
  // (o APK manda heartbeat a cada 60s — ver 03_web_backend_totem_integration_guide.md).
  // Sem isso, uma máquina desligada da tomada fica "Disponível" no painel para sempre,
  // pois o último status recebido (ex: IDLE) nunca é substituído.
  markStaleTotemsOffline(timeoutMs = 3 * 60 * 1000) {
    const now = Date.now();
    const changed = [];
    for (const totem of this.tables.totems) {
      if (totem.status === 'OFFLINE') continue;
      const last = totem.lastHeartbeat ? new Date(totem.lastHeartbeat).getTime() : 0;
      if (!last || now - last > timeoutMs) {
        totem.status = 'OFFLINE';
        changed.push(totem.devno);
      }
    }
    if (changed.length) this.save();
    return changed;
  }

  markTotemOffline(devno) {
    const totem = this.getTotem(devno);
    if (!totem || totem.status === 'OFFLINE') return null;
    totem.status = 'OFFLINE';
    this.save();
    return totem;
  }

  recordCycleComplete(devno, cycleData) {
    let totem = this.getTotem(devno);
    if (!totem) {
      totem = this.upsertTotem({ devno });
    }

    totem.status = "IDLE";
    totem.currentCycle = null;
    totem.liquidLevelPercent = Math.max(0, (totem.liquidLevelPercent || 100) - 2);

    if (totem.liquidLevelPercent <= 20) {
      this.addAlert({
        devno,
        totemName: totem.name,
        type: "LOW_LIQUID",
        severity: totem.liquidLevelPercent <= 10 ? "CRITICAL" : "WARNING",
        message: `Nível de sanitizante baixo (${totem.liquidLevelPercent}%). Reabastecimento necessário.`
      });
    }

    this.save();
    return totem;
  }

  // ==========================================
  // ALERTAS
  // ==========================================

  addAlert(alertData) {
    const alert = {
      id: "ALT-" + Date.now().toString().slice(-5),
      timestamp: new Date().toISOString(),
      resolved: false,
      ...alertData
    };

    this.tables.alerts.unshift(alert);
    this.save();
    return alert;
  }

  // Abre uma Ordem de Manutenção: coloca a máquina em manutenção e registra o alerta
  // correspondente (mesmo save() persiste os dois, pois ambos vivem em this.tables).
  openMaintenanceOrder(devno, data = {}) {
    const totem = this.getTotem(devno);
    if (!totem) return null;

    totem.status = 'MAINTENANCE';

    const priority = data.priority || 'Média';
    const alert = this.addAlert({
      devno,
      totemName: totem.name,
      type: 'MAINTENANCE',
      severity: priority,
      priority,
      issueType: data.issueType || 'Outro',
      assignee: data.assignee || '',
      message: data.description || `Ordem de manutenção aberta para ${totem.name}`
    });

    return { totem, alert };
  }

  addMaintenanceComment(alertId, data = {}) {
    const alert = this.tables.alerts.find(a => a.id === alertId);
    if (!alert) return null;

    const text = (data.text || '').trim();
    if (!text) return null;

    if (!Array.isArray(alert.comments)) alert.comments = [];
    alert.comments.push({
      id: "CMT-" + Date.now().toString().slice(-6) + Math.random().toString(36).slice(2, 5),
      text,
      author: data.author || 'Admin',
      timestamp: new Date().toISOString()
    });

    this.save();
    return alert;
  }

  getAlerts(activeOnly = false, userFilter = null) {
    let alerts = this.tables.alerts;
    if (userFilter && userFilter.role !== 'CRPADMIN') {
      const ownedDevnos = new Set(this.getTotemsList(userFilter).map(t => t.devno));
      alerts = alerts.filter(a => ownedDevnos.has(a.devno));
    }
    if (activeOnly) {
      return alerts.filter(a => !a.resolved);
    }
    return alerts;
  }

  resolveAlert(alertId) {
    const alert = this.tables.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = new Date().toISOString();

      // Resolver uma Ordem de Manutenção devolve a máquina para operação
      // (só se ela ainda estiver em manutenção — não sobrescreve ERROR/OFFLINE supervenientes).
      if (alert.type === 'MAINTENANCE' && alert.devno) {
        const totem = this.getTotem(alert.devno);
        if (totem && totem.status === 'MAINTENANCE') {
          totem.status = 'IDLE';
        }
      }

      this.save();
    }
    return alert;
  }

  // ==========================================
  // ESTATÍSTICAS & RELATÓRIOS (COM RBAC)
  // ==========================================

  getStats(userFilter = null) {
    const totemsList = this.getTotemsList(userFilter);
    const totalTotems = totemsList.length;
    const onlineTotems = totemsList.filter(t => t.status !== "OFFLINE").length;
    const cleaningTotems = totemsList.filter(t => t.status === "CLEANING").length;
    const alertTotems = totemsList.filter(t => t.status === "ERROR" || (t.liquidLevelPercent <= 20)).length;

    const todayIso = new Date().toISOString().slice(0, 10);
    const ownedDevnos = new Set(totemsList.map(t => t.devno));

    const todayTxs = this.tables.transactions.filter(t =>
      t.timestamp && t.timestamp.slice(0, 10) === todayIso && t.status === 'APPROVED' &&
      (userFilter && userFilter.role !== 'CRPADMIN' ? ownedDevnos.has(t.devno) : true)
    );

    const totalRevenueToday = todayTxs.reduce((acc, t) => acc + Number(t.amount || 0), 0);
    const totalCyclesToday = todayTxs.length;

    const activeAlertsCount = this.getAlerts(true, userFilter).length;

    const modeCounts = { BASICA: 0, INTERMEDIARIA: 0, AVANCADA: 0 };
    todayTxs.forEach(t => {
      if (t.mode && modeCounts[t.mode] !== undefined) {
        modeCounts[t.mode]++;
      }
    });

    return {
      totalRevenueToday,
      totalCyclesToday,
      totalTotems,
      onlineTotems,
      cleaningTotems,
      alertTotems,
      activeAlertsCount,
      modeCounts
    };
  }

  getIncomeReport(userFilter = null) {
    const totemsList = this.getTotemsList(userFilter);
    const depotsList = this.getDepotsList(userFilter);
    const ownedDevnos = new Set(totemsList.map(t => t.devno));

    const depotStats = depotsList
      .filter(dep => userFilter && userFilter.role !== 'CRPADMIN' ? ownedDevnos.has(dep.devno) : true)
      .map(dep => {
        const totem = this.getTotem(dep.devno);
        const { revenueToday: revenue, cyclesToday: cycles } = totem ? this.getTodayMetrics(totem.devno) : { revenueToday: 0, cyclesToday: 0 };
        const commission = (revenue * dep.commissionPercent) / 100;
        const netRevenue = revenue - commission;

        return {
          depotno: dep.depotno,
          depotna: dep.depotna,
          devno: dep.devno,
          cycles,
          revenue,
          commissionPercent: dep.commissionPercent,
          commissionAmount: commission,
          netRevenue
        };
      });

    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const now = new Date();
    const historicalRevenue = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dayName = i === 0 ? 'Hoje' : days[d.getDay()];
      const dayIso = d.toISOString().slice(0, 10);

      const dayTxs = this.tables.transactions.filter(t => {
        return t.timestamp && t.timestamp.slice(0, 10) === dayIso && t.status === 'APPROVED' &&
          (userFilter && userFilter.role !== 'CRPADMIN' ? ownedDevnos.has(t.devno) : true);
      });

      const dayRevenue = dayTxs.reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const dayCycles = dayTxs.length;

      historicalRevenue.push({
        day: dayName,
        date: dayIso,
        cycles: dayCycles,
        revenue: dayRevenue
      });
    }

    return {
      depotStats,
      historicalRevenue,
      weekTotalRevenue: historicalRevenue.reduce((acc, d) => acc + d.revenue, 0),
      weekTotalCycles: historicalRevenue.reduce((acc, d) => acc + d.cycles, 0)
    };
  }

  // Gerenciamento de Pedidos Pendentes (Em Memória)
  createPendingOrder(order) {
    this.pendingOrders.set(order.orderId, {
      ...order,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    return this.pendingOrders.get(order.orderId);
  }

  getPendingOrder(orderId) {
    if (this.pendingOrders.has(orderId)) {
      return this.pendingOrders.get(orderId);
    }
    const tx = this.tables.transactions.find(t => t.orderId === orderId);
    if (tx) {
      return {
        orderId: tx.orderId,
        devno: tx.devno,
        mode: tx.mode,
        amount: tx.amount,
        paymentMethod: tx.paymentMethod,
        status: tx.status,
        nsu: tx.nsu,
        authCode: tx.authCode,
        updatedAt: tx.timestamp
      };
    }
    return null;
  }

  updatePendingOrder(orderId, updates) {
    const order = this.pendingOrders.get(orderId) || { orderId };
    const updated = { ...order, ...updates, updatedAt: new Date().toISOString() };
    this.pendingOrders.set(orderId, updated);
    return updated;
  }

  // ==========================================
  // CONFIGURAÇÕES DO SISTEMA (CIELO PADRÃO)
  // ==========================================
  getSystemSettings() {
    return this.tables.systemSettings || {
      defaultCieloMerchantId: "5e4fc2b8-11e3-4f9c-ab97-fb7baaea405b",
      defaultCieloMerchantKey: "FMnlYedXdu5Xoa5n3hczfHh8yAMbYF7logQQ4qPL"
    };
  }

  updateSystemSettings(updates) {
    this.tables.systemSettings = {
      ...this.getSystemSettings(),
      ...updates,
      updatedAt: new Date().toISOString()
    };
    this.save();
    return this.tables.systemSettings;
  }

  // ==========================================
  // CUPONS & VOUCHERS QR CODE
  // ==========================================
  getCouponsList() {
    return (this.tables.coupons || []).map(c => ({
      ...c,
      redemptions: Array.isArray(c.redemptions) ? c.redemptions : [],
      maxUsagesPerCpf: Number(c.maxUsagesPerCpf) > 0 ? Number(c.maxUsagesPerCpf) : 1,
      requireCpf: c.requireCpf !== false
    }));
  }

  getCoupon(code) {
    if (!code) return null;
    const clean = code.trim().toUpperCase();
    const coupon = (this.tables.coupons || []).find(c => c.code.toUpperCase() === clean);
    if (!coupon) return null;

    // Compatibilidade com cupons criados antes do controle por CPF
    if (!Array.isArray(coupon.redemptions)) coupon.redemptions = [];
    if (coupon.maxUsagesPerCpf === undefined) coupon.maxUsagesPerCpf = 1;
    if (coupon.requireCpf === undefined) coupon.requireCpf = true;

    return coupon;
  }

  /** Quantas vezes um CPF específico já resgatou este cupom. */
  countCpfUsages(coupon, cpf) {
    const clean = sanitizeCpf(cpf);
    if (!coupon || !clean || !Array.isArray(coupon.redemptions)) return 0;
    return coupon.redemptions.filter(r => sanitizeCpf(r.cpf) === clean).length;
  }

  /** Histórico de CPFs que utilizaram o cupom (mais recentes primeiro). */
  getCouponRedemptions(code) {
    const coupon = this.getCoupon(code);
    if (!coupon) return null;
    return [...(coupon.redemptions || [])].sort((a, b) =>
      String(b.redeemedAt || '').localeCompare(String(a.redeemedAt || ''))
    );
  }

  /**
   * Remove um registro de resgate (libera novamente aquele CPF).
   * Devolve o cupom atualizado, ou null se o cupom/registro não existir.
   */
  removeCouponRedemption(code, redemptionId) {
    const coupon = this.getCoupon(code);
    if (!coupon) return null;

    const index = (coupon.redemptions || []).findIndex(r => String(r.id) === String(redemptionId));
    if (index === -1) return null;

    coupon.redemptions.splice(index, 1);
    coupon.currentUsages = Math.max(0, (coupon.currentUsages || 0) - 1);
    if (coupon.currentUsages < (coupon.maxUsages || 1)) {
      coupon.isUsed = false;
    }

    this.save();
    return coupon;
  }

  /** Todos os CPFs registrados na rede, agregados por CPF. */
  getAllCouponRedemptions() {
    const rows = [];
    for (const coupon of (this.tables.coupons || [])) {
      for (const r of (coupon.redemptions || [])) {
        rows.push({ ...r, couponCode: coupon.code, couponDescription: coupon.description });
      }
    }
    return rows.sort((a, b) => String(b.redeemedAt || '').localeCompare(String(a.redeemedAt || '')));
  }

  addCoupon(data) {
    const code = (data.code || '').trim().toUpperCase();
    if (!code) throw new Error('Código do cupom é obrigatório.');

    const maxUsages = Number(data.maxUsages) > 0 ? Number(data.maxUsages) : 1;
    const discountPercent = Math.min(100, Math.max(1, Number(data.discountPercent) || 10));
    const applicableMode = data.applicableMode && data.applicableMode !== 'TODOS' ? data.applicableMode.toUpperCase() : null;

    // Máquinas permitidas (null = válido para todas as máquinas)
    let allowedTotems = null;
    if (Array.isArray(data.allowedTotems)) {
      allowedTotems = data.allowedTotems.filter(t => t && t !== 'TODAS' && t !== 'ALL').map(t => t.trim().toUpperCase());
      if (allowedTotems.length === 0) allowedTotems = null;
    } else if (typeof data.allowedTotems === 'string' && data.allowedTotems.trim() && data.allowedTotems !== 'TODAS') {
      allowedTotems = [data.allowedTotems.trim().toUpperCase()];
    }

    // Limite de utilizações por CPF (0 ou vazio = sem limite individual)
    const rawPerCpf = Number(data.maxUsagesPerCpf);
    const maxUsagesPerCpf = Number.isFinite(rawPerCpf) && rawPerCpf > 0 ? Math.floor(rawPerCpf) : 1;

    // Exigir CPF do cliente para validar/resgatar (padrão: sim)
    const requireCpf = data.requireCpf === undefined ? true : Boolean(data.requireCpf);

    let index = (this.tables.coupons || []).findIndex(c => c.code.toUpperCase() === code);
    const existing = index !== -1 ? this.tables.coupons[index] : null;

    const currentUsages = existing ? (existing.currentUsages || 0) : 0;
    const coupon = {
      code,
      description: data.description || `Desconto de ${discountPercent}%`,
      discountPercent,
      applicableMode,
      allowedTotems,
      maxUsages,
      maxUsagesPerCpf,
      requireCpf,
      currentUsages,
      isUsed: currentUsages >= maxUsages,
      redemptions: existing && Array.isArray(existing.redemptions) ? existing.redemptions : [],
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (index !== -1) {
      this.tables.coupons[index] = coupon;
    } else {
      this.tables.coupons.unshift(coupon);
    }

    this.save();
    return coupon;
  }

  deleteCoupon(code) {
    if (!code) return false;
    const clean = code.trim().toUpperCase();
    const initialLen = this.tables.coupons.length;
    this.tables.coupons = this.tables.coupons.filter(c => c.code.toUpperCase() !== clean);
    this.save();
    return this.tables.coupons.length < initialLen;
  }

  resetCoupon(code) {
    if (!code) return null;
    const clean = code.trim().toUpperCase();
    const cp = this.tables.coupons.find(c => c.code.toUpperCase() === clean);
    if (cp) {
      cp.currentUsages = 0;
      cp.isUsed = false;
      cp.usedAt = null;
      cp.usedByTotem = null;
      cp.redemptions = [];
      this.save();
      return cp;
    }
    return null;
  }

  /**
   * Verifica se o cupom pode ser utilizado pelo CPF informado.
   * Retorna { error, message } quando bloqueado, ou null quando liberado.
   */
  checkCouponCpf(coupon, rawCpf) {
    const cpf = sanitizeCpf(rawCpf);

    if (!cpf) {
      // Etapa de CPF desligada em services/cpf.js: resgate sem CPF é aceito.
      if (!COUPON_CPF_ENABLED || coupon.requireCpf === false) return null;
      return { error: 'COUPON_CPF_REQUIRED', message: 'Informe o CPF do cliente para utilizar este cupom.' };
    }

    if (!isValidCpf(cpf)) {
      return { error: 'COUPON_CPF_INVALID', message: 'CPF inválido. Confira os números digitados.' };
    }

    const perCpf = Number(coupon.maxUsagesPerCpf) > 0 ? Number(coupon.maxUsagesPerCpf) : 1;
    const used = this.countCpfUsages(coupon, cpf);
    if (used >= perCpf) {
      return {
        error: 'COUPON_CPF_LIMIT_REACHED',
        message: perCpf === 1
          ? `O CPF ${formatCpf(cpf)} já utilizou este cupom.`
          : `O CPF ${formatCpf(cpf)} já utilizou este cupom ${used} de ${perCpf} vezes permitidas.`
      };
    }

    return null;
  }

  redeemCoupon(code, totemId, details = {}) {
    const coupon = this.getCoupon(code);
    if (!coupon) return null;

    const cleanTotem = (totemId || details.totemId || '').trim().toUpperCase();
    if (coupon.allowedTotems && coupon.allowedTotems.length > 0 && cleanTotem) {
      const isAllowed = coupon.allowedTotems.some(t => t === cleanTotem || t === 'TODAS');
      if (!isAllowed) {
        return { error: 'COUPON_NOT_ALLOWED_ON_THIS_TOTEM', message: `Este cupom não é válido para a máquina ${totemId}.` };
      }
    }

    // Controle de utilização por CPF (limite individual do portador)
    const cpfCheck = this.checkCouponCpf(coupon, details.cpf);
    if (cpfCheck) return cpfCheck;

    const maxUsages = coupon.maxUsages || 1;
    if (coupon.currentUsages >= maxUsages || coupon.isUsed) {
      return { error: 'COUPON_EXHAUSTED', message: 'Este cupom já atingiu o limite máximo de utilizações.' };
    }

    coupon.currentUsages = (coupon.currentUsages || 0) + 1;
    if (coupon.currentUsages >= maxUsages) {
      coupon.isUsed = true;
    }

    coupon.usedAt = new Date().toISOString();
    coupon.usedByTotem = totemId || details.totemId || "TOTEM-CPX-001";
    if (details.selectedMode) coupon.lastUsedMode = details.selectedMode;
    if (details.orderId) coupon.lastOrderId = details.orderId;

    // Registra o CPF que resgatou (exibido na aba Cupons do painel web)
    const cpf = sanitizeCpf(details.cpf);
    if (!Array.isArray(coupon.redemptions)) coupon.redemptions = [];
    coupon.redemptions.push({
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      cpf,
      cpfFormatted: cpf ? formatCpf(cpf) : '',
      redeemedAt: coupon.usedAt,
      totemId: coupon.usedByTotem,
      selectedMode: details.selectedMode || null,
      orderId: details.orderId || null,
      discountPercent: coupon.discountPercent,
      discountAppliedInCents: Number(details.discountAppliedInCents) || 0
    });

    this.save();
    return coupon;
  }

  resetCoupons(scope = 'ALL') {
    let count = 0;
    for (const cp of (this.tables.coupons || [])) {
      cp.isUsed = false;
      cp.usedAt = null;
      cp.usedByTotem = null;
      cp.currentUsages = 0;
      cp.redemptions = [];
      count++;
    }
    this.save();
    return count;
  }
}

module.exports = new RelationalDatabase();
