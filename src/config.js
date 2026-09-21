// src/config.js
// Parámetros ajustables. Se pueden sobrescribir desde
// launcher.js.input.json, en el campo "config".

const DEFAULTS = {
  // Intentos para llegar al canal pedido
  zapAttempts: 3,

  // Cuánto esperar la línea "go to channel" tras mandar los números
  zapConfirmTimeoutMs: 5000,

  // Pausa tras confirmar el zapeo, para que el video cargue antes de
  // que el check empiece a navegar
  zapSettleMs: 2500
};

function load() {
  const overrides = (typeof input !== 'undefined' && input && input.config) || {};
  return Object.assign({}, DEFAULTS, overrides);
}

module.exports = { DEFAULTS, load };