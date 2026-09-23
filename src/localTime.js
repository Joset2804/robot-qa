// src/localTime.js
// Conversión a la hora local de la sonda, según config.utcOffset.
//
// Solo para lo que lee una persona: el nombre del archivo NDJSON y las
// alertas de Telegram. Los campos del NDJSON quedan en UTC.

const HOUR_MS = 3600000;

// Devuelve un Date desplazado, para poder leer sus partes en UTC
// como si fueran locales.
function shifted(date, utcOffset) {
  const base = date ? new Date(date) : new Date();
  const ms = base.getTime() + (utcOffset || 0) * HOUR_MS;
  return new Date(ms);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// yyyy-mm-dd
function localDate(date, utcOffset) {
  const d = shifted(date, utcOffset);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// dd/mm hh:mm
function localShort(date, utcOffset) {
  const d = shifted(date, utcOffset);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

module.exports = { localDate, localShort };