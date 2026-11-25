'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const tvConfigPath = path.join(projectRoot, 'config', 'tv.json');

function loadTvConfig() {
  return JSON.parse(fs.readFileSync(tvConfigPath, 'utf8'));
}

function saveTvConfig(config) {
  const temporaryPath = `${tvConfigPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, tvConfigPath);
}

module.exports = {
  projectRoot,
  publicDir: path.join(projectRoot, 'public'),
  tvConfigPath,
  loadTvConfig,
  saveTvConfig,
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),
};
