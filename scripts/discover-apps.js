'use strict';

const WebSocket = require('ws');

const name = Buffer.from('VANT Remote').toString('base64');
const url = 'ws://192.168.0.146:8001/api/v2/channels/'
  + `samsung.remote.control?name=${encodeURIComponent(name)}`;
const socket = new WebSocket(url, { handshakeTimeout: 5000 });
let receivedList = false;

const timeout = setTimeout(() => {
  console.log('[apps] timeout sem lista de aplicativos');
  socket.close();
}, 10000);

socket.on('message', (raw) => {
  let message;
  try { message = JSON.parse(raw.toString('utf8')); } catch { return; }
  console.log(JSON.stringify(message));

  if (message.event === 'ms.channel.connect') {
    socket.send(JSON.stringify({
      method: 'ms.channel.emit',
      params: { event: 'ed.installedApp.get', to: 'host' },
    }));
    console.log('[apps] ed.installedApp.get enviado');
  }

  if (message.event === 'ed.installedApp.get') {
    receivedList = true;
    clearTimeout(timeout);
    setTimeout(() => socket.close(), 300);
  }
});

socket.on('error', (error) => {
  clearTimeout(timeout);
  console.error(`[apps] erro: ${error.message}`);
  process.exitCode = 1;
});

socket.on('close', () => {
  clearTimeout(timeout);
  console.log(`[apps] lista recebida=${receivedList}`);
});
