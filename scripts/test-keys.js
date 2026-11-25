'use strict';

const keys = [
  ['Volume +', 'KEY_VOLUP'],
  ['Volume -', 'KEY_VOLDOWN'],
  ['Mute', 'KEY_MUTE'],
  ['Canal +', 'KEY_CHUP'],
  ['Canal -', 'KEY_CHDOWN'],
  ['Home', 'KEY_HOME'],
  ['Voltar', 'KEY_RETURN'],
  ['Seta cima', 'KEY_UP'],
  ['Seta baixo', 'KEY_DOWN'],
  ['Seta esquerda', 'KEY_LEFT'],
  ['Seta direita', 'KEY_RIGHT'],
  ['OK', 'KEY_ENTER'],
];

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3001';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`Testando ${keys.length} teclas via ${baseUrl}`);
  console.log('KEY_POWER foi excluída intencionalmente.');
  for (const [label, key] of keys) {
    try {
      const response = await fetch(`${baseUrl}/api/key/${key}`, { method: 'POST' });
      const result = await response.json();
      console.log(`${label.padEnd(15)} ${response.ok && result.ok ? 'ENVIADO' : `ERRO: ${result.error}`}`);
    } catch (error) {
      console.log(`${label.padEnd(15)} ERRO: ${error.message}`);
    }
    await pause(1200);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
