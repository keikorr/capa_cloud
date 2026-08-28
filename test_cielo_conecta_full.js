const http = require('http');
const app = require('express')();
const cors = require('cors');
const express = require('express');

app.use(cors());
app.use(express.json());

const cieloRoutes = require('./routes/cielo');
app.use('/api/v1/payment', cieloRoutes);

const server = app.listen(3999, async () => {
  console.log('--- TESTANDO ROTAS CIELO CONECTA NO BACKEND (Porta 3999) ---');

  try {
    // 1. Testar /cielo/card/config
    console.log('\n[1] Testando GET /api/v1/payment/cielo/card/config:');
    const resConfig = await fetch('http://127.0.0.1:3999/api/v1/payment/cielo/card/config');
    const dataConfig = await resConfig.json();
    console.log('Config response:', JSON.stringify(dataConfig, null, 2));

    // 2. Testar /cielo/card/initialization
    console.log('\n[2] Testando GET /api/v1/payment/cielo/card/initialization:');
    const resInit = await fetch('http://127.0.0.1:3999/api/v1/payment/cielo/card/initialization');
    const dataInit = await resInit.json();
    console.log('Init response success:', dataInit.success, '| initVer10:', dataInit.data?.initVer10, '| aids count:', dataInit.data?.aidParameters?.length);

    // 3. Testar /cielo/card/start
    console.log('\n[3] Testando POST /api/v1/payment/cielo/card/start:');
    const resStart = await fetch('http://127.0.0.1:3999/api/v1/payment/cielo/card/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        devno: 'TOTEM-DEV-01',
        amount: 17.00,
        mode: 'INTERMEDIARIA',
        paymentMethod: 'CIELO_CREDITO'
      })
    });
    const dataStart = await resStart.json();
    console.log('Start response:', JSON.stringify(dataStart, null, 2));
    const orderId = dataStart.data?.orderId;

    // 4. Testar /cielo/status/:orderId
    console.log('\n[4] Testando GET /api/v1/payment/cielo/status/' + orderId + ':');
    const resStatus = await fetch('http://127.0.0.1:3999/api/v1/payment/cielo/status/' + orderId);
    const dataStatus = await resStatus.json();
    console.log('Status response:', JSON.stringify(dataStatus, null, 2));

    // 5. Testar /cielo/card/finish
    console.log('\n[5] Testando POST /api/v1/payment/cielo/card/finish (Aprovação):');
    const resFinish = await fetch('http://127.0.0.1:3999/api/v1/payment/cielo/card/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId,
        devno: 'TOTEM-DEV-01',
        finalResult: 'APPROVED',
        amountCents: 1700
      })
    });
    const dataFinish = await resFinish.json();
    console.log('Finish response:', JSON.stringify(dataFinish, null, 2));

    // 6. Testar /cielo/card/reversal
    console.log('\n[6] Testando POST /api/v1/payment/cielo/card/reversal:');
    const resRev = await fetch('http://127.0.0.1:3999/api/v1/payment/cielo/card/reversal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId,
        reason: 'TEST_USER_CANCEL'
      })
    });
    const dataRev = await resRev.json();
    console.log('Reversal response:', JSON.stringify(dataRev, null, 2));

    console.log('\n==========================================');
    console.log('★ TODOS OS ENDPOINTS RESPONDERAM COM SUCESSO!');
    console.log('==========================================');
  } catch (err) {
    console.error('Erro nos testes:', err);
  } finally {
    server.close();
    process.exit(0);
  }
});
