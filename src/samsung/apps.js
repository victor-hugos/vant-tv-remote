'use strict';

const APPS = Object.freeze({
  youtube: Object.freeze({ id: '111299001912', name: 'YouTube', actionType: 'DEEP_LINK' }),
  netflix: Object.freeze({ id: '11101200001', name: 'Netflix', actionType: 'DEEP_LINK' }),
  prime: Object.freeze({ id: '3201512006785', name: 'Prime Video', actionType: 'DEEP_LINK' }),
});

function getApp(app) {
  return typeof app === 'string' ? APPS[app.toLowerCase()] : undefined;
}

module.exports = { APPS, getApp };
