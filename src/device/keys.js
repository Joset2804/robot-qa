// src/device/keys.js
// Envío de teclas al deco vía ADB.
// No usa Appium — solo manda pulsaciones. Leer la pantalla es tarea de ui.js.
//
// sendInput devuelve un objeto con "from" (cuándo empezó a enviar) y
// "to" (cuándo terminó). Usamos "to" como timestamp del disparo porque
// es el momento en que el deco recibió la señal.

// Códigos de tecla Android usados en los checks.
const KEYS = {
  OK: 'KEYCODE_DPAD_CENTER',
  UP: 'KEYCODE_DPAD_UP',
  DOWN: 'KEYCODE_DPAD_DOWN',
  LEFT: 'KEYCODE_DPAD_LEFT',
  RIGHT: 'KEYCODE_DPAD_RIGHT',
  HOME: 'KEYCODE_HOME'
};

// Pausa entre dígitos al marcar un número de canal.
// Sin esta pausa el deco puede perder dígitos.
const DIGIT_DELAY = 50;

// Envía una tecla y devuelve el timestamp en que el deco la recibió.
async function sendKey(keycode) {
  const event = await devices.STB0.remotes.ADB.sendInput(`keyevent ${keycode}`);
  return new Date(event.to);
}

// Atajos para las teclas de navegación.
const ok = () => sendKey(KEYS.OK);
const up = () => sendKey(KEYS.UP);
const down = () => sendKey(KEYS.DOWN);
const left = () => sendKey(KEYS.LEFT);
const right = () => sendKey(KEYS.RIGHT);
const home = () => sendKey(KEYS.HOME);

// Marca un número de canal dígito por dígito y confirma con OK.
// Devuelve el timestamp del OK final, que es el momento del zapeo real.
async function zapToChannel(channelNumber) {
  const digits = `${channelNumber}`.split('');

  for (const digit of digits) {
    await devices.STB0.remotes.ADB.sendInput(`keyevent KEYCODE_${digit}`);
    await sleep(DIGIT_DELAY);
  }

  return sendKey(KEYS.OK);
}

module.exports = {
  KEYS,
  sendKey,
  ok,
  up,
  down,
  left,
  right,
  home,
  zapToChannel
};