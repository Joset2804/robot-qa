// src/results/reasons.js
// Códigos de fallo estables — contrato con el orquestador Python.
// Python hace lógica sobre estos valores (agrupar, priorizar, alertar),
// por lo que NUNCA deben cambiar sin coordinar el cambio del otro lado.
// El texto legible para humanos lo arma Python, no la sonda.

const REASONS = {

  // ── Omisiones: el check no se pudo ejecutar ───────────────────────

  // El canal no dio señal al sintonizarlo, así que no tiene sentido
  // probar EPG, Start Over ni CatchUp sobre él.
  CHANNEL_NOT_LIVE: 'channel_not_live',

  // El miniguide no apareció cuando se lo invocó con OK.
  // Sin miniguide no se puede leer el EPG ni llegar a Start Over.
  MINIGUIDE_TIMEOUT: 'miniguide_timeout',

  // El miniguide del zapeo no se cerró a tiempo.
  // CatchUp lo necesita cerrado: con él abierto el LEFT no abre la guía.
  MINIGUIDE_STUCK: 'miniguide_stuck',

  // La navegación hasta el contenido no llegó a destino
  // (guía rápida, programa anterior, pantalla de detalle).
  NAVIGATION_FAILED: 'navigation_failed',

  // ── Fallos de reproducción ────────────────────────────────────────

  // Hubo audio pero el video nunca se estabilizó.
  NO_VIDEO: 'no_video',

  // Hubo video pero el audio nunca volvió.
  NO_AUDIO: 'no_audio',

  // Ni video ni audio se estabilizaron.
  NO_VIDEO_NO_AUDIO: 'no_video_no_audio',

  // ── Fallos de EPG ─────────────────────────────────────────────────

  // El deco muestra explícitamente que no hay información de guía.
  NO_EPG: 'no_epg',

  // El campo del título existe pero está vacío.
  EMPTY_TITLE: 'empty_title',

  // El elemento del título no apareció en pantalla.
  TITLE_NOT_FOUND: 'title_not_found',

  // ── Errores inesperados ───────────────────────────────────────────

  // Excepción no prevista durante el check. El detalle va al log,
  // no al reporte, para que el contrato quede acotado.
  UNEXPECTED_ERROR: 'unexpected_error',

  // ── Errores de zapeo ────────────────────────────────────────────────

  // El deco no llegó al canal pedido tras todos los intentos de zapeo.
  // Es un problema de la automatización, no del canal: no alerta.
  ZAP_FAILED: 'zap_failed',

  // El deco quedó en otra app (YouTube, Netflix) y HOME no lo sacó.
  // Es un problema de la automatización, no del canal: no alerta.
  OUTSIDE_LAUNCHER: 'outside_launcher',

  // La salida no reportó ningún evento de reproducción: no se puede verificar.
  NO_PLAYBACK_LOG: 'no_playback_log',

  // Reprodujo otro modo (ej: catchup en vez de Start Over).
  WRONG_MODE: 'wrong_mode',

  // El número de la URL no coincide con el del canal: la navegación
  // cambió de canal.
  WRONG_CHANNEL: 'wrong_channel',

  // Con el programa ya avanzado, el Start Over siguió sin arrancar.
  STARTOVER_UNAVAILABLE: 'startover_unavailable',

  // Se presionó "Reproducir" y el deco siguió en el LIVE.
  CATCHUP_NOT_STARTED: 'catchup_not_started',

  // Tras navegar, no apareció el botón "Reproducir".
  PLAY_BUTTON_NOT_FOUND: 'play_button_not_found',
};

// Traduce el resultado del mediaOpenWatcher a un código de fallo.
// El watcher expone videoAt y soundAt: si uno quedó en undefined,
// esa parte nunca se estabilizó.
function reasonFromMediaResult(mediaResult) {
  if (!mediaResult) {
    return REASONS.NO_VIDEO_NO_AUDIO;
  }

  const hasVideo = !!mediaResult.videoAt;
  const hasAudio = !!mediaResult.soundAt;

  if (!hasVideo && !hasAudio) return REASONS.NO_VIDEO_NO_AUDIO;
  if (!hasVideo) return REASONS.NO_VIDEO;
  if (!hasAudio) return REASONS.NO_AUDIO;

  // Ambos presentes pero el watcher falló por otra razón
  return REASONS.UNEXPECTED_ERROR;
}

module.exports = { REASONS, reasonFromMediaResult };