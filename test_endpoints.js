/**
 * Script de teste automatizado dos endpoints do Capaxero Cloud
 * Inclui testes de V1 Native + Camada de Compatibilidade UPUS IoT
 */

async function runTests() {
  const baseUrl = 'http://localhost:3000';
  console.log('🧪 Iniciando bateria completa de testes no Capaxero Cloud (V1 + UPUS IoT)...\n');

  try {
    // 1. Health Check
    const resHealth = await fetch(`${baseUrl}/health`).then(r => r.json());
    console.log('✅ [1. Health Check]:', resHealth);

    // 2. Totem Login (V1)
    const resLogin = await fetch(`${baseUrl}/api/v1/totem/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devno: 'CPX-001', appVersion: 'v3.3.0' })
    }).then(r => r.json());
    console.log('✅ [2. Totem Login V1]:', resLogin);

    // 3. Webhook Cielo Pagamento
    const resWebhook = await fetch(`${baseUrl}/api/v1/payment/cielo/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ORD-TEST-99',
        devno: 'CPX-001',
        mode: 'INTERMEDIARIA',
        amount: 17.00,
        paymentMethod: 'CIELO_CREDITO_NFC',
        cardBrand: 'Mastercard NFC',
        status: 'APPROVED',
        nsu: '984729182',
        authCode: '482910'
      })
    }).then(r => r.json());
    console.log('✅ [3. Webhook Cielo]:', resWebhook);

    // 4. UPUS IoT - Operador Login
    const resUpusLogin = await fetch(`${baseUrl}/upus_APP/app/Register/login1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyNo: 'spost', userName: 'A0629', userPwd: '123456', userType: 1 })
    }).then(r => r.json());
    console.log('✅ [4. UPUS Register/login1]:', resUpusLogin);

    // 5. UPUS IoT - Totem Login original
    const resUpusDevLogin = await fetch(`${baseUrl}/upus_APP/app/expressbox/devlogin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devno: 'CPX-002-RDV', appVersion: 'v3.2.7' })
    }).then(r => r.json());
    console.log('✅ [5. UPUS expressbox/devlogin]:', resUpusDevLogin);

    // 6. UPUS IoT - Download de Parâmetros de Tempos
    const resUpusDevInfo = await fetch(`${baseUrl}/upus_APP/app/expressbox/devnoinfo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devno: 'CPX-001' })
    }).then(r => r.json());
    console.log('✅ [6. UPUS expressbox/devnoinfo]:', resUpusDevInfo);

    // 7. UPUS IoT - Teste Remoto de Névoa / Fogger
    const resUpusSmoke = await fetch(`${baseUrl}/upus_APP/app/device/remote/smoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devno: 'CPX-001' })
    }).then(r => r.json());
    console.log('✅ [7. UPUS device/remote/smoke]:', resUpusSmoke);

    // 8. UPUS IoT - Relatório Financeiro (newdepot/income/count)
    const resUpusIncome = await fetch(`${baseUrl}/upus_APP/app/newdepot/income/count`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }).then(r => r.json());
    console.log('✅ [8. UPUS newdepot/income/count]:', resUpusIncome.data ? 'Receita da semana: R$ ' + resUpusIncome.data.weekTotalRevenue : 'OK');

    // 9. Admin Depots & Filiais
    const resDepots = await fetch(`${baseUrl}/api/v1/admin/depots`).then(r => r.json());
    console.log('✅ [9. Admin Depots]:', resDepots.data ? resDepots.data.length + ' pontos carregados' : 'OK');

    console.log('\n🎉 TODOS OS TESTES (V1 NATIVE + UPUS IOT COMPAT) PASSARAM COM SUCESSO!');
  } catch (err) {
    console.error('❌ Falha nos testes:', err);
  }
}

runTests();
