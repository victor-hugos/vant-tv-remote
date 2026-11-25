'use strict';

const dgram = require('dgram');
const http = require('http');
const os = require('os');

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const SEARCH_TARGETS = [
  'urn:samsung.com:device:RemoteControlReceiver:1',
  'urn:schemas-upnp-org:device:MediaRenderer:1',
  'ssdp:all',
];

function isPrivateIpv4(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address?.family === 'IPv4' && !address.internal)
    .map((address) => address.address);
}

function fetchTvInfo(host, timeoutMs = 1600) {
  return new Promise((resolve) => {
    const request = http.get({ host, port: 8001, path: '/api/v2/', timeout: timeoutMs }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { if (raw.length < 65536) raw += chunk; });
      response.on('end', () => {
        try {
          const payload = JSON.parse(raw);
          const device = payload.device || {};
          resolve({
            host,
            name: device.name || payload.name || 'Samsung TV',
            model: device.modelName || device.model || 'Samsung TV',
            mac: device.wifiMac || null,
            protocol: 'ws',
            port: 8001,
          });
        } catch {
          resolve({ host, name: 'Samsung TV', model: 'Samsung TV', mac: null, protocol: 'ws', port: 8001 });
        }
      });
    });
    request.on('timeout', () => { request.destroy(); resolve(null); });
    request.on('error', () => resolve(null));
  });
}

function discoverHosts(timeoutMs = 2400) {
  return new Promise((resolve) => {
    const hosts = new Set();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const finish = () => {
      try { socket.close(); } catch {}
      resolve([...hosts]);
    };
    const timer = setTimeout(finish, timeoutMs);

    socket.on('message', (message, remote) => {
      const text = message.toString('utf8');
      if (/samsung|RemoteControlReceiver|MediaRenderer/i.test(text) && isPrivateIpv4(remote.address)) {
        hosts.add(remote.address);
      }
    });
    socket.on('error', () => { clearTimeout(timer); finish(); });
    socket.bind(0, () => {
      socket.setBroadcast(true);
      for (const target of SEARCH_TARGETS) {
        const message = Buffer.from([
          'M-SEARCH * HTTP/1.1',
          `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
          'MAN: "ssdp:discover"',
          'MX: 2',
          `ST: ${target}`,
          '', '',
        ].join('\r\n'));
        socket.send(message, SSDP_PORT, SSDP_ADDRESS);
      }
    });
  });
}

async function discoverSamsungTvs(currentHost) {
  const hosts = new Set(await discoverHosts());
  if (isPrivateIpv4(currentHost)) hosts.add(currentHost);
  const devices = await Promise.all([...hosts].map((host) => fetchTvInfo(host)));
  return devices.filter(Boolean).sort((a, b) => a.host.localeCompare(b.host));
}

module.exports = { discoverSamsungTvs, fetchTvInfo, isPrivateIpv4, localAddresses };
