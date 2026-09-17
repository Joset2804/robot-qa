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
  UNEXPECTED_ERROR: 'unexpected_error'
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