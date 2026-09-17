// src/checks/index.js
// Registro de checks.
//
// Los checks son independientes: cada uno zapea al canal por su número,
// lo que devuelve el deco al LIVE y borra el estado del check anterior.
// Verificado en hardware. Por eso se ejecutan en el orden que llegan
// en el input, sin reordenar.

const live = require('./live');
const epg = require('./epg');
const startOver = require('./startOver');
const catchup = require('./catchup');

const REGISTRY = { live, epg, startOver, catchup };

const ALL = Object.keys(REGISTRY);

// Resuelve los nombres del input a los módulos a ejecutar.
// Respeta el orden del input. Los nombres desconocidos se ignoran con
// warning: si Python pide un check que esta versión no tiene, es mejor
// ejecutar el resto que abortar toda la verificación.
function resolve(requested) {
  if (!Array.isArray(requested) || requested.length === 0) {
    logger.warn('[checks] input.checks vacío — se ejecutan todos');
    requested = ALL;
  }

  const unknown = requested.filter(name => !REGISTRY[name]);
  if (unknown.length > 0) {
    logger.warn(`[checks] checks desconocidos ignorados: ${unknown.join(', ')}`);
  }

  return requested
    .filter(name => REGISTRY[name])
    .map(name => ({ name, module: REGISTRY[name] }));
}

// ¿Pidió Python que se reporte el resultado del zapeo?
// El zapeo siempre se ejecuta, pero solo aparece en el reporte
// si 'live' está en la lista.
function reportsLive(requested) {
  return Array.isArray(requested) && requested.includes('live');
}

module.exports = { REGISTRY, ALL, resolve, reportsLive };