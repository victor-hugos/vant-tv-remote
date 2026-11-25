'use strict';

const ALLOWED_KEYS = Object.freeze([
  'KEY_VOLUP',
  'KEY_VOLDOWN',
  'KEY_MUTE',
  'KEY_CHUP',
  'KEY_CHDOWN',
  'KEY_HOME',
  'KEY_RETURN',
  'KEY_UP',
  'KEY_DOWN',
  'KEY_LEFT',
  'KEY_RIGHT',
  'KEY_ENTER',
  'KEY_PLAY',
  'KEY_PAUSE',
  'KEY_REWIND',
  'KEY_FF',
  'KEY_POWER',
]);

const allowedKeySet = new Set(ALLOWED_KEYS);

function isAllowedKey(key) {
  return typeof key === 'string' && allowedKeySet.has(key);
}

module.exports = { ALLOWED_KEYS, isAllowedKey };
