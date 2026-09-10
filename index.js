require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Events,
  Options,
  REST,
  Routes,
  MessageFlags,
  PermissionFlagsBits,
  AuditLogEvent
} = require('discord.js');
const { loadCommands } = require('./utils/loadCommands');
const { getGuildSettings } = require('./utils/storage');
const { sendLog } = require('./utils/modlog');
const log = require('./utils/logger');

// ---------------------------------------------------------------------------
// Захист від падіння всього процесу через одну необроблену помилку.
// Все, що падає тут, летить і в консоль, і у файл logs/error.log —
// відкрий цей файл, якщо щось не працює, і скопіюй звідти (він короткий,
// на відміну від консолі, куди валиться геть усе).
// ---------------------------------------------------------------------------
process.on('unhandledRejection', err => {
  log.error('[PraBot] Необроблений Promise-реджект:', err);
});
process.on('uncaughtException', err => {
  log.error('[PraBot] Необроблена помилка:', err);
});

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN) {
  log.error('[PraBot] DISCORD_TOKEN не заданий у .env. Скопіюй .env.example у .env і заповни його.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Захист від подвійного запуску.
// ---------------------------------------------------------------------------
const LOCK_PATH = path.join(__dirname, '.prabot.lock');

function checkSingleInstance() {
  if (fs.existsSync(LOCK_PATH)) {
    const oldPid = Number(fs.readFileSync(LOCK_PATH, 'utf8').trim());
    const stillAlive = oldPid && (() => {
      try {
        process.kill(oldPid, 0);
        return true;
      } catch {
        return false;
      }
    })();

    if (stillAlive) {
      log.error(
        `[PraBot] Здається, бот вже запущений (PID ${oldPid}). ` +
        'Другий екземпляр не стартую, щоб не плутати Discord-сесію. ' +
        `Якщо це помилка — видали файл ${LOCK_PATH} і спробуй ще раз.`
      );
      process.exit(1);
    }
  }

  fs.writeFileSync(LOCK_PATH, String(process.pid), 'utf8');
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_PATH) && fs.readFileSync(LOCK_PATH, 'utf8').trim() === String(process.pid)) {
      fs.unlinkSync(LOCK_PATH);
    }
  } catch (err) {
    log.error('[PraBot] Не вдалось прибрати lock-файл:', err.message);
  }
}

checkSingleInstance();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers // потрібно для подій входу/виходу учасників
  ],

  // Обмеження кешу — економія оперативної памʼяті (детально в README).
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 0,
    ReactionManager: 0,
    GuildInviteManager: 0,
    GuildScheduledEventManager: 0,
    ThreadManager: 0,
    ThreadMemberManager: 0,
    StageInstanceManager: 0,
    VoiceStateManager: 0,
    PresenceManager: 0,
    GuildBanManager: 0,
    AutoModerationRuleManager: 0,
    GuildEmojiManager: 0,
    GuildMemberManager: {
      maxSize: 1,
      keepOverLimit: member => member.id === member.client.user.id
    },
    // UserManager був єдиним лишеним без обмеження — а саме сюди осідає
    // кожен унікальний User: автор інтеракції, виконавець з Audit Log
    // (тепер додатково дістається для журналу ролей/каналів/сервера) тощо.
    // Без ліміту цей кеш повільно росте весь час роботи процесу й ніколи
    // не звільняється. 100 — з запасом на всіх активних адмінів +
    // останніх, кого бачили в аудит-лозі; свій обліковий запис лишаємо
    // завжди, бо він потрібен постійно (readyClient.user і т.д.).
    UserManager: {
      maxSize: 100,
      keepOverLimit: user => user.id === user.client.user.id
    }
  })
});

// Завантажуємо команди один раз при старті процесу
const { collection: commands, json: commandsJson } = loadCommands();
client.commands = commands;

// -----------------------------------------------------------------------
// Автоматична реєстрація слеш-команд при кожному запуску.
// -----------------------------------------------------------------------
async function syncSlashCommands(applicationId) {
  if (!GUILD_ID) {
    log.warn(
      '[PraBot] GUILD_ID не заданий у .env — автоматична реєстрація команд пропущена. ' +
      'Команди можуть не зʼявлятись у списку "/". Задай GUILD_ID і перезапусти бота, ' +
      'або запусти вручну: npm run deploy'
    );
    return;
  }

  if (commandsJson.length === 0) {
    log.warn('[PraBot] Не завантажено жодної команди — перевір папку commands/.');
    return;
  }

  try {
    const rest = new REST().setToken(DISCORD_TOKEN);
    const registered = await rest.put(
      Routes.applicationGuildCommands(applicationId, GUILD_ID),
      { body: commandsJson }
    );
    log.info(
      `[PraBot] Слеш-команди синхронізовано (${registered.length}): ` +
      registered.map(c => `/${c.name}`).join(', ')
    );
  } catch (err) {
    log.error(
      '[PraBot] НЕ ВДАЛОСЬ зареєструвати слеш-команди на сервері — тому вони НЕ будуть підказуватись у Discord. ' +
      'Найчастіша причина: GUILD_ID у .env вказує на сервер, де бота нема, або бота запросили без scope "applications.commands". ' +
      `HTTP-статус: ${err.status ?? 'невідомо'}.`,
      err.message
    );
  }
}

// -----------------------------------------------------------------------
// Перевірка, що бот дійсно є учасником сервера з вказаним GUILD_ID.
// Це найчастіша причина ситуації "бот ніби працює, але тільки для мене,
// а на сервері нічого не відбувається" — не той сервер вказано в .env,
// або бота туди взагалі не запросили.
// -----------------------------------------------------------------------
function checkGuildMembership(readyClient) {
  const joinedGuilds = [...readyClient.guilds.cache.values()];

  if (joinedGuilds.length === 0) {
    log.error(
      '[PraBot] Бот не є учасником ЖОДНОГО сервера! Він онлайн, але не бачить нічого і не може реагувати ' +
      'на вхід учасників чи показувати команди. Запроси бота через посилання з OAuth2 → URL Generator ' +
      '(scope bot + applications.commands) — див. README, Крок 1.'
    );
    return;
  }

  log.info(
    `[PraBot] Бот бачить ${joinedGuilds.length} сервер(и): ` +
    joinedGuilds.map(g => `${g.name} (${g.id})`).join(', ')
  );

  if (GUILD_ID && !joinedGuilds.some(g => g.id === GUILD_ID)) {
    log.error(
      `[PraBot] УВАГА: GUILD_ID у .env (${GUILD_ID}) НЕ збігається з жодним сервером, де реально є бот! ` +
      'Саме тому команди/привітання/авто-роль можуть не діяти на твоєму сервері. ' +
      'Виправ GUILD_ID у .env на ID сервера зі списку вище (Discord → Developer Mode → ПКМ по сервері → Copy Server ID) і перезапусти бота.'
    );
  }
}

client.once(Events.ClientReady, async readyClient => {
  log.info(`PraBot увійшов як ${readyClient.user.tag}`);
  log.info('Created by A and I studio');

  checkGuildMembership(readyClient);

  const applicationId = CLIENT_ID || readyClient.user.id;
  await syncSlashCommands(applicationId);
});

// Якщо бота додають на новий сервер уже під час роботи — одразу видно в логах
client.on(Events.GuildCreate, guild => {
  log.info(`[PraBot] Бота додано на новий сервер: ${guild.name} (${guild.id}).`);
  if (GUILD_ID && guild.id !== GUILD_ID) {
    log.warn(
      `[PraBot] Це не той сервер, що вказаний у GUILD_ID (${GUILD_ID}) — слеш-команди сюди автоматично не реєструються.`
    );
  }
});

// Мережеві/шардові помилки discord.js — логуємо, а не падаємо
client.on(Events.Error, err => log.error('[PraBot] Client error:', err.message));
client.on(Events.ShardError, err => log.error('[PraBot] Shard error:', err.message));
client.on(Events.Warn, msg => log.warn('[PraBot] Warn:', msg));
client.on(Events.ShardDisconnect, () => log.warn('[PraBot] Втрачено зʼєднання з Discord, намагаюсь перепідключитись...'));
client.on(Events.ShardReconnecting, () => log.warn('[PraBot] Перепідключення до Discord...'));
client.on(Events.ShardResume, () => log.info('[PraBot] Зʼєднання з Discord відновлено.'));

// Обробка слеш-команд
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      log.error(`[PraBot] Помилка виконання команди ${interaction.commandName}:`, err);
      const errorReply = {
        content: 'Щось пішло не так під час виконання команди.',
        flags: MessageFlags.Ephemeral
      };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorReply);
        } else {
          await interaction.reply(errorReply);
        }
      } catch (replyErr) {
        log.error('[PraBot] Не вдалось відповісти на помилку команди:', replyErr.message);
      }
    }
    return;
  }
});

// Привітання + авто-роль при вході нового учасника
client.on(Events.GuildMemberAdd, async member => {
  try {
    log.info(`[PraBot] Новий учасник на сервері ${member.guild.name}: ${member.user.tag}`);
    const settings = getGuildSettings(member.guild.id);

    if (settings.autoRoleId) {
      const role = member.guild.roles.cache.get(settings.autoRoleId);
      if (role) {
        await member.roles.add(role).catch(err =>
          log.error('[PraBot] Не вдалось видати авто-роль:', err.message)
        );
      } else {
        log.warn('[PraBot] Налаштована авто-роль більше не існує на сервері.');
      }
    }

    if (settings.welcomeChannelId && settings.welcomeMessage) {
      const channel = member.guild.channels.cache.get(settings.welcomeChannelId);
      if (channel && channel.isTextBased()) {
        const text = settings.welcomeMessage.replace(/\{user\}/g, `${member}`);
        await channel
          .send({
            content: text,
            allowedMentions: { users: [member.id], roles: [], parse: [] }
          })
          .catch(err => log.error('[PraBot] Не вдалось надіслати привітання:', err.message));
      } else {
        log.warn('[PraBot] Налаштований канал привітань більше не існує або не текстовий.');
      }
    }

    await sendLog(member.guild, {
      type: 'join',
      title: 'Новий учасник',
      fields: [{ name: 'Учасник', value: `${member.user.tag} (${member.id})` }]
    });
  } catch (err) {
    log.error('[PraBot] Помилка обробки GuildMemberAdd:', err);
  }
});

// Повідомлення про вихід учасника (опційне, вимкнене за замовчуванням).
// На відміну від привітання, тут немає кого пінгувати — учасник уже
// вийшов, тому {user} підставляється як звичайний текстовий тег.
client.on(Events.GuildMemberRemove, async member => {
  try {
    const settings = getGuildSettings(member.guild.id);
    if (!settings.welcomeChannelId || !settings.leaveMessage) return;

    const channel = member.guild.channels.cache.get(settings.welcomeChannelId);
    if (!channel || !channel.isTextBased()) {
      log.warn('[PraBot] Налаштований канал для повідомлень про вихід більше не існує або не текстовий.');
      return;
    }

    const text = settings.leaveMessage.replace(/\{user\}/g, member.user.tag);
    await channel
      .send({ content: text, allowedMentions: { parse: [] } })
      .catch(err => log.error('[PraBot] Не вдалось надіслати повідомлення про вихід:', err.message));
  } catch (err) {
    log.error('[PraBot] Помилка обробки GuildMemberRemove:', err);
  }
});

// Окремий лог виходу учасника в журнал дій — незалежний від leaveMessage,
// щоб адміни бачили факт виходу навіть якщо текстове повідомлення вимкнене.
client.on(Events.GuildMemberRemove, async member => {
  try {
    await sendLog(member.guild, {
      type: 'leave',
      title: 'Учасник вийшов',
      fields: [{ name: 'Учасник', value: `${member.user.tag} (${member.id})` }]
    });
  } catch (err) {
    log.error('[PraBot] Помилка логування виходу учасника:', err);
  }
});

// ---------------------------------------------------------------------------
// Журнал змін ролей, каналів і самого сервера, зроблених напряму в Discord
// (не через PraBot) — щоб було видно, хто саме перейменував роль, змінив її
// права, створив/видалив канал чи поміняв налаштування сервера. Це не
// потребує жодного нового привілейованого intent-у — GuildRoleCreate/Update/
// Delete, ChannelCreate/Update/Delete і GuildUpdate входять у звичайний,
// непривілейований intent Guilds, який і так уже увімкнений.
//
// Хто саме зробив зміну discord.js напряму в самій події не передає — це
// доводиться окремо шукати в Audit Log сервера (потрібне право бота
// "Переглядати журнал аудиту"; якщо його нема — просто пишемо "невідомо",
// без падіння).
// ---------------------------------------------------------------------------
async function fetchAuditExecutor(guild, auditLogType, targetId) {
  try {
    const audit = await guild.fetchAuditLogs({ type: auditLogType, limit: 3 });
    const entry = audit.entries.find(
      e => e.target?.id === targetId && Date.now() - e.createdTimestamp < 15000
    );
    return entry?.executor ?? null;
  } catch (err) {
    // Найчастіше — бот без права "View Audit Log". Не критично, просто не
    // знаємо виконавця; сам факт зміни все одно залогуємо.
    return null;
  }
}

client.on(Events.GuildRoleCreate, async role => {
  try {
    const executor = await fetchAuditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
    await sendLog(role.guild, {
      type: 'role',
      title: 'Створено роль',
      fields: [
        { name: 'Роль', value: `${role}`, inline: true },
        ...(executor ? [{ name: 'Ким', value: executor.tag, inline: true }] : [])
      ]
    });
  } catch (err) {
    log.error('[PraBot] Помилка логування створення ролі:', err.message);
  }
});

client.on(Events.GuildRoleDelete, async role => {
  try {
    const executor = await fetchAuditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
    await sendLog(role.guild, {
      type: 'role',
      title: 'Видалено роль',
      fields: [
        { name: 'Роль', value: `${role.name} (${role.id})`, inline: true },
        ...(executor ? [{ name: 'Ким', value: executor.tag, inline: true }] : [])
      ]
    });
  } catch (err) {
    log.error('[PraBot] Помилка логування видалення ролі:', err.message);
  }
});

client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  try {
    const changes = [];

    if (oldRole.name !== newRole.name) {
      changes.push({ name: 'Назва', value: `${oldRole.name} → ${newRole.name}` });
    }
    if (oldRole.hexColor !== newRole.hexColor) {
      changes.push({ name: 'Колір', value: `${oldRole.hexColor} → ${newRole.hexColor}` });
    }
    if (oldRole.hoist !== newRole.hoist) {
      changes.push({ name: 'Показ окремо від інших', value: `${oldRole.hoist} → ${newRole.hoist}` });
    }
    if (oldRole.mentionable !== newRole.mentionable) {
      changes.push({ name: 'Можна згадувати (@)', value: `${oldRole.mentionable} → ${newRole.mentionable}` });
    }
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
      const added = newRole.permissions.toArray().filter(p => !oldRole.permissions.has(p));
      const removed = oldRole.permissions.toArray().filter(p => !newRole.permissions.has(p));
      if (added.length) changes.push({ name: 'Додано права', value: added.join(', ').slice(0, 1024) });
      if (removed.length) changes.push({ name: 'Знято права', value: removed.join(', ').slice(0, 1024) });
    }

    // Позиція ролі в списку міняється й сама по собі (наприклад, при
    // створенні/видаленні іншої ролі вище) — це не цікаво адмінам і лише
    // спамило б журнал, тому свідомо не відстежуємо.
    if (changes.length === 0) return;

    const executor = await fetchAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    await sendLog(newRole.guild, {
      type: 'role',
      title: 'Змінено роль',
      fields: [
        { name: 'Роль', value: `${newRole}`, inline: true },
        ...(executor ? [{ name: 'Ким', value: executor.tag, inline: true }] : []),
        ...changes
      ]
    });
  } catch (err) {
    log.error('[PraBot] Помилка логування зміни ролі:', err.message);
  }
});

client.on(Events.ChannelCreate, async channel => {
  try {
    if (!channel.guild) return; // ЛС-канали сюди теоретично не потрапляють, але про всяк випадок
    const executor = await fetchAuditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    await sendLog(channel.guild, {
      type: 'channel',
      title: 'Створено канал',
      fields: [
        { name: 'Канал', value: `${channel}`, inline: true },
        ...(executor ? [{ name: 'Ким', value: executor.tag, inline: true }] : [])
      ]
    });
  } catch (err) {
    log.error('[PraBot] Помилка логування створення каналу:', err.message);
  }
});

client.on(Events.ChannelDelete, async channel => {
  try {
    if (!channel.guild) return;
    const executor = await fetchAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    await sendLog(channel.guild, {
      type: 'channel',
      title: 'Видалено канал',
      fields: [
        { name: 'Канал', value: `#${channel.name} (${channel.id})`, inline: true },
        ...(executor ? [{ name: 'Ким', value: executor.tag, inline: true }] : [])
      ]
    });
  } catch (err) {
    log.error('[PraBot] Помилка логування видалення каналу:', err.message);
  }
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  try {
    if (!newChannel.guild) return;
    const changes = [];

    if (oldChannel.name !== newChannel.name) {
      changes.push({ name: 'Назва', value: `${oldChannel.name} → ${newChannel.name}` });
    }
    if ('topic' in oldChannel && oldChannel.topic !== newChannel.topic) {
      changes.push({
        name: 'Опис каналу',
        value: `${oldChannel.topic || '(пусто)'} → ${newChannel.topic || '(пусто)'}`.slice(0, 1024)
      });
    }
    if ('nsfw' in oldChannel && oldChannel.nsfw !== newChannel.nsfw) {
      changes.push({ name: 'NSFW', value: `${oldChannel.nsfw} → ${newChannel.nsfw}` });
    }
    if ('rateLimitPerUser' in oldChannel && oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
      changes.push({
        name: 'Уповільнення (сек)',
        value: `${oldChannel.rateLimitPerUser ?? 0} → ${newChannel.rateLimitPerUser ?? 0}`
      });
    }

    // Права доступу (permission overwrites) міняються часто й дрібно —
    // не порівнюємо їх детально, лише позначаємо факт зміни, щоб не
    // засмічувати журнал величезними діффами прав по кожній ролі/юзеру.
    if (oldChannel.permissionOverwrites?.cache.size !== newChannel.permissionOverwrites?.cache.size ||
        [...(newChannel.permissionOverwrites?.cache.values() ?? [])].some(ow => {
          const old = oldChannel.permissionOverwrites?.cache.get(ow.id);
          return !old || old.allow.bitfield !== ow.allow.bitfield || old.deny.bitfield !== ow.deny.bitfield;
        })) {
      changes.push({ name: 'Права доступу', value: 'Змінено налаштування прав каналу' });
    }

    if (changes.length === 0) return;

    const executor = await fetchAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
    await sendLog(newChannel.guild, {
      type: 'channel',
      title: 'Змінено канал',
      fields: [
        { name: 'Канал', value: `${newChannel}`, inline: true },
        ...(executor ? [{ name: 'Ким', value: executor.tag, inline: true }] : []),
        ...changes
      ]
    });
  } catch (err) {
    log.error('[PraBot] Помилка логування зміни каналу:', err.message);
  }
});

client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
  try {
    const changes = [];

    if (oldGuild.name !== newGuild.name) {
      changes.push({ name: 'Назва сервера', value: `${oldGuild.name} → ${newGuild.name}` });
    }
    if (oldGuild.iconURL() !== newGuild.iconURL()) {
      changes.push({ name: 'Іконка сервера', value: 'Змінено' });
    }
    if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
      changes.push({
        name: 'Рівень верифікації',
        value: `${oldGuild.verificationLevel} → ${newGuild.verificationLevel}`
      });
    }
    if (oldGuild.afkChannelId !== newGuild.afkChannelId) {
      changes.push({ name: 'AFK-канал', value: 'Змінено' });
    }
    if (oldGuild.ownerId !== newGuild.ownerId) {
      changes.push({ name: 'Власник сервера', value: `<@${oldGuild.ownerId}> → <@${newGuild.ownerId}>` });
    }

    if (changes.length === 0) return;

    const executor = await fetchAuditExecutor(newGuild, AuditLogEvent.GuildUpdate, newGuild.id);
    await sendLog(newGuild, {
      type: 'server',
      title: 'Змінено налаштування сервера',
      fields: [...(executor ? [{ name: 'Ким', value: executor.tag }] : []), ...changes]
    });
  } catch (err) {
    log.error('[PraBot] Помилка логування зміни сервера:', err.message);
  }
});

async function shutdown(signal) {
  log.info(`[PraBot] Отримано ${signal}, завершую роботу...`);
  releaseLock();
  client.destroy();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', releaseLock);

client.login(DISCORD_TOKEN).catch(err => {
  if (err.message?.includes('Authentication failed') || err.code === 'TokenInvalid') {
    log.error(
      '[PraBot] DISCORD_TOKEN невірний, застарілий або скинутий. ' +
      'Створи новий у Developer Portal → Bot → Reset Token і онови .env.'
    );
  } else if (err.message === 'Used disallowed intents') {
    log.error(
      '[PraBot] Discord відхилив підключення через privileged intent. ' +
      'Зайди в Developer Portal → Bot → увімкни "Server Members Intent" і перезапусти бота.'
    );
  } else {
    log.error('[PraBot] Не вдалось увійти в Discord:', err.message);
  }
  process.exit(1);
});
