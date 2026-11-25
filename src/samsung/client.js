'use strict';

const http = require('http');
const WebSocket = require('ws');

class SamsungClient {
  constructor(config, options = {}) {
    this.config = config;
    this.connectTimeoutMs = options.connectTimeoutMs || 5000;
    this.sendTimeoutMs = options.sendTimeoutMs || 5000;
    this.socket = null;
    this.connectPromise = null;
    this.authorized = false;
    this.lastError = null;
    this.lastConnectedAt = null;
  }

  get url() {
    const name = Buffer.from(this.config.clientName, 'utf8').toString('base64');
    const params = new URLSearchParams({ name });
    if (this.config.token) params.set('token', String(this.config.token));
    return `${this.config.protocol}://${this.config.host}:${this.config.port}`
      + `/api/v2/channels/samsung.remote.control?${params}`;
  }

  async connect() {
    if (this.authorized && this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      const isSecure = this.config.protocol === 'wss';
      const socket = new WebSocket(this.url, {
        handshakeTimeout: this.connectTimeoutMs,
        rejectUnauthorized: !isSecure,
      });
      this.socket = socket;

      const timer = setTimeout(() => {
        fail(new Error('Tempo esgotado ao conectar/autorização da TV'));
        socket.terminate();
      }, this.connectTimeoutMs);

      const cleanupPending = () => clearTimeout(timer);
      const fail = (error) => {
        this.lastError = error.message;
        this.authorized = false;
        cleanupPending();
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      socket.on('message', (raw) => {
        let message;
        try { message = JSON.parse(raw.toString('utf8')); } catch { return; }

        if (message.event === 'ms.channel.unauthorized') {
          fail(new Error('TV não autorizou o dispositivo VANT Remote'));
          return;
        }

        if (message.event === 'ms.channel.connect') {
          if (message?.data?.token) {
            this.config.token = String(message.data.token);
          }
          this.authorized = true;
          this.lastError = null;
          this.lastConnectedAt = new Date().toISOString();
          cleanupPending();
          if (!settled) {
            settled = true;
            resolve();
          }
        }
      });

      socket.on('error', fail);
      socket.on('close', () => {
        this.authorized = false;
        if (this.socket === socket) this.socket = null;
        if (!settled) fail(new Error('TV fechou a conexão antes de autorizar'));
      });
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  async sendKey(key) {
    await this.connect();
    const payload = JSON.stringify({
      method: 'ms.remote.control',
      params: {
        Cmd: 'Click',
        DataOfCmd: key,
        Option: 'false',
        TypeOfRemote: 'SendRemoteKey',
      },
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Tempo esgotado ao enviar comando')), this.sendTimeoutMs);
      this.socket.send(payload, (error) => {
        clearTimeout(timer);
        if (error) {
          this.lastError = error.message;
          reject(error);
          return;
        }
        resolve({ key, sent: true });
      });
    });
  }

  async sendText(text) {
    await this.connect();
    const payloads = [
      { method: 'ms.channel.emit', params: { event: 'custom.remote.textReceived', to: 'broadcast' } },
      {
        method: 'ms.remote.control',
        params: {
          Cmd: Buffer.from(text, 'utf8').toString('base64'),
          DataOfCmd: 'base64',
          TypeOfRemote: 'SendInputString',
        },
      },
      { method: 'ms.remote.control', params: { TypeOfRemote: 'SendInputEnd' } },
    ];
    for (const payload of payloads) await this.sendPayload(payload);
    return { sent: true };
  }

  async moveMouse(x, y) {
    await this.connect();
    await this.sendPayload({
      method: 'ms.remote.control',
      params: {
        Cmd: 'Move',
        Position: { x, y, Time: String(Date.now() / 1000) },
        TypeOfRemote: 'ProcessMouseDevice',
      },
    });
    return { x, y, sent: true };
  }

  async clickMouse(button = 'left') {
    await this.connect();
    await this.sendPayload({
      method: 'ms.remote.control',
      params: {
        Cmd: button === 'right' ? 'RightClick' : 'LeftClick',
        TypeOfRemote: 'ProcessMouseDevice',
      },
    });
    return { button, sent: true };
  }

  sendPayload(payload) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Tempo esgotado ao enviar dados')), this.sendTimeoutMs);
      this.socket.send(JSON.stringify(payload), (error) => {
        clearTimeout(timer);
        if (error) {
          this.lastError = error.message;
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async launchApp(app) {
    await this.connect();
    const payload = JSON.stringify({
      method: 'ms.channel.emit',
      params: {
        event: 'ed.apps.launch',
        to: 'host',
        data: {
          appId: app.id,
          action_type: app.actionType,
          metaTag: '',
        },
      },
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Tempo esgotado ao abrir aplicativo')), this.sendTimeoutMs);
      this.socket.send(payload, (error) => {
        clearTimeout(timer);
        if (error) {
          this.lastError = error.message;
          reject(error);
          return;
        }
        resolve({ app: app.name, sent: true });
      });
    });
  }

  async probe(timeoutMs = 2000) {
    return new Promise((resolve) => {
      const request = http.get({
        host: this.config.host,
        port: 8001,
        path: '/api/v2/',
        timeout: timeoutMs,
      }, (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      });
      request.on('timeout', () => { request.destroy(); resolve(false); });
      request.on('error', () => resolve(false));
    });
  }

  close() {
    if (this.socket) this.socket.close(1000, 'servidor encerrando');
  }
}

module.exports = { SamsungClient };
