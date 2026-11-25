'use strict';

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const CONFIG_PATH = path.resolve(__dirname, '../config/tv.json');
const KEY = 'KEY_VOLUP';
const CONNECT_TIMEOUT_MS = 30000;
const RESULT_WAIT_MS = 3000;

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveToken(config, token) {
  if (!token || config.token === token) return;
  const updated = { ...config, token: String(token) };
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(updated, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log('[token] recebido e salvo em config/tv.json');
}

function buildUrl(config) {
  const name = Buffer.from(config.clientName, 'utf8').toString('base64');
  const params = new URLSearchParams({ name });
  if (config.token) params.set('token', String(config.token));
  return `${config.protocol}://${config.host}:${config.port}`
    + `/api/v2/channels/samsung.remote.control?${params}`;
}

function remoteKeyPayload(key) {
  return JSON.stringify({
    method: 'ms.remote.control',
    params: {
      Cmd: 'Click',
      DataOfCmd: key,
      Option: 'false',
      TypeOfRemote: 'SendRemoteKey',
    },
  });
}

function safeEventForLog(message) {
  const copy = JSON.parse(JSON.stringify(message));
  if (copy?.data?.token) copy.data.token = '[REDACTED; salvo localmente]';
  return copy;
}

function main() {
  const config = loadConfig();
  const url = buildUrl(config);
  const isSecure = config.protocol === 'wss';
  let connected = false;
  let keySent = false;

  console.log(`[config] TV=${config.host} protocolo=${config.protocol} porta=${config.port}`);
  console.log(`[config] cliente="${config.clientName}" token=${config.token ? 'presente' : 'ausente'}`);
  console.log(`[websocket] conectando a ${url.replace(/token=[^&]+/, 'token=[REDACTED]')}`);

  const socket = new WebSocket(url, {
    handshakeTimeout: 10000,
    // A excecao ao certificado fica limitada exclusivamente a esta conexao WSS.
    rejectUnauthorized: !isSecure,
  });

  const timeout = setTimeout(() => {
    console.error('[timeout] autorização/conexão não concluída em 30 segundos');
    socket.terminate();
    process.exitCode = 2;
  }, CONNECT_TIMEOUT_MS);

  socket.on('open', () => {
    console.log('[websocket] transporte aberto; aguardando ms.channel.connect');
  });

  socket.on('message', (raw) => {
    const text = raw.toString('utf8');
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      console.log(`[evento] não JSON: ${text}`);
      return;
    }

    console.log(`[evento] ${JSON.stringify(safeEventForLog(message))}`);

    if (message.event === 'ms.channel.unauthorized') {
      console.error('[autorização] TV recusou ou ainda não autorizou este cliente');
      process.exitCode = 3;
      return;
    }

    if (message.event !== 'ms.channel.connect') return;

    connected = true;
    saveToken(config, message?.data?.token);
    if (keySent) return;

    socket.send(remoteKeyPayload(KEY), (error) => {
      if (error) {
        console.error(`[comando] falha ao enviar ${KEY}: ${error.message}`);
        process.exitCode = 4;
        return;
      }
      keySent = true;
      console.log(`[comando] ${KEY} enviado após autorização`);
      setTimeout(() => socket.close(1000, 'teste concluído'), RESULT_WAIT_MS);
    });
  });

  socket.on('unexpected-response', (_request, response) => {
    console.error(`[websocket] resposta HTTP inesperada: ${response.statusCode}`);
    process.exitCode = 5;
  });

  socket.on('error', (error) => {
    console.error(`[websocket] erro: ${error.message}`);
    process.exitCode = 6;
  });

  socket.on('close', (code, reason) => {
    clearTimeout(timeout);
    console.log(`[websocket] fechado código=${code} motivo="${reason.toString()}"`);
    console.log(`[resultado] conectado=${connected} comando_enviado=${keySent}`);
    if (!connected || !keySent) process.exitCode ||= 7;
  });
}

main();
