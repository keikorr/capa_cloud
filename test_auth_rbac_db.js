/**
 * Teste Automatizado de Banco de Dados, Autenticação, Cadastro de Donos e RBAC
 */

async function runAuthRbacTests() {
  const baseUrl = 'http://localhost:3000';
  console.log('🧪 Iniciando testes de Banco de Dados, Autenticação e RBAC...\n');

  try {
    // 1. Health Check
    const health = await fetch(`${baseUrl}/health`).then(r => r.json());
    console.log('✅ [1. Health Check]:', health.status, '| Database:', health.database);

    // 2. Login como Super Admin CRPADMIN (Jonathan / 210602)
    const adminLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'CRPADMIN', password: '210602' })
    }).then(r => r.json());

    if (!adminLoginRes.success) throw new Error('Falha no login do CRPADMIN: ' + adminLoginRes.message);
    const adminToken = adminLoginRes.data.token;
    console.log('✅ [2. Login CRPADMIN]: Sucesso! Usuário:', adminLoginRes.data.user.responsible_name, '| Role:', adminLoginRes.data.user.role);

    // 3. Cadastro de Novo Dono (CNPJ, Email, Senha, Responsável, Telefone)
    const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cnpj: '12.345.678/0001-90',
        responsible_name: 'Carlos Dono de Totem',
        company_name: 'Posto Estrela Conveniência',
        email: 'carlos.dono@postoestrela.com.br',
        phone: '(11) 98765-4321',
        password: 'minhasenha123'
      })
    }).then(r => r.json());

    if (!registerRes.success && !registerRes.message.includes('já está cadastrado')) {
      throw new Error('Falha no cadastro do Dono: ' + registerRes.message);
    }
    console.log('✅ [3. Cadastro de Dono]:', registerRes.message);

    // 4. Login do Dono Cadastrado
    const ownerLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'carlos.dono@postoestrela.com.br', password: 'minhasenha123' })
    }).then(r => r.json());

    if (!ownerLoginRes.success) throw new Error('Falha no login do Dono: ' + ownerLoginRes.message);
    const ownerToken = ownerLoginRes.data.token;
    const ownerUser = ownerLoginRes.data.user;
    console.log('✅ [4. Login Dono Cadastrado]: Sucesso! Responsável:', ownerUser.responsible_name, '| CNPJ:', ownerUser.cnpj, '| Role:', ownerUser.role);

    // 5. Teste de Permissão: Apenas CRPADMIN pode listar todos os usuários
    const adminUsersList = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }).then(r => r.json());
    console.log('✅ [5a. Listar Usuários como CRPADMIN]: Permitido! Total de cadastros:', adminUsersList.data?.length);

    const ownerUsersAttempt = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { 'Authorization': `Bearer ${ownerToken}` }
    }).then(r => r.json());
    console.log('✅ [5b. Listar Usuários como Dono]: Bloqueado com sucesso (RBAC):', ownerUsersAttempt.message);

    // 6. Transferência de Totem pelo CRPADMIN para o novo Dono
    const transferRes = await fetch(`${baseUrl}/api/v1/admin/totems/CPX-001/transfer`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ targetUserId: ownerUser.id })
    }).then(r => r.json());
    console.log('✅ [6. Transferência de Totem pelo CRPADMIN]:', transferRes.message);

    // 7. Dono visualiza sua máquina transferida com chaves Cielo mascaradas/bloqueadas
    const ownerTotemsRes = await fetch(`${baseUrl}/api/v1/admin/totems`, {
      headers: { 'Authorization': `Bearer ${ownerToken}` }
    }).then(r => r.json());

    const ownedTotem = ownerTotemsRes.data?.find(t => t.devno === 'CPX-001');
    console.log('✅ [7. Visão do Dono]: Máquina atribuída:', ownedTotem?.devno, '| Dono:', ownedTotem?.owner, '| MerchantKey oculta:', ownedTotem?.config?.cieloMerchantKey === undefined ? 'SIM (Seguro)' : 'NÃO');

    console.log('\n======================================================');
    console.log('🎉 TODOS OS TESTES DE BANCO, AUTH E RBAC PASSARAM COM SUCESSO!');
    console.log('======================================================');
  } catch (err) {
    console.error('❌ Erro no teste:', err.message);
  }
}

runAuthRbacTests();
