/**
 * Capaxero Cloud — Rotas de Autenticação e Gestão de Contas (Donos & CRPADMIN)
 */

const express = require('express');
const router = express.Router();
const store = require('../services/store');
const crypto = require('crypto');

// Sessões em memória (Token -> snapshot do usuário)
const activeSessions = new Map();

/**
 * Cópia dos campos públicos do usuário guardada na sessão.
 * Mesma forma que store.getUserById() devolve (nunca inclui password_hash).
 */
function snapshotUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    cnpj: user.cnpj,
    responsible_name: user.responsible_name,
    phone: user.phone,
    company_name: user.company_name,
    franchiseType: user.franchiseType,
    created_at: user.created_at,
    updated_at: user.updated_at
  };
}

function generateSessionToken(user) {
  const token = 'CPX_SESS_' + crypto.randomBytes(32).toString('hex');
  activeSessions.set(token, {
    user: snapshotUser(user),
    createdAt: Date.now()
  });
  return token;
}

/**
 * Resolve o usuário autenticado a partir do token.
 *
 * Lê exclusivamente da sessão em memória, sem tocar no banco. Todos os consumidores usam
 * apenas role/id/responsible_name/username, que já estavam guardados aqui — o getUserById()
 * que existia antes só servia para "atualizar" os dados.
 *
 * Manter esta função síncrona é deliberado: ela é exportada, o admin.js a embrulha em
 * extractUser(), e praticamente toda rota administrativa começa por aí. Torná-la assíncrona
 * obrigaria a converter em cascata todo o admin.js sem ganho nenhum.
 *
 * A contrapartida é a sessão poder ficar defasada, coberta por refreshSessionsForUser() e
 * invalidateSessionsForUser() nos dois caminhos que alteram usuário.
 */
function getUserFromToken(token) {
  if (!token) return null;
  const cleanToken = token.replace(/^Bearer\s+/i, '').trim();
  const session = activeSessions.get(cleanToken);
  if (!session) return null;

  // Cópia: evita que um consumidor mute o estado da sessão sem querer
  return { ...session.user };
}

/**
 * Atualiza o snapshot de todas as sessões do usuário após edição de perfil.
 */
function refreshSessionsForUser(userId, updatedUser) {
  if (!userId || !updatedUser) return 0;
  let count = 0;
  for (const session of activeSessions.values()) {
    if (session.user && session.user.id === userId) {
      session.user = snapshotUser(updatedUser);
      count++;
    }
  }
  return count;
}

/**
 * Encerra todas as sessões do usuário (exclusão de conta).
 * Reproduz o comportamento anterior, em que getUserById() passava a devolver undefined
 * e o token deixava de resolver.
 */
function invalidateSessionsForUser(userId) {
  if (!userId) return 0;
  let count = 0;
  for (const [token, session] of activeSessions.entries()) {
    if (session.user && session.user.id === userId) {
      activeSessions.delete(token);
      count++;
    }
  }
  return count;
}

/**
 * POST /api/v1/auth/register
 * Cadastro de novos Donos de Totens (Exclusivo para Super Admin CRPADMIN)
 */
router.post('/register', (req, res) => {
  try {
    const authHeader = req.headers.authorization || req.query.token;
    const requester = getUserFromToken(authHeader);

    // Apenas o usuário CRPADMIN pode criar novos donos
    if (!requester || requester.role !== 'CRPADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Acesso negado. Apenas o perfil Administrador (CRPADMIN) pode cadastrar novos donos de totens.'
      });
    }

    const { cnpj, email, password, responsible_name, phone, company_name, username, franchiseType } = req.body;

    if (!email || !password || !responsible_name) {
      return res.status(400).json({
        success: false,
        message: 'E-mail, senha e nome do responsável são obrigatórios.'
      });
    }

    if (!cnpj) {
      return res.status(400).json({
        success: false,
        message: 'CNPJ é obrigatório para cadastro de donos.'
      });
    }

    const newUser = store.createUser({
      cnpj,
      email,
      password,
      responsible_name,
      phone,
      company_name,
      username,
      franchiseType,
      role: 'OWNER'
    });

    const token = generateSessionToken(newUser);

    return res.json({
      success: true,
      message: 'Novo dono cadastrado com sucesso!',
      data: {
        user: newUser,
        token
      }
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Erro ao realizar cadastro.'
    });
  }
});

/**
 * PUT /api/v1/auth/profile
 * Permite ao usuário autenticado editar seus próprios dados (telefone, e-mail, nome, senha)
 */
router.put('/profile', (req, res) => {
  try {
    const authHeader = req.headers.authorization || req.query.token;
    const user = getUserFromToken(authHeader);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Sessão inválida ou expirada. Faça login novamente.'
      });
    }

    const { email, phone, responsible_name, company_name, password } = req.body;

    const updatedUser = store.updateUserProfile(user.id, {
      email,
      phone,
      responsible_name,
      company_name,
      password
    });

    // Mantém o snapshot das sessões em dia — getUserFromToken lê daqui, não do banco
    refreshSessionsForUser(user.id, updatedUser);

    return res.json({
      success: true,
      message: 'Perfil atualizado com sucesso!',
      data: updatedUser
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Erro ao atualizar dados do perfil.'
    });
  }
});

/**
 * POST /api/v1/auth/login
 * Login para Donos e CRPADMIN
 */
router.post('/login', (req, res) => {
  const { login, password } = req.body;

  if (!login || !password) {
    return res.status(400).json({
      success: false,
      message: 'Login (E-mail/CNPJ/Usuário) e senha são obrigatórios.'
    });
  }

  const user = store.authenticateUser(login, password);

  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Credenciais inválidas. Verifique seu login e senha.'
    });
  }

  const token = generateSessionToken(user);

  return res.json({
    success: true,
    message: `Bem-vindo, ${user.responsible_name || user.username}!`,
    data: {
      user,
      token
    }
  });
});

/**
 * GET /api/v1/auth/me
 * Retorna os dados do usuário conectado
 */
router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization || req.query.token;
  const session = getUserFromToken(authHeader);

  if (!session) {
    return res.status(401).json({
      success: false,
      message: 'Sessão inválida ou expirada.'
    });
  }

  // Única rota que realmente quer o registro fresco do banco, e não o snapshot da sessão:
  // é o que o painel usa para reidratar o perfil ao recarregar a página.
  const user = store.getUserById(session.id);

  if (!user) {
    // Conta removida enquanto a sessão ainda existia
    invalidateSessionsForUser(session.id);
    return res.status(401).json({
      success: false,
      message: 'Sessão inválida ou expirada.'
    });
  }

  return res.json({
    success: true,
    data: user
  });
});

/**
 * POST /api/v1/auth/logout
 */
router.post('/logout', (req, res) => {
  const authHeader = req.headers.authorization || req.query.token;
  if (authHeader) {
    const cleanToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    activeSessions.delete(cleanToken);
  }
  return res.json({ success: true, message: 'Logout realizado com sucesso.' });
});

module.exports = { router, getUserFromToken, refreshSessionsForUser, invalidateSessionsForUser };
