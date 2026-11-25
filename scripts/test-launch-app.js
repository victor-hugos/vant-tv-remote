'use strict';

const WebSocket = require('ws');

const apps = Object.freeze({
  youtube: { appId: '111299001912', appType: 2 },
  netflix: { appId: '11101200001', appType: 2 },
  prime: { appId: '3201512006785', appType: 2 },
});
const appName = process.argv[2];
const app = apps[appName];

if (!app) {
  console.error('Use: node scripts/test-launch-app.js youtube|netflix|prime');
  process.exit(1);
}

const name = Buffer.from('VANT Remote').toString('base64');
const url = 'ws://192.168.0.146:8001/api/v2/channels/'
  + `samsung.remote.control?name=${encodeURIComponent(name)}`;
const socket = new WebSocket(url, { handshakeTimeout: 5000 });
let launched = false;

const timeout = setTimeout(() => {
  console.log(`[launch] timeout aguardando resposta de ${appName}`);
  socket.close();
}, 10000);

socket.on('message', (raw) => {
  let message;
  try { message = JSON.parse(raw.toString('utf8')); } catch { return; }
  console.log(`[event] ${message.event || 'sem-evento'} ${JSON.stringify(message.data || {})}`);

  if (message.event === 'ms.channel.connect' && !launched) {
    launched = true;
    socket.send(JSON.stringify({
      method: 'ms.channel.emit',
      params: {
        event: 'ed.apps.launch',
        to: 'host',
        data: {
          appId: app.appId,
          action_type: app.appType === 2 ? 'DEEP_LINK' : 'NATIVE_LAUNCH',
          metaTag: '',
        },
      },
    }));
    console.log(`[launch] ${appName} appId=${app.appId} enviado`);
  }

  if (message.event === 'ed.apps.launch') {
    clearTimeout(timeout);
    setTimeout(() => socket.close(), 500);
  }
});

socket.on('error', (error) => {
  clearTimeout(timeout);
  console.error(`[launch] erro: ${error.message}`);
  process.exitCode = 2;
});

socket.on('close', () => clearTimeout(timeout));
