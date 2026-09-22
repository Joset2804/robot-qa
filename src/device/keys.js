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
  HOME: 'KEYCODE_HOME',
  BACK: 'KEYCODE_BACK'
};

// Espacio mínimo entre dígitos. El deco pierde teclas si llegan casi
// juntas: mandarlas en una sola llamada ADB falló en 3 de 4 canales.
// Cada llamada ADB ya separa los dígitos ~160-250 ms por sí sola; este
// mínimo solo actúa si alguna llamada volviera inusualmente rápido.
const MIN_DIGIT_GAP_MS = 120;

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
const back = () => sendKey(KEYS.BACK);

// Marca el canal con una llamada ADB por dígito y confirma con OK.
// Probado: el deco acepta el número con los dígitos separados entre
// ~160 y ~600 ms. Devuelve el momento en que el deco recibió el OK.
async function zapToChannel(channelNumber) {
  const digits = `${channelNumber}`.split('');
  let lastSentAt = 0;

  for (const digit of digits) {
    const elapsed = Date.now() - lastSentAt;
    if (lastSentAt && elapsed < MIN_DIGIT_GAP_MS) {
      await sleep(MIN_DIGIT_GAP_MS - elapsed);
    }

    const ev = await devices.STB0.remotes.ADB.sendInput(`keyevent KEYCODE_${digit}`);
    lastSentAt = new Date(ev.to).getTime();
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
  back,
  zapToChannel
};