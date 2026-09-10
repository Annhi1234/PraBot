const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildSettings } = require('./storage');
const log = require('./logger');

// Кольори за типом події — щоб канал логів було легко сканувати оком.
const COLORS = {
  warn: 0xf1c40f, // жовтий
  mute: 0xe67e22, // помаранчевий
  unmute: 0x2ecc71, // зелений
  unwarn: 0x2ecc71,
  kick: 0xed4245, // червоний
  ban: 0x992d22, // темно-червоний
  clear: 0x99aab5, // сірий
  settings: 0x5865f2, // блюрпл (фірмовий колір Discord)
  join: 0x2ecc71,
  leave: 0x99aab5,
  role: 0xeb459e, // рожевий — зміни ролей
  channel: 0x3498db, // синій — зміни каналів
  server: 0x9b59b6 // фіолетовий — зміни самого сервера
};

/**
 * Надсилає одну подію в канал логів сервера, якщо він налаштований.
 * Ніколи не кидає помилку назовні — відсутність каналу/прав лише
 * логується у файл, а виконання команди не переривається.
 *
 * @param {import('discord.js').Guild} guild
 * @param {{ type: keyof typeof COLORS, title: string, description?: string, fields?: Array<{name:string,value:string,inline?:boolean}> }} entry
 */
async function sendLog(guild, entry) {
  try {
    const settings = getGuildSettings(guild.id);
    if (!settings.logChannelId) return;
    // Конкретний тип події міг бути вимкнений окремо через /prabot logs-toggle,
    // навіть якщо журнал дій загалом увімкнений.
    if (settings.logEvents?.[entry.type] === false) return;

    const channel = guild.channels.cache.get(settings.logChannelId);
    if (!channel || !channel.isTextBased()) {
      log.warn('[PraBot] Канал логів налаштований, але більше не існує або не текстовий.');
      return;
    }

    const botMember = guild.members.me;
    const perms = botMember ? channel.permissionsFor(botMember) : null;
    if (!perms || !perms.has(PermissionFlagsBits.SendMessages) || !perms.has(PermissionFlagsBits.ViewChannel)) {
      log.warn('[PraBot] Немає права писати в канал логів — запис пропущено.');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(COLORS[entry.type] ?? COLORS.settings)
      .setTitle(entry.title)
      .setTimestamp();

    if (entry.description) embed.setDescription(entry.description);
    if (entry.fields?.length) embed.addFields(entry.fields);

    await channel.send({ embeds: [embed] }).catch(err =>
      log.error('[PraBot] Не вдалось надіслати запис у канал логів:', err.message)
    );
  } catch (err) {
    // Логування — допоміжна фіча, вона ніколи не повинна ламати саму команду
    log.error('[PraBot] Помилка модуля логів:', err.message);
  }
}

module.exports = { sendLog };
