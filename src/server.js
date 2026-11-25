'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { host, port, publicDir, loadTvConfig, saveTvConfig } = require('./config');
const { SamsungClient } = require('./samsung/client');
const { ALLOWED_KEYS, isAllowedKey } = require('./samsung/keys');
const { getApp } = require('./samsung/apps');
const { discoverSamsungTvs, fetchTvInfo, isPrivateIpv4 } = require('./samsung/discovery');

let tvConfig = loadTvConfig();
let samsung = new SamsungClient(tvConfig);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

function requestIp(request) {
  return (request.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

function isLocalRequest(request) {
  const ip = requestIp(request);
  return ip === '127.0.0.1' || ip === '::1' || isPrivateIpv4(ip);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 16384) {
        reject(new Error('Dados enviados excedem o limite'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('JSON inválido')); }
    });
    request.on('error', reject);
  });
}

function publicTvConfig(config = tvConfig) {
  return {
    host: config.host,
    mac: config.mac || null,
    model: config.model,
    protocol: config.protocol,
    port: config.port,
    paired: Boolean(config.token || config.protocol === 'ws'),
  };
}

async function pairTv(hostname) {
  if (!isPrivateIpv4(hostname)) throw new Error('Informe um IP válido da rede local');
  const details = await fetchTvInfo(hostname);
  if (!details) throw new Error('Nenhuma TV Samsung respondeu nesse IP');

  const candidateConfig = {
    host: hostname,
    mac: details.mac || (hostname === tvConfig.host ? tvConfig.mac : null),
    model: details.model || 'Samsung TV',
    clientName: tvConfig.clientName || 'VANT Remote',
    protocol: details.protocol || 'ws',
    port: details.port || 8001,
    token: hostname === tvConfig.host ? tvConfig.token : null,
  };
  const candidate = new SamsungClient(candidateConfig, { connectTimeoutMs: 30000 });
  await candidate.connect();
  saveTvConfig(candidateConfig);
  samsung.close();
  tvConfig = candidateConfig;
  samsung = candidate;
  return publicTvConfig();
}

async function handleApi(request, response, pathname) {
  if (pathname.startsWith('/api/setup/') && !isLocalRequest(request)) {
    json(response, 403, { ok: false, error: 'Configuração permitida apenas pela rede local' });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/setup/current') {
    json(response, 200, { ok: true, tv: publicTvConfig() });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/setup/discover') {
    try {
      const devices = await discoverSamsungTvs(tvConfig.host);
      json(response, 200, { ok: true, devices });
    } catch (error) {
      json(response, 503, { ok: false, error: error.message || 'Não foi possível pesquisar a rede' });
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/api/setup/connect') {
    try {
      const body = await readJson(request);
      const configured = await pairTv(String(body.host || '').trim());
      json(response, 200, { ok: true, tv: configured });
    } catch (error) {
      json(response, 400, { ok: false, error: error.message || 'Não foi possível configurar a TV' });
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/api/setup/test') {
    try {
      await samsung.sendKey('KEY_VOLUP');
      json(response, 200, { ok: true, key: 'KEY_VOLUP' });
    } catch (error) {
      json(response, 503, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === 'GET' && pathname === '/api/status') {
    const online = await samsung.probe();
    json(response, 200, {
      server: 'online',
      tv: online ? 'online' : 'offline',
      tvIp: tvConfig.host,
      model: tvConfig.model.replace(/^Samsung\s+/i, ''),
      websocket: samsung.authorized ? 'connected' : 'idle',
      lastConnectedAt: samsung.lastConnectedAt,
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/tv') {
    json(response, 200, {
      ip: tvConfig.host,
      mac: tvConfig.mac,
      model: tvConfig.model,
      protocol: tvConfig.protocol,
      port: tvConfig.port,
      allowedKeys: ALLOWED_KEYS,
    });
    return;
  }

  const keyMatch = pathname.match(/^\/api\/key\/([^/]+)$/);
  if (request.method === 'POST' && keyMatch) {
    const key = decodeURIComponent(keyMatch[1]);
    if (!isAllowedKey(key)) {
      json(response, 400, { ok: false, error: 'Comando não permitido' });
      return;
    }
    try {
      await samsung.sendKey(key);
      json(response, 200, { ok: true, key });
    } catch (error) {
      json(response, 503, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/api/power') {
    try {
      await samsung.sendKey('KEY_POWER');
      json(response, 200, { ok: true, key: 'KEY_POWER' });
    } catch (error) {
      json(response, 503, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/api/text') {
    try {
      const body = await readJson(request);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) throw new Error('Digite um texto para enviar');
      if ([...text].length > 200) throw new Error('O texto deve ter no máximo 200 caracteres');
      if (/[^\P{Cc}\n\t]/u.test(text)) throw new Error('O texto contém caracteres inválidos');
      await samsung.sendText(text);
      json(response, 200, { ok: true });
    } catch (error) {
      json(response, 400, { ok: false, error: error.message || 'Não foi possível enviar o texto' });
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/api/mouse') {
    try {
      const body = await readJson(request);
      if (body.action === 'move') {
        const x = Math.trunc(Number(body.x));
        const y = Math.trunc(Number(body.y));
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Movimento inválido');
        if (Math.abs(x) > 300 || Math.abs(y) > 300) throw new Error('Movimento fora do limite');
        await samsung.moveMouse(x, y);
        json(response, 200, { ok: true, action: 'move' });
        return;
      }
      if (body.action === 'click') {
        const button = body.button === 'right' ? 'right' : 'left';
        await samsung.clickMouse(button);
        json(response, 200, { ok: true, action: 'click', button });
        return;
      }
      throw new Error('Ação de mouse inválida');
    } catch (error) {
      json(response, 400, { ok: false, error: error.message || 'Não foi possível controlar o mouse' });
    }
    return;
  }

  const appMatch = pathname.match(/^\/api\/app\/([^/]+)$/);
  if (request.method === 'POST' && appMatch) {
    const app = getApp(decodeURIComponent(appMatch[1]));
    if (!app) {
      json(response, 400, { ok: false, error: 'Aplicativo não permitido' });
      return;
    }
    try {
      await samsung.launchApp(app);
      json(response, 200, { ok: true, app: app.name });
    } catch (error) {
      json(response, 503, { ok: false, error: error.message });
    }
    return;
  }

  json(response, 404, { ok: false, error: 'Endpoint não encontrado' });
}

function serveStatic(response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(publicDir, `.${requested}`);
  if (!filePath.startsWith(`${publicDir}${path.sep}`)) {
    json(response, 403, { error: 'Acesso negado' });
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      json(response, error.code === 'ENOENT' ? 404 : 500, { error: 'Arquivo não encontrado' });
      return;
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': filePath.endsWith('service-worker.js') ? 'no-cache' : 'public, max-age=300',
    });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url.pathname);
    } else {
      serveStatic(response, url.pathname);
    }
  } catch (error) {
    json(response, 500, { ok: false, error: 'Erro interno do servidor' });
    console.error(error);
  }
});

server.listen(port, host, () => {
  console.log(`VANT Remote disponível em http://${host}:${port}`);
});

function shutdown() {
  samsung.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
