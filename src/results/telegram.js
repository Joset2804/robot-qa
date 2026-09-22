// src/results/telegram.js
// Alertas por Telegram. Se envía un mensaje por canal apenas termina,
// con sus checks fallidos.
//
// Solo alertan los "fail": los "skipped" son problemas de la
// automatización o casos que no se pudieron verificar.
//
// Un fallo de envío nunca interrumpe la ejecución.

const https = require('https');
const os = require('os');
const { REASONS } = require('./reasons');

const TIMEOUT_MS = 10000;

// Texto legible para cada código. El código queda en el NDJSON;
// acá va lo que lee una persona.
const REASON_TEXT = {
  [REASONS.NO_VIDEO]: 'sin video',
  [REASONS.NO_AUDIO]: 'sin audio',
  [REASONS.NO_VIDEO_NO_AUDIO]: 'sin video ni audio',
  [REASONS.NO_EPG]: 'sin información de guía',
  [REASONS.EMPTY_TITLE]: 'título de programa vacío',
  [REASONS.NO_CATCHUP_AVAILABLE]: 'el programa anterior no ofrece catchup',
  [REASONS.UNEXPECTED_ERROR]: 'error inesperado'
};

const CHECK_LABEL = {
  live: 'live',
  epg: 'epg',
  startOver: 'startOver',
  catchup: 'catchup'
};

function describe(reason) {
  return REASON_TEXT[reason] || reason || 'sin detalle';
}

// dd/mm hh:mm en hora local de la sonda
function shortTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function send(config, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chat_id: config.chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${config.botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: TIMEOUT_MS
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) resolve();
        else reject(new Error(`status ${res.statusCode}: ${data}`));
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });

    req.write(body);
    req.end();
  });
}

// Telegram interpreta < > & como HTML: hay que escaparlos para que
// un nombre de canal con esos caracteres no rompa el mensaje.
function escape(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Envía la alerta de un canal, si tiene checks fallidos.
// entry es lo que devuelve runChannel.
async function alertChannel(entry, config) {
  if (!config || !config.enabled || !config.botToken || !config.chatId) return;

  const lines = Object.keys(entry.checks)
    .filter(name => entry.checks[name].status === 'fail')
    .map(name => {
      const label = CHECK_LABEL[name] || name;
      return `▸ <b>${escape(label)}</b> — ${escape(describe(entry.checks[name].reason))}`;
    });

  if (lines.length === 0) return;

  const name = entry.channelName ? ` · ${escape(entry.channelName)}` : '';
  const header = `⚠️ <b>Canal ${entry.channel}${name}</b>`;
  const meta = `<i>${escape(os.hostname())} · ${shortTime(entry.finishedAt)}</i>`;
  const text = `${header}\n${meta}\n\n${lines.join('\n')}`;

  try {
    await send(config, text);
    logger.info(`[telegram] alerta enviada — canal ${entry.channel} (${lines.length} check${lines.length > 1 ? 's' : ''})`);
  } catch (err) {
    // Un fallo de envío no debe afectar la verificación
    logger.warn(`[telegram] no se pudo enviar la alerta del canal ${entry.channel}: ${err.message}`);
  }
}

module.exports = { alertChannel, describe };