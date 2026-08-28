/**
 * Capaxero Cloud — Rotas de Autenticação e Gestão de Contas (Donos & CRPADMIN)
 */

const express = require('express');
const router = express.Router();
const store = require('../services/store');
const crypto = require('crypto');

// Sessões em memória (Token -> User)
const activeSessions = new Map();

function generateSessionToken(user) {
  const token = 'CPX_SESS_' + crypto.randomBytes(32).toString('hex');
  activeSessions.set(token, {
    userId: user.id,
    role: user.role,
    username: user.username,
    responsible_name: user.responsible_name,
    email: user.email,
    cnpj: user.cnpj,
    createdAt: Date.now()
  });
  return token;
}

function getUserFromToken(token) {
  if (!token) return null;
  const cleanToken = token.replace(/^Bearer\s+/i, '').trim();
  const session = activeSessions.get(cleanToken);
  if (!session) return null;

  // Atualiza dados frescos do banco
  const user = store.getUserById(session.userId);
  return user || null;
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

    const { cnpj, email, password, responsible_name, phone, company_name, username } = req.body;

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
  const user = getUserFromToken(authHeader);

  if (!user) {
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

module.exports = { router, getUserFromToken };
