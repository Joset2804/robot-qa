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
  zapSettleMs: 2500,

  // Pausa tras presionar HOME al salir de YouTube o Netflix, para que
  // el launcher termine de cargar antes de zapear
  homeRecoveryWaitMs: 4000,

  // Intentos de abrir el miniguide y leer el título del programa
  epgReadAttempts: 5,

  // Intentos de dejar el miniguide cerrado y volver a abrirlo con OK
  navAttempts: 3,

  // Segundos que se deja reproducir el Start Over antes de salir
  startOverPlaySec: 20,

  // Si el Start Over no arrancó, se espera a completar este tiempo desde
  // el inicio del check antes de la segunda prueba
  startOverMinLiveSec: 60,

  // Navegación de catchup
  catchupGuideOpenMs: 3500,     // LEFT → aparece la lista de canales y programas
  catchupStepMs: 2500,          // tras UP y tras el segundo LEFT
  catchupDetailTimeoutMs: 8000, // máximo esperando el botón "Reproducir"

  // Segundos que se deja reproducir el catchup antes de salir
  catchupPlaySec: 20,

  // Diferencia horaria de la sonda respecto a UTC, para el nombre del
  // archivo NDJSON y la hora de las alertas de Telegram.
  // Chile: -3 en verano, -4 en invierno. Perú: -5.
  // Los campos del NDJSON quedan en UTC: son comparables entre sondas
  // y no se rompen con el cambio de horario.
  utcOffset: -3,
};

function load() {
  const overrides = (typeof input !== 'undefined' && input && input.config) || {};
  return Object.assign({}, DEFAULTS, overrides);
}

module.exports = { DEFAULTS, load };