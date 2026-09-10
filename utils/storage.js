const fs = require('fs');
const path = require('path');
const log = require('./logger');

const SETTINGS_PATH = path.join(__dirname, '..', 'settings.json');
const TMP_PATH = `${SETTINGS_PATH}.tmp`;

// Значення за замовчуванням для налаштувань сервера. Винесено в одну
// константу, щоб не дублювати об'єкт у кількох місцях і не забути
// оновити всі копії, коли зʼявляється нове поле (як сталось би раніше).
const DEFAULT_GUILD_SETTINGS = {
  welcomeChannelId: null,
  welcomeMessage: null,
  leaveMessage: null,
  autoRoleId: null,
  // Канал, куди PraBot дублює журнал дій (варни, бани, кіки, мути, зміни
  // налаштувань тощо). null = логування вимкнене.
  logChannelId: null,
  // Які саме типи подій писати в журнал — кожен можна вимкнути окремо
  // командою /prabot logs-toggle, не вимикаючи журнал повністю.
  logEvents: {
    warn: true,
    unwarn: true,
    kick: true,
    ban: true,
    mute: true,
    unmute: true,
    clear: true,
    settings: true,
    join: true,
    leave: true,
    role: true,
    channel: true,
    server: true
  },
  // { [userId]: Array<{ reason, moderatorTag, timestamp }> }
  warnings: {}
};

// Кеш у памʼяті — щоб не читати диск при кожній команді/вході учасника.
// Файл читається з диска лише один раз (лениво, при першому зверненні).
let cache = null;

function loadFromDisk() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (err) {
    log.error(
      '[PraBot] settings.json пошкоджено або нечитабельне, стартую з порожніх налаштувань:',
      err.message
    );
    // Не втрачаємо биту версію одразу — робимо бекап, щоб дані не загубились назавжди
    try {
      fs.copyFileSync(SETTINGS_PATH, `${SETTINGS_PATH}.broken-${Date.now()}`);
    } catch (_) {
      // якщо навіть бекап не вдався — просто ігноруємо, головне не впасти
    }
    return {};
  }
}

function ensureCache() {
  if (cache === null) {
    cache = loadFromDisk();
  }
  return cache;
}

// Атомарний запис: спочатку пишемо у тимчасовий файл, потім перейменовуємо.
// Це захищає від биття файлу, якщо процес раптово вб'ють посеред запису
// (типова ситуація на телефоні — Android/Termux може вбити процес будь-якої миті).
function persistToDisk() {
  try {
    fs.writeFileSync(TMP_PATH, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(TMP_PATH, SETTINGS_PATH);
  } catch (err) {
    log.error('[PraBot] Не вдалось зберегти settings.json на диск:', err.message);
  }
}

// Доповнює обʼєкт налаштувань поточними полями за замовчуванням — потрібно,
// якщо settings.json був створений старішою версією PraBot і не має нових
// полів (leaveMessage, warnings тощо). Без цього доступ до нового поля у
// старому сервері повертав би undefined і міг би зламати нову команду.
function withDefaults(existing) {
  return {
    ...DEFAULT_GUILD_SETTINGS,
    ...(existing || {}),
    logEvents: { ...DEFAULT_GUILD_SETTINGS.logEvents, ...((existing && existing.logEvents) || {}) },
    warnings: { ...((existing && existing.warnings) || {}) }
  };
}

function getGuildSettings(guildId) {
  const all = ensureCache();
  if (!all[guildId]) {
    all[guildId] = withDefaults(null);
    persistToDisk();
  } else {
    all[guildId] = withDefaults(all[guildId]);
  }
  return all[guildId];
}

function updateGuildSettings(guildId, patch) {
  const all = ensureCache();
  const current = withDefaults(all[guildId]);
  all[guildId] = { ...current, ...patch };
  persistToDisk();
  return all[guildId];
}

function addWarning(guildId, userId, warning) {
  const all = ensureCache();
  const current = withDefaults(all[guildId]);
  const list = current.warnings[userId] ? [...current.warnings[userId], warning] : [warning];
  current.warnings = { ...current.warnings, [userId]: list };
  all[guildId] = current;
  persistToDisk();
  return list;
}

function getWarnings(guildId, userId) {
  const settings = getGuildSettings(guildId);
  return settings.warnings[userId] || [];
}

function clearWarnings(guildId, userId) {
  const all = ensureCache();
  const current = withDefaults(all[guildId]);
  const hadAny = Boolean(current.warnings[userId] && current.warnings[userId].length);
  const warnings = { ...current.warnings };
  delete warnings[userId];
  current.warnings = warnings;
  all[guildId] = current;
  persistToDisk();
  return hadAny;
}

module.exports = {
  getGuildSettings,
  updateGuildSettings,
  addWarning,
  getWarnings,
  clearWarnings
};
