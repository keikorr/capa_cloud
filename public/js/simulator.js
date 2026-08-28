/**
 * Capaxero Cloud — Módulo do Simulador Interativo
 * Simulações de Terminal Cielo (POS/PIX) e Ciclos de Hardware da Estação (UPUS & Capaxero)
 */

class CapaxeroSimulator {
  constructor() {
    this.activeSimInterval = null;
    this.init();
  }

  init() {
    this.attachFormListeners();
    this.attachHardwareSimListeners();
  }

  updateTotemSelects(totems) {
    const cieloSelect = document.getElementById('sim-cielo-totem');
    const hwSelect = document.getElementById('sim-hw-totem');

    if (!cieloSelect || !hwSelect) return;

    const optionsHtml = totems.map(t => `<option value="${t.devno}">${t.name} (${t.devno})</option>`).join('');

    const curCielo = cieloSelect.value;
    const curHw = hwSelect.value;

    cieloSelect.innerHTML = optionsHtml;
    hwSelect.innerHTML = optionsHtml;

    if (curCielo) cieloSelect.value = curCielo;
    if (curHw) hwSelect.value = curHw;
  }

  attachFormListeners() {
    const modeSelect = document.getElementById('sim-cielo-mode');
    const displayAmount = document.getElementById('pos-display-amount');
    const formCielo = document.getElementById('form-simulate-cielo');

    if (modeSelect && displayAmount) {
      modeSelect.addEventListener('change', () => {
        const selected = modeSelect.options[modeSelect.selectedIndex];
        const price = selected.getAttribute('data-price');
        displayAmount.textContent = `R$ ${Number(price).toFixed(2).replace('.', ',')}`;
      });
    }

    if (formCielo) {
      formCielo.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const devno = document.getElementById('sim-cielo-totem').value;
        const mode = document.getElementById('sim-cielo-mode').value;
        const paymentMethod = document.getElementById('sim-cielo-method').value;
        const selectedOption = modeSelect.options[modeSelect.selectedIndex];
        const amount = Number(selectedOption.getAttribute('data-price') || 17.00);

        const orderId = 'ORD-' + Math.floor(10000 + Math.random() * 90000);

        const brand = paymentMethod.includes('PIX') ? 'PIX Banco Central' : 
                      paymentMethod.includes('DEBITO') ? 'Visa Débito' : 'Mastercard NFC';

        try {
          // O webhook agora exige um token (ver middleware/auth.js) para não aceitar
          // aprovações forjadas de qualquer origem — inclusive deste simulador de demonstração.
          let webhookToken = localStorage.getItem('capaxero_webhook_token');
          if (!webhookToken) {
            webhookToken = window.prompt('Token de webhook (impresso no console do servidor ao subir, ou definido em CAPAXERO_WEBHOOK_TOKEN):') || '';
            if (webhookToken) localStorage.setItem('capaxero_webhook_token', webhookToken.trim());
          }

          const resp = await fetch(`/api/v1/payment/cielo/webhook?token=${encodeURIComponent(webhookToken)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId,
              devno,
              mode,
              amount,
              paymentMethod,
              cardBrand: brand,
              status: 'APPROVED',
              nsu: Math.floor(100000000 + Math.random() * 900000000).toString(),
              authCode: Math.floor(100000 + Math.random() * 900000).toString()
            })
          });

          const res = await resp.json();
          if (res.success) {
            window.app.showToast(`✅ [Cielo POS] Transação ${orderId} APROVADA! Iniciando ciclo...`);
            this.runStepByStepCleaning(devno, mode, amount);
          }
        } catch (err) {
          console.error(err);
          window.app.showToast('❌ Erro ao enviar webhook Cielo.');
        }
      });
    }
  }

  attachHardwareSimListeners() {
    const btnFullCycle = document.getElementById('btn-sim-run-full-cycle');
    const btnSmoke = document.getElementById('btn-sim-smoke-fogger');
    const btnPurge = document.getElementById('btn-sim-purge-ducts');
    const btnHeartbeat = document.getElementById('btn-sim-heartbeat');
    const btnFluidAlert = document.getElementById('btn-sim-alert-fluid');
    const btnTempAlert = document.getElementById('btn-sim-alert-temp');
    const btnRefill = document.getElementById('btn-sim-refill');

    if (btnFullCycle) {
      btnFullCycle.addEventListener('click', () => {
        const devno = document.getElementById('sim-hw-totem').value;
        this.runStepByStepCleaning(devno, 'INTERMEDIARIA', 17.00);
      });
    }

    if (btnSmoke) {
      btnSmoke.addEventListener('click', async () => {
        const devno = document.getElementById('sim-hw-totem').value;
        await window.app.sendRemoteCommand(devno, 'TEST_FOGGER_SMOKE');
      });
    }

    if (btnPurge) {
      btnPurge.addEventListener('click', async () => {
        const devno = document.getElementById('sim-hw-totem').value;
        await window.app.sendRemoteCommand(devno, 'PURGE_DUCTS');
      });
    }

    if (btnHeartbeat) {
      btnHeartbeat.addEventListener('click', async () => {
        const devno = document.getElementById('sim-hw-totem').value;
        const randomTemp = 24 + Math.random() * 18;
        
        await fetch('/api/v1/totem/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            devno,
            status: 'IDLE',
            temperature: parseFloat(randomTemp.toFixed(1)),
            doorLocked: true
          })
        });

        window.app.showToast(`💓 Heartbeat enviado para ${devno} (Temp: ${randomTemp.toFixed(1)}°C)`);
      });
    }

    if (btnFluidAlert) {
      btnFluidAlert.addEventListener('click', async () => {
        const devno = document.getElementById('sim-hw-totem').value;
        
        await fetch('/api/v1/totem/alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            devno,
            type: 'LOW_LIQUID',
            severity: 'WARNING',
            message: 'Nível de sanitizante caiu abaixo de 15%. Reabastecimento urgente.'
          })
        });

        await fetch('/api/v1/totem/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            devno,
            liquidLevelPercent: 12
          })
        });
      });
    }

    if (btnTempAlert) {
      btnTempAlert.addEventListener('click', async () => {
        const devno = document.getElementById('sim-hw-totem').value;
        
        await fetch('/api/v1/totem/alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            devno,
            type: 'HIGH_TEMP',
            severity: 'CRITICAL',
            message: 'Sensor de temperatura atingiu 56.8°C. Termostato de segurança acionado!'
          })
        });

        await fetch('/api/v1/totem/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            devno,
            status: 'ERROR',
            temperature: 56.8
          })
        });
      });
    }

    if (btnRefill) {
      btnRefill.addEventListener('click', async () => {
        const devno = document.getElementById('sim-hw-totem').value;
        await window.app.sendRemoteCommand(devno, 'REFILL_FLUIDS');
      });
    }
  }

  // --- Simulação do Ciclo Tecnológico de 4 Fases ---
  runStepByStepCleaning(devno, mode = 'INTERMEDIARIA', amount = 17.00) {
    if (this.activeSimInterval) {
      clearInterval(this.activeSimInterval);
    }

    const steps = [
      { stepName: '🟣 FASE 1/4: ESTERILIZAÇÃO UV-C GERMICIDA', temp: 28.0, progress: 15, duration: 4 },
      { stepName: '🔵 FASE 2/4: NÉVOA SANITIZANTE ATOMIZADA', temp: 34.5, progress: 40, duration: 5 },
      { stepName: '🟠 FASE 3/4: SECAGEM TÉRMICA & AR QUENTE', temp: 44.0, progress: 75, duration: 5 },
      { stepName: '🟢 FASE 4/4: OZÔNIO & BORRIFO DE FRAGRÂNCIA', temp: 36.0, progress: 95, duration: 4 }
    ];

    let currentStepIdx = 0;
    const totalSteps = steps.length;

    window.app.showToast(`🚀 [Ciclo Iniciado] Totem ${devno} trancou a porta e começou o ciclo ${mode}.`);

    const executeNextStep = () => {
      if (currentStepIdx < totalSteps) {
        const current = steps[currentStepIdx];

        fetch('/api/v1/totem/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            devno,
            status: 'CLEANING',
            temperature: current.temp,
            doorLocked: true,
            currentCycle: {
              mode,
              step: current.stepName,
              stepIndex: currentStepIdx + 1,
              totalSteps,
              progressPercent: current.progress,
              elapsedSeconds: (currentStepIdx + 1) * 60,
              totalSeconds: 420
            }
          })
        });

        currentStepIdx++;
        setTimeout(executeNextStep, current.duration * 1000);
      } else {
        fetch('/api/v1/totem/cycle-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            devno,
            orderId: 'ORD-' + Math.floor(10000 + Math.random() * 90000),
            mode,
            durationSeconds: 420,
            amount,
            paymentMethod: 'CIELO_CREDITO_NFC'
          })
        });

        fetch('/api/v1/totem/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            devno,
            status: 'IDLE',
            temperature: 26.0,
            doorLocked: false,
            currentCycle: null
          })
        });
      }
    };

    executeNextStep();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.simulator = new CapaxeroSimulator();
});
