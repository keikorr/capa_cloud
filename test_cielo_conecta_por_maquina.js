/**
 * Capaxero Cloud — Verificação da parametrização Cielo Conecta POR MÁQUINA.
 *
 * Complementa test_cielo_conecta_full.js, que exercita o fluxo de uma transação. Aqui o que
 * está sob teste é o isolamento entre máquinas: cada totem tem que transacionar com o
 * credenciamento que o painel gravou nele, e não com o global do .env.
 *
 * Não toca no banco: substitui store.getTotem por dois totens fictícios em memória.
 */
process.env.CIELO_SIMULATOR = 'on'; // antes do primeiro require de config/cielo_conecta

const express = require('express');
const store = require('./services/store');

const TOTEMS = {
  'CPX-A': { devno: 'CPX-A', name: 'Loja A', config: { cielo: {
    conectaEnvironment: 'Producao',
    conectaClientId: 'aaaaaaaa-1111-2222-3333-444444444444',
    conectaClientSecret: 'segredo-A', conectaSubordinatedMerchantId: 'SUB-A',
    conectaTerminalId: '00000009', conectaCardTimeoutSeconds: 120,
    pinpadLicense: 'LIC-AAA', pinpadCompany: 'loja-a', pinpadComm: 'USB' }}},
  'CPX-B': { devno: 'CPX-B', name: 'Loja B', config: { cielo: {
    conectaEnvironment: 'Sandbox',
    conectaClientId: 'bbbbbbbb-1111-2222-3333-444444444444',
    conectaClientSecret: 'segredo-B', conectaSubordinatedMerchantId: 'SUB-B',
    conectaTerminalId: '00000007',
    pinpadLicense: 'LIC-BBB', pinpadCompany: 'loja-b', pinpadComm: 'Serial' }}}
};

const realGetTotem = store.getTotem.bind(store);
store.getTotem = (devno) => TOTEMS[devno] || realGetTotem(devno);

const app = express();
app.use(express.json());
app.use('/api/v1/payment', require('./routes/cielo'));
app.use('/api/v1', require('./routes/api'));

let falhas = 0;
const check = (label, cond) => {
  if (!cond) falhas++;
  console.log(`${cond ? '  ok   ' : '  FALHA'}  ${label}`);
};

const server = app.listen(3998, async () => {
  const get = async (u) => (await fetch('http://127.0.0.1:3998' + u)).json();
  const post = async (u, b) => (await fetch('http://127.0.0.1:3998' + u, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();

  try {
    console.log('\n[1] GET /cielo/card/config resolve por maquina');
    const ca = (await get('/api/v1/payment/cielo/card/config?devno=CPX-A')).data;
    const cb = (await get('/api/v1/payment/cielo/card/config?devno=CPX-B')).data;
    console.log(`   A: ${ca.environment} ${ca.pinpad.license} ${ca.pinpad.comm} ${ca.cardTimeoutSeconds}s`);
    console.log(`   B: ${cb.environment} ${cb.pinpad.license} ${cb.pinpad.comm} ${cb.cardTimeoutSeconds}s`);
    check('licencas de pinpad distintas', ca.pinpad.license !== cb.pinpad.license);
    check('ambientes distintos', ca.environment === 'Producao' && cb.environment === 'Sandbox');
    check('timeout por maquina (120 vs 90 padrao)', ca.cardTimeoutSeconds === 120 && cb.cardTimeoutSeconds === 90);

    console.log('\n[2] POST /cielo/card/start usa o timeout da maquina');
    const sa = await post('/api/v1/payment/cielo/card/start', { devno: 'CPX-A', amount: 17, paymentMethod: 'CIELO_CREDITO' });
    const sb = await post('/api/v1/payment/cielo/card/start', { devno: 'CPX-B', amount: 17, paymentMethod: 'CIELO_CREDITO' });
    console.log(`   A timeoutSeconds: ${sa.data.pinpadCommand.timeoutSeconds} | B: ${sb.data.pinpadCommand.timeoutSeconds}`);
    check('start reflete o timeout parametrizado',
      sa.data.pinpadCommand.timeoutSeconds === 120 && sb.data.pinpadCommand.timeoutSeconds === 90);

    console.log('\n[3] GET /totem/config/:devno publica conectaConfig');
    const pa = (await get('/api/v1/totem/config/CPX-A')).data.conectaConfig;
    const pb = (await get('/api/v1/totem/config/CPX-B')).data.conectaConfig;
    console.log(`   A: ${pa.environment} term=${pa.terminalId} sub=${pa.subordinatedMerchantId} cfg=${pa.isConfigured}`);
    console.log(`   B: ${pb.environment} term=${pb.terminalId} sub=${pb.subordinatedMerchantId} cfg=${pb.isConfigured}`);
    check('cada maquina recebe o proprio credenciamento',
      pa.clientId !== pb.clientId && pa.terminalId !== pb.terminalId);
    check('bloco do pinpad vai junto', pa.pinpadLicense === 'LIC-AAA' && pb.pinpadComm === 'Serial');
    check('isConfigured verdadeiro nas duas', pa.isConfigured === true && pb.isConfigured === true);

    console.log('\n[4] Maquina sem parametrizacao nao recebe credencial inventada');
    const pz = (await get('/api/v1/totem/config/CPX-002')).data.conectaConfig;
    console.log(`   CPX-002: clientId="${pz.clientId}" terminalId="${pz.terminalId}" cfg=${pz.isConfigured}`);
    check('sem default de sandbox embutido', pz.clientId === '' && pz.isConfigured === false);

    console.log('\n[5] Autorizacao completa o fluxo (simulador forcado)');
    const aa = await post('/api/v1/payment/cielo/card/authorize', {
      orderId: sa.data.orderId, devno: 'CPX-A', card: {}, pinpadInfo: {} });
    check('autoriza sem erro de credencial', aa.success === true);
    console.log(`   status: ${aa.data.status} | NSU: ${aa.data.nsu}`);

    console.log('\n[6] Desfazimento usa a credencial da maquina do pedido');
    const rv = await post('/api/v1/payment/cielo/card/reversal', { orderId: sa.data.orderId, reason: 'TESTE' });
    check('reversal processa', rv.success === true);

    // [7] O sinal mais importante: a decisao de simulador passou a ser POR MAQUINA.
    // Antes quem mandava era o .env global, entao uma maquina parametrizada continuava
    // caindo no simulador (venda de mentira) porque o servidor so olhava CIELO_CLIENT_ID.
    console.log('\n[7] Decisao de simulador e por maquina (modo auto)');
    const cieloCfg = require('./config/cielo_conecta');
    const svc = require('./services/cieloConecta');
    const anterior = cieloCfg.simulator;
    cieloCfg.simulator = 'auto';
    const simA = svc.isSimulator(svc.resolveConectaCredentials(TOTEMS['CPX-A']));
    const simZ = svc.isSimulator(svc.resolveConectaCredentials({ devno: 'CPX-Z', config: {} }));
    cieloCfg.simulator = anterior;
    console.log(`   CPX-A (parametrizada): simulador=${simA} | CPX-Z (vazia): simulador=${simZ}`);
    check('maquina parametrizada sai do simulador', simA === false);
    check('maquina vazia continua no simulador', simZ === true);

    console.log(falhas === 0
      ? '\n==========================================\n* PARAMETRIZACAO POR MAQUINA OK\n=========================================='
      : `\n!! ${falhas} verificacao(oes) falharam`);
  } catch (err) {
    falhas++;
    console.error('Erro nos testes:', err);
  } finally {
    server.close();
    process.exit(falhas === 0 ? 0 : 1);
  }
});
