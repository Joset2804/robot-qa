// src/measurement/mediaOpenWatcher.js
// Detección de video y audio sobre el HDMI del deco.
//
// La sonda expone dos analizadores en tiempo real:
//   - frameAnalyzer: emite freezeStart / freezeEnd (congelados y negros)
//   - audioAnalyzer: emite silenceStart / silenceEnd
//
// El watcher los escucha y considera que el contenido cargó cuando TANTO
// el video COMO el audio llevan min_time_in_motion estables.
//
// DIFERENCIA CLAVE con el proyecto anterior: al fallar devuelve el objeto
// completo (con videoAt y soundAt) en vez de false, para poder distinguir
// si faltó el audio, el video o ambos.

const analyzers = {
  frame: devices.STB0.videoGrabbers.HDMI.frameAnalyzers.freezes,
  audio: devices.STB0.videoGrabbers.HDMI.audioAnalyzers.Silence
};

// Zonas de la pantalla que el analizador de video debe ignorar.
// Son áreas que están naturalmente quietas (logos, overlays, reloj) y que
// sin estas máscaras se detectarían como freezes falsos.
// Formato: [x, y, ancho, alto] en píxeles.
const ZAP_MASKS = [
  [592, 311, 100, 100],
  [107, 504, 1062, 197],
  [1083, 45, 146, 56]
];

class MediaOpenWatcher {

  constructor(options = {}) {
    this.name = 'MediaOpenWatcher';

    // Tiempo máximo de espera antes de declarar fallo.
    this.maxWaitMs = options.maxWaitMs || 18000;

    // Tiempo que video y audio deben estar estables para contar como cargado.
    // 1.5s es el valor validado contra el comportamiento real del deco:
    // más corto da falsos positivos (confunde un logo fijo con contenido),
    // más largo da falsos negativos (una escena estática parece un freeze).
    this.minStableMs = options.minStableMs || 1500;

    // Freezes más cortos que esto se ignoran como ruido.
    this.minFreezeMs = options.minFreezeMs || 100;

    // Nivel de negrura (0-100) para clasificar un freeze como pantalla negra.
    this.minBlackness = options.minBlackness || 75;

    this.masks = options.masks || ZAP_MASKS;
  }

  // Momento en que se envió la tecla. Los eventos anteriores se descartan.
  setTriggerDate(date) {
    this.triggerDate = date;
  }

  async do() {
    this.originalConfig = analyzers.frame.config;

    // Aplicar las máscaras al analizador de video
    try {
      const config = { ...this.originalConfig, masks: this.masks };
      await analyzers.frame.setConfig(config);
    } catch (err) {
      logger.warn(`[${this.name}] no se pudieron aplicar las máscaras: ${err}`);
    }

    return new Promise((resolve) => {

      // Estado del video
      const videoEvents = [];
      let lastFreezeStart;
      let lastEventWasFreezeEnd = false;
      let videoStableAt;
      let videoTimer;

      // Estado del audio
      const audioEvents = [];
      let lastSilenceStart;
      let lastEventWasSilenceEnd = false;
      let audioStableAt;
      let audioTimer;

      let resolved = false;

      // Helpers de estado

      const isVideoStable = () => videoStableAt !== undefined;
      const isAudioStable = () => audioStableAt !== undefined;

      // Descarta eventos anteriores al trigger y recorta los que lo cruzan.
      const trimToTrigger = (events) => {
        if (!this.triggerDate) return;

        let i = 0;
        while (i < events.length) {
          const ev = events[i];
          if (ev.to < this.triggerDate) {
            events.splice(i, 1);
          } else {
            if (ev.from < this.triggerDate) {
              ev.from = this.triggerDate;
              ev.duration = ev.to - ev.from;
            }
            i++;
          }
        }
      };

      // Determina si una secuencia de eventos muestra estabilización:
      // busca un hueco de al menos minStableMs entre el fin de un evento
      // y el inicio del siguiente (o el momento actual si es el último).
      const findStablePoint = (events, checkDate, lastWasEnd) => {
        trimToTrigger(events);
      
        if (!this.triggerDate) return undefined;
      
        for (let i = 0; i < events.length; i++) {
          const ev = events[i];
          const next = events[i + 1];
      
          if (!ev.to) continue;
      
          // El punto de estabilización tiene que ser posterior al trigger.
          // Sin este margen, un hueco que empezó antes del trigger y lo cruza
          // se tomaría como estabilización, dando duraciones imposibles
          // (ej: soundMs de 39ms tras presionar OK).
          if (ev.to.getTime() <= this.triggerDate.getTime()) continue;
      
          if (next) {
            if (next.to - ev.to >= this.minStableMs) return ev.to;
          } else if (lastWasEnd && checkDate) {
            if (checkDate - ev.to >= this.minStableMs) return ev.to;
          }
        }
      
        return undefined;
      };

      // Cierra un evento que quedó abierto al terminar el monitoreo.
      const closePending = (events, lastStart, lastWasEnd, isVideo) => {
        if (lastStart && !lastWasEnd) {
          const ev = { ...lastStart };
          ev.to = new Date();
          ev.duration = ev.to - ev.from;
          if (isVideo) {
            ev.mnemonic = ev.blackness >= this.minBlackness ? 'B+' : 'F+';
          }
          events.push(ev);
        }
      };

      // Construcción del resultado

      const sumDuration = (events, filter) => events
        .filter(filter || (() => true))
        .reduce((acc, ev) => acc + ev.duration, 0);

      const buildResult = (ok) => {
        const trigger = this.triggerDate;

        // El contenido está listo cuando AMBOS estabilizaron, así que
        // durationMs es el mayor de los dos momentos. Usar solo el video
        // daba duraciones menores que soundMs, lo cual es imposible.
        let stableAt;
        if (videoStableAt && audioStableAt) {
          stableAt = videoStableAt.getTime() > audioStableAt.getTime()
            ? videoStableAt
            : audioStableAt;
        }

        return {
          ok,
          videoAt: videoStableAt,
          soundAt: audioStableAt,
      
          durationMs: (ok && stableAt && trigger)
            ? stableAt.getTime() - trigger.getTime()
            : undefined,
      
          soundMs: (audioStableAt && trigger)
            ? audioStableAt.getTime() - trigger.getTime()
            : undefined,    

          // Tiempo acumulado de pantalla negra y de congelados
          blackMs: sumDuration(videoEvents, ev => ev.mnemonic === 'B' || ev.mnemonic === 'B+'),
          freezeMs: sumDuration(videoEvents, ev => ev.mnemonic === 'F' || ev.mnemonic === 'F+'),
          silenceMs: sumDuration(audioEvents),

          // Secuencia de lo que pasó en el video, útil para diagnóstico.
          // Ej: ['B', 'F', 'F'] = negro, luego dos congelados.
          dynamics: videoEvents.map(ev => ev.mnemonic)
        };
      };

      // Limpieza

      const detachListeners = () => {
        analyzers.frame.removeListener('freezeStart', onFreeze);
        analyzers.frame.removeListener('freezeEnd', onFreeze);
        analyzers.audio.removeListener('silenceStart', onSilenceStart);
        analyzers.audio.removeListener('silenceEnd', onSilenceEnd);
      };

      const restoreMasks = () => {
        analyzers.frame.setConfig(this.originalConfig)
          .catch(err => logger.warn(`[${this.name}] error restaurando máscaras: ${err}`));
      };

      const finish = (ok) => {
        if (resolved) return;
        resolved = true;

        clearTimeout(videoTimer);
        clearTimeout(audioTimer);
        detachListeners();

        closePending(videoEvents, lastFreezeStart, lastEventWasFreezeEnd, true);
        closePending(audioEvents, lastSilenceStart, lastEventWasSilenceEnd, false);

        resolve(buildResult(ok));
        restoreMasks();
      };

      // Comprueba si ya podemos declarar éxito.
      const checkStable = (videoCheckDate, audioCheckDate) => {
        if (resolved) return;
        if (!this.triggerDate) return;

        const now = new Date();

        if (!isVideoStable()) {
          videoStableAt = findStablePoint(
            videoEvents, videoCheckDate || now, lastEventWasFreezeEnd
          );
        }

        if (!isAudioStable()) {
          audioStableAt = findStablePoint(
            audioEvents, audioCheckDate || now, lastEventWasSilenceEnd
          );
        }

        if (isVideoStable() && isAudioStable()) {
          logger.debug(`[${this.name}] video y audio estables`);
          finish(true);
        }
      };

      // Listeners de los analizadores

      // El frameAnalyzer usa el mismo evento para inicio y fin de freeze;
      // se distinguen porque solo freezeEnd trae "duration".
      const onFreeze = (ev) => {
        // Sin trigger definido todavía no sabemos qué es "después del zapeo".
        // Procesar eventos ahora puede resolver la estabilización con datos
        // de la navegación previa, dando duraciones imposibles.
        if (!this.triggerDate) return;

        if (!ev.duration) {
          // freezeStart
          clearTimeout(videoTimer);
          lastEventWasFreezeEnd = false;
          lastFreezeStart = ev;
          if (videoEvents.length > 0) checkStable(ev.from, undefined);

        } else {
          // freezeEnd
          lastEventWasFreezeEnd = true;

          const event = { ...ev };
          event.mnemonic = ev.blackness >= this.minBlackness ? 'B' : 'F';
          if (event.duration >= this.minFreezeMs) videoEvents.push(event);

          if (!isVideoStable()) {
            videoTimer = setTimeout(
              () => checkStable(new Date(), undefined),
              this.minStableMs + 1000
            );
          }
        }
      };

      const onSilenceStart = (ev) => {
        if (!this.triggerDate) return;
        clearTimeout(audioTimer);
        lastEventWasSilenceEnd = false;
        lastSilenceStart = ev;
        if (audioEvents.length > 0) checkStable(undefined, ev.from);
      };

      const onSilenceEnd = (ev) => {
        if (!this.triggerDate) return;
        lastEventWasSilenceEnd = true;

        const event = { ...ev };
        if (event.duration >= this.minFreezeMs) audioEvents.push(event);

        if (!isAudioStable()) {
          audioTimer = setTimeout(
            () => checkStable(undefined, new Date()),
            this.minStableMs + 1000
          );
        }
      };

      // Arranque
      analyzers.frame.on('freezeStart', onFreeze);
      analyzers.frame.on('freezeEnd', onFreeze);
      analyzers.audio.on('silenceStart', onSilenceStart);
      analyzers.audio.on('silenceEnd', onSilenceEnd);

      // Límite de seguridad: si no estabilizó, cerrar con lo que haya.
      setTimeout(() => {
        if (resolved) return;

        const now = new Date();
        if (!isVideoStable()) {
          videoStableAt = findStablePoint(videoEvents, now, lastEventWasFreezeEnd);
        }
        if (!isAudioStable()) {
          audioStableAt = findStablePoint(audioEvents, now, lastEventWasSilenceEnd);
        }

        const ok = isVideoStable() && isAudioStable();
        if (!ok) {
          logger.debug(`[${this.name}] tiempo agotado — video:${isVideoStable()} audio:${isAudioStable()}`);
        }

        finish(ok);
      }, this.maxWaitMs);
    });
  }
}

// Ejecuta una acción sobre el deco y mide si el resultado tiene video y audio.
//
// El orden importa: el watcher se arranca ANTES de la acción, porque si
// la tecla se enviara primero podríamos perder los primeros eventos.
//
// @param triggerFn función async que envía la tecla y devuelve su timestamp
// @param options   opciones del watcher
// @returns el objeto de resultado — SIEMPRE, incluso al fallar
async function measure(triggerFn, options = {}) {
  const watcher = new MediaOpenWatcher(options);

  // Arrancar el monitoreo sin esperarlo: queda escuchando en segundo plano
  const pending = watcher.do();

  let triggerDate;
  try {
    triggerDate = await triggerFn();
  } catch (err) {
    logger.error(`[measure] error ejecutando la acción: ${err}`);
    watcher.setTriggerDate(new Date());
    return pending;
  }

  watcher.setTriggerDate(triggerDate);

  return pending;
}

module.exports = { MediaOpenWatcher, measure };