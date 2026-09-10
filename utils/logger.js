const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'prabot.log');
const ERROR_LOG_FILE = path.join(LOG_DIR, 'error.log');

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 МБ на файл
const MAX_ROTATED_FILES = 3;

// -----------------------------------------------------------------------
// Записуємо у файл НЕ синхронно на кожен виклик, а буферизовано:
// рядки накопичуються в памʼяті і скидаються на диск раз на FLUSH_INTERVAL_MS.
// Це важливо — якщо логувати синхронно на кожну взаємодію/вхід учасника,
// шквал подій (рейд ботів, спам команд) може заблокувати event loop і
// призвести до пропущених heartbeat-ів у зʼєднанні з Discord (розрив).
// -----------------------------------------------------------------------
const FLUSH_INTERVAL_MS = 1000;
const MAX_BUFFERED_LINES = 2000; // страховка від необмеженого росту памʼяті, якщо диск не встигає/недоступний

let buffer = [];       // рядки для prabot.log
let errorBuffer = [];  // рядки для error.log (дублюються сюди)
let flushInFlight = false;

// Кешуємо факт, що папка вже існує — не питати диск (fs.existsSync)
// на кожен flush (раз на секунду), а лише поки вона дійсно не створена.
let logDirReady = false;

function ensureLogDir() {
  if (logDirReady) return true;
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    logDirReady = true;
    return true;
  } catch {
    return false;
  }
}

function rotateIfNeededSync(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const { size } = fs.statSync(filePath);
    if (size < MAX_LOG_SIZE) return;

    for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
      const from = `${filePath}.${i}`;
      const to = `${filePath}.${i + 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(filePath, `${filePath}.1`);
  } catch {
    // Ротація не вдалась — пишемо у старий файл, не критично
  }
}

const MAX_LINE_LENGTH = 4000; // страховка від переповнення памʼяті/диска одним патологічним рядком

function formatLine(level, args) {
  const timestamp = new Date().toISOString();
  const message = args
    .map(a => {
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      if (typeof a === 'object' && a !== null) {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');

  const truncated =
    message.length > MAX_LINE_LENGTH
      ? `${message.slice(0, MAX_LINE_LENGTH)}… [обрізано, повна довжина: ${message.length}]`
      : message;

  return `[${timestamp}] [${level}] ${truncated}`;
}

function pushBuffered(list, line) {
  list.push(line);
  // Якщо диск не встигає (повільна флешка) або недоступний — не даємо
  // буферу рости нескінченно й забивати памʼять, обрізаємо найстаріше.
  if (list.length > MAX_BUFFERED_LINES) {
    list.splice(0, list.length - MAX_BUFFERED_LINES);
  }
}

async function flush() {
  if (flushInFlight) return;
  if (buffer.length === 0 && errorBuffer.length === 0) return;
  flushInFlight = true;

  const toWrite = buffer;
  const toWriteErr = errorBuffer;
  buffer = [];
  errorBuffer = [];

  try {
    if (!ensureLogDir()) {
      throw new Error('не вдалось створити/відкрити папку logs/');
    }
    if (toWrite.length > 0) {
      rotateIfNeededSync(LOG_FILE);
      await fs.promises.appendFile(LOG_FILE, `${toWrite.join('\n')}\n`, 'utf8');
    }
    if (toWriteErr.length > 0) {
      rotateIfNeededSync(ERROR_LOG_FILE);
      await fs.promises.appendFile(ERROR_LOG_FILE, `${toWriteErr.join('\n')}\n`, 'utf8');
    }
  } catch (err) {
    // Диск міг стати тимчасово недоступним (заповнена памʼять телефона тощо).
    // Раніше ці рядки тут мовчки губились назавжди — тепер повертаємо їх
    // назад у буфер і спробуємо записати на наступному flush (той самий
    // страхувальний ліміт MAX_BUFFERED_LINES не дає буферу рости нескінченно,
    // якщо диск не відновиться).
    console.error('[PraBot] Не вдалось записати логи на диск, спробую ще раз:', err.message);
    buffer = [...toWrite, ...buffer];
    errorBuffer = [...toWriteErr, ...errorBuffer];
    if (buffer.length > MAX_BUFFERED_LINES) buffer.splice(0, buffer.length - MAX_BUFFERED_LINES);
    if (errorBuffer.length > MAX_BUFFERED_LINES) errorBuffer.splice(0, errorBuffer.length - MAX_BUFFERED_LINES);
  } finally {
    flushInFlight = false;
  }
}

const flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
flushTimer.unref(); // не тримає процес живим лише заради цього таймера

// При штатному чи аварійному завершенні процесу — досипаємо все, що
// лишилось у буфері, синхронно (асинхронний I/O гарантовано не встигне).
function flushSync() {
  try {
    if (buffer.length === 0 && errorBuffer.length === 0) return;
    if (!ensureLogDir()) return;
    if (buffer.length > 0) {
      rotateIfNeededSync(LOG_FILE);
      fs.appendFileSync(LOG_FILE, `${buffer.join('\n')}\n`, 'utf8');
      buffer = [];
    }
    if (errorBuffer.length > 0) {
      rotateIfNeededSync(ERROR_LOG_FILE);
      fs.appendFileSync(ERROR_LOG_FILE, `${errorBuffer.join('\n')}\n`, 'utf8');
      errorBuffer = [];
    }
  } catch {
    // якщо навіть це не вдалось — вже нічого не вдіємо, процес завершується
  }
}
process.on('exit', flushSync);

function info(...args) {
  const line = formatLine('INFO', args);
  console.log(line);
  pushBuffered(buffer, line);
}

function warn(...args) {
  const line = formatLine('WARN', args);
  console.warn(line);
  pushBuffered(buffer, line);
}

function error(...args) {
  const line = formatLine('ERROR', args);
  console.error(line);
  pushBuffered(buffer, line);
  pushBuffered(errorBuffer, line);
}

module.exports = { info, warn, error, flush, LOG_DIR, LOG_FILE, ERROR_LOG_FILE };
