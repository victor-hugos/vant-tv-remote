'use strict';

(() => {
  const tvState = document.querySelector('#tv-state');
  const stateText = tvState.querySelector('span');
  const settingsStatus = document.querySelector('#settings-status');
  const sheet = document.querySelector('#settings-sheet');
  const toast = document.querySelector('#toast');
  const setupMessage = document.querySelector('#setup-message');
  const discoveredTvs = document.querySelector('#discovered-tvs');
  const manualIp = document.querySelector('#manual-tv-ip');
  const directionalPanel = document.querySelector('#directional-panel');
  const touchpad = document.querySelector('#touchpad-panel');
  const touchpadFeedback = document.querySelector('#touchpad-feedback');
  const keyboardSheet = document.querySelector('#keyboard-sheet');
  const keyboardInput = document.querySelector('#tv-text');
  const keyboardMessage = document.querySelector('#keyboard-message');
  let toastTimer;

  function tactile(element) {
    element?.classList.add('pressed');
    setTimeout(() => element?.classList.remove('pressed'), 110);
    if ('vibrate' in navigator) navigator.vibrate(10);
  }

  function showError(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2800);
  }

  function setSetupMessage(message, type = '') {
    setupMessage.textContent = message;
    setupMessage.classList.toggle('success', type === 'success');
    setupMessage.classList.toggle('error', type === 'error');
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.error || 'A operação não foi concluída');
    return result;
  }

  async function sendKey(key, source) {
    tactile(source);
    source?.classList.add('sending');
    try {
      await api(`/api/key/${encodeURIComponent(key)}`, { method: 'POST' });
      return true;
    } catch (error) {
      showError(error.message || 'Não foi possível enviar o comando');
      return false;
    } finally {
      source?.classList.remove('sending');
    }
  }

  function bindHold(button) {
    let delayTimer = null;
    let repeatTimer = null;
    const stop = () => {
      clearTimeout(delayTimer);
      clearInterval(repeatTimer);
      delayTimer = null;
      repeatTimer = null;
      button.classList.remove('pressed');
    };
    button.addEventListener('pointerdown', (event) => {
      if (delayTimer || repeatTimer) return;
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      sendKey(button.dataset.key, button);
      delayTimer = setTimeout(() => {
        delayTimer = null;
        repeatTimer = setInterval(() => sendKey(button.dataset.key, button), 190);
      }, 360);
    });
    ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']
      .forEach((name) => button.addEventListener(name, stop));
  }

  async function updateStatus() {
    try {
      const status = await api('/api/status');
      const online = status.tv === 'online';
      tvState.classList.toggle('online', online);
      tvState.classList.toggle('offline', !online);
      stateText.textContent = online ? 'online' : 'offline';
      settingsStatus.textContent = online ? 'Online' : 'Offline';
      return online;
    } catch {
      tvState.classList.remove('online');
      tvState.classList.add('offline');
      stateText.textContent = 'servidor offline';
      settingsStatus.textContent = 'Servidor offline';
      return false;
    }
  }

  async function loadTvInfo() {
    try {
      const tv = await api('/api/tv');
      document.querySelector('#device-ip').textContent = tv.ip;
      document.querySelector('#settings-ip').textContent = tv.ip;
      document.querySelector('#settings-model').textContent = tv.model;
      manualIp.value = tv.ip;
    } catch {}
  }

  async function connectTv(host, button) {
    const ip = String(host || '').trim();
    if (!ip) {
      setSetupMessage('Informe o IP da televisão.', 'error');
      manualIp.focus();
      return;
    }
    const originalText = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = 'Aguardando…';
    }
    setSetupMessage('Olhe para a TV e confirme “Permitir” quando a autorização aparecer.');
    try {
      const result = await api('/api/setup/connect', {
        method: 'POST',
        body: JSON.stringify({ host: ip }),
      });
      setSetupMessage(`TV ${result.tv.model} conectada e salva.`, 'success');
      await Promise.all([loadTvInfo(), updateStatus()]);
    } catch (error) {
      setSetupMessage(error.message, 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  function renderDevices(devices) {
    discoveredTvs.replaceChildren();
    if (!devices.length) {
      setSetupMessage('Nenhuma TV Samsung foi encontrada. Informe o IP manualmente.', 'error');
      return;
    }
    setSetupMessage(`${devices.length} TV${devices.length > 1 ? 's' : ''} encontrada${devices.length > 1 ? 's' : ''}. Selecione uma para conectar.`, 'success');
    for (const device of devices) {
      const button = document.createElement('button');
      const description = document.createElement('span');
      const model = document.createElement('strong');
      const ip = document.createElement('small');
      const action = document.createElement('span');
      button.type = 'button';
      button.className = 'tv-result';
      model.textContent = device.model || device.name || 'Samsung TV';
      ip.textContent = device.host;
      action.textContent = 'Conectar';
      description.append(model, ip);
      button.append(description, action);
      button.addEventListener('click', () => connectTv(device.host, button));
      discoveredTvs.append(button);
    }
  }

  document.querySelectorAll('.send-key').forEach((button) => button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    sendKey(button.dataset.key, button);
  }));
  document.querySelectorAll('.hold-key').forEach(bindHold);

  document.querySelectorAll('[data-navigation-mode]').forEach((button) => button.addEventListener('click', () => {
    const touchpadMode = button.dataset.navigationMode === 'touchpad';
    directionalPanel.hidden = touchpadMode;
    touchpad.hidden = !touchpadMode;
    document.querySelectorAll('[data-navigation-mode]').forEach((option) => {
      const selected = option === button;
      option.classList.toggle('active', selected);
      option.setAttribute('aria-selected', String(selected));
    });
    tactile(button);
  }));

  let touchGesture = null;
  let pendingMouseX = 0;
  let pendingMouseY = 0;
  let mouseRequestRunning = false;
  const mouseSensitivity = 2.2;

  function showTouchpadFeedback(symbol) {
    touchpadFeedback.textContent = symbol;
    touchpadFeedback.classList.add('visible');
    clearTimeout(showTouchpadFeedback.timer);
    showTouchpadFeedback.timer = setTimeout(() => touchpadFeedback.classList.remove('visible'), 180);
  }

  async function flushMouseMovement() {
    if (mouseRequestRunning) return;
    const x = Math.max(-300, Math.min(300, Math.round(pendingMouseX)));
    const y = Math.max(-300, Math.min(300, Math.round(pendingMouseY)));
    if (!x && !y) return;
    pendingMouseX -= x;
    pendingMouseY -= y;
    mouseRequestRunning = true;
    try {
      await api('/api/mouse', {
        method: 'POST',
        body: JSON.stringify({ action: 'move', x, y }),
      });
    } catch (error) {
      pendingMouseX = 0;
      pendingMouseY = 0;
      showError(error.message || 'Não foi possível mover a seta');
    } finally {
      mouseRequestRunning = false;
      if (Math.abs(pendingMouseX) >= 1 || Math.abs(pendingMouseY) >= 1) flushMouseMovement();
    }
  }

  function queueMouseMovement(dx, dy) {
    pendingMouseX += dx * mouseSensitivity;
    pendingMouseY += dy * mouseSensitivity;
    flushMouseMovement();
  }

  async function clickMouse() {
    try {
      await api('/api/mouse', {
        method: 'POST',
        body: JSON.stringify({ action: 'click', button: 'left' }),
      });
      if ('vibrate' in navigator) navigator.vibrate(10);
    } catch (error) {
      showError(error.message || 'Não foi possível clicar');
    }
  }

  touchpad.addEventListener('contextmenu', (event) => event.preventDefault());
  touchpad.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (touchGesture) return;
    touchpad.setPointerCapture?.(event.pointerId);
    touchpad.classList.add('tracking');
    touchGesture = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0 };
  });
  touchpad.addEventListener('pointermove', (event) => {
    if (!touchGesture || touchGesture.id !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - touchGesture.x;
    const dy = event.clientY - touchGesture.y;
    touchGesture.x = event.clientX;
    touchGesture.y = event.clientY;
    touchGesture.distance += Math.hypot(dx, dy);
    if (!dx && !dy) return;
    showTouchpadFeedback('↖');
    queueMouseMovement(dx, dy);
  });
  function finishTouchpad(event, cancelled = false) {
    if (!touchGesture || touchGesture.id !== event.pointerId) return;
    event.preventDefault();
    if (!cancelled && touchGesture.distance < 12) {
      showTouchpadFeedback('●');
      clickMouse();
    }
    touchGesture = null;
    touchpad.classList.remove('tracking');
  }
  touchpad.addEventListener('pointerup', (event) => finishTouchpad(event));
  touchpad.addEventListener('pointercancel', (event) => finishTouchpad(event, true));

  function setKeyboardMessage(message, type = '') {
    keyboardMessage.textContent = message;
    keyboardMessage.classList.toggle('success', type === 'success');
    keyboardMessage.classList.toggle('error', type === 'error');
  }

  document.querySelector('#open-keyboard').addEventListener('click', () => {
    keyboardSheet.showModal();
    setTimeout(() => keyboardInput.focus(), 80);
  });
  document.querySelector('#close-keyboard').addEventListener('click', () => keyboardSheet.close());
  document.querySelector('#clear-keyboard').addEventListener('click', () => {
    keyboardInput.value = '';
    keyboardInput.focus();
  });
  keyboardSheet.addEventListener('click', (event) => { if (event.target === keyboardSheet) keyboardSheet.close(); });
  document.querySelector('#keyboard-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.querySelector('#send-text');
    const text = keyboardInput.value.trim();
    if (!text) {
      setKeyboardMessage('Digite o que deseja pesquisar.', 'error');
      keyboardInput.focus();
      return;
    }
    button.disabled = true;
    button.textContent = 'Enviando…';
    try {
      await api('/api/text', { method: 'POST', body: JSON.stringify({ text }) });
      setKeyboardMessage('Texto enviado para a TV.', 'success');
    } catch (error) {
      setKeyboardMessage(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Enviar para a TV';
    }
  });

  const playPause = document.querySelector('#play-pause');
  playPause.addEventListener('pointerdown', async (event) => {
    event.preventDefault();
    const key = playPause.dataset.nextKey;
    if (await sendKey(key, playPause)) playPause.dataset.nextKey = key === 'KEY_PAUSE' ? 'KEY_PLAY' : 'KEY_PAUSE';
  });

  function openSettings() {
    loadTvInfo();
    updateStatus();
    sheet.showModal();
  }

  document.querySelector('#open-settings').addEventListener('click', openSettings);
  document.querySelector('#device-card').addEventListener('click', openSettings);
  sheet.addEventListener('click', (event) => { if (event.target === sheet) sheet.close(); });
  document.querySelector('#apps-button').addEventListener('click', () => document.querySelector('#app-shortcuts').scrollIntoView({ behavior: 'smooth', block: 'nearest' }));

  document.querySelector('#discover-tvs').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    tactile(button);
    button.disabled = true;
    button.textContent = 'Procurando…';
    discoveredTvs.replaceChildren();
    setSetupMessage('Pesquisando dispositivos Samsung na rede local…');
    try {
      const result = await api('/api/setup/discover');
      renderDevices(result.devices || []);
    } catch (error) {
      setSetupMessage(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Procurar TVs';
    }
  });

  document.querySelector('#connect-manual').addEventListener('click', (event) => connectTv(manualIp.value, event.currentTarget));
  manualIp.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      document.querySelector('#connect-manual').click();
    }
  });

  document.querySelector('#test-connection').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    tactile(button);
    button.disabled = true;
    button.textContent = 'Testando…';
    try {
      await api('/api/setup/test', { method: 'POST' });
      button.textContent = 'Controle funcionando';
      setSetupMessage('Teste concluído: o volume da TV foi aumentado.', 'success');
    } catch (error) {
      button.textContent = 'TV indisponível';
      setSetupMessage(error.message, 'error');
    }
    setTimeout(() => {
      button.disabled = false;
      button.textContent = 'Testar controle atual';
    }, 1800);
  });

  document.querySelectorAll('.launch-app').forEach((button) => button.addEventListener('pointerdown', async (event) => {
    event.preventDefault();
    tactile(button);
    button.classList.add('sending');
    try {
      await api(`/api/app/${encodeURIComponent(button.dataset.app)}`, { method: 'POST' });
    } catch (error) {
      showError(error.message || 'Não foi possível abrir o aplicativo');
    } finally {
      button.classList.remove('sending');
    }
  }));

  window.VantRemote = { sendKey, tactile, showError, connectTv };
  loadTvInfo();
  updateStatus();
  setInterval(updateStatus, 10000);
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js'));
  }
})();
