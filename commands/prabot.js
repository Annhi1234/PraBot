const os = require('os');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  InteractionContextType,
  EmbedBuilder
} = require('discord.js');
const {
  getGuildSettings,
  updateGuildSettings,
  addWarning,
  getWarnings,
  clearWarnings
} = require('../utils/storage');
const { sendLog } = require('../utils/modlog');
const log = require('../utils/logger');

const BRAND_COLOR = 0x5865f2;

// Людські назви типів подій журналу — використовуються і в описі команди
// /prabot logs-toggle, і у відповіді на неї, і в /prabot settings.
const EVENT_LABELS = {
  warn: 'Попередження (warn)',
  unwarn: 'Зняття попереджень (clearwarnings)',
  kick: 'Кіки',
  ban: 'Бани',
  mute: 'Мути (timeout)',
  unmute: 'Розмути (untimeout)',
  clear: 'Очищення повідомлень (clear)',
  settings: 'Зміни налаштувань',
  join: 'Вхід учасників',
  leave: 'Вихід учасників',
  role: 'Зміни ролей',
  channel: 'Зміни каналів',
  server: 'Зміни сервера'
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('prabot')
    .setDescription('Керування PraBot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    // Тільки в контексті сервера — без цього команду теоретично можна
    // встановити собі як user-app і викликати в особистих повідомленнях,
    // де немає ні сервера, ні прав адміністратора для перевірки.
    .setContexts(InteractionContextType.Guild)

    // --- Привітання / вихід -------------------------------------------------
    .addSubcommand(sub =>
      sub
        .setName('welcome-text')
        .setDescription('Задати текст привітання для нових учасників')
        .addStringOption(opt =>
          opt
            .setName('текст')
            .setDescription('Текст привітання. {user} замінюється на згадку нового учасника')
            .setRequired(true)
            .setMaxLength(1900)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('welcome-channel')
        .setDescription('Обрати канал для привітань і повідомлень про вихід')
        .addChannelOption(opt =>
          opt
            .setName('канал')
            .setDescription('Текстовий канал')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('welcome-off').setDescription('Вимкнути привітання нових учасників')
    )
    .addSubcommand(sub =>
      sub
        .setName('leave-message')
        .setDescription('Задати текст повідомлення, коли учасник виходить із сервера')
        .addStringOption(opt =>
          opt
            .setName('текст')
            .setDescription('Текст. {user} замінюється на тег учасника (без пінгу — він уже вийшов)')
            .setRequired(true)
            .setMaxLength(1900)
        )
    )
    .addSubcommand(sub =>
      sub.setName('leave-off').setDescription('Вимкнути повідомлення про вихід учасників')
    )

    // --- Авто-роль -----------------------------------------------------------
    .addSubcommand(sub =>
      sub
        .setName('autorole')
        .setDescription('Обрати роль, яка автоматично видається новим учасникам')
        .addRoleOption(opt =>
          opt.setName('роль').setDescription('Роль для авто-видачі').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('autorole-off').setDescription('Вимкнути авто-видачу ролі')
    )

    // --- Журнал дій (логи) -----------------------------------------------------
    .addSubcommand(sub =>
      sub
        .setName('logs-channel')
        .setDescription('Обрати канал, куди PraBot пише журнал дій (модерація, зміни ролей/каналів/сервера)')
        .addChannelOption(opt =>
          opt
            .setName('канал')
            .setDescription('Текстовий канал для журналу')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('logs-off').setDescription('Вимкнути журнал дій повністю')
    )
    .addSubcommand(sub =>
      sub
        .setName('logs-toggle')
        .setDescription('Увімкнути/вимкнути окремий тип подій у журналі, не вимикаючи весь журнал')
        .addStringOption(opt =>
          opt
            .setName('подія')
            .setDescription('Який тип подій налаштувати')
            .setRequired(true)
            .addChoices(
              { name: 'Попередження (warn)', value: 'warn' },
              { name: 'Зняття попереджень', value: 'unwarn' },
              { name: 'Кіки', value: 'kick' },
              { name: 'Бани', value: 'ban' },
              { name: 'Мути (timeout)', value: 'mute' },
              { name: 'Розмути (untimeout)', value: 'unmute' },
              { name: 'Очищення повідомлень', value: 'clear' },
              { name: 'Зміни налаштувань', value: 'settings' },
              { name: 'Вхід учасників', value: 'join' },
              { name: 'Вихід учасників', value: 'leave' },
              { name: 'Зміни ролей (створення/видалення/редагування)', value: 'role' },
              { name: 'Зміни каналів (створення/видалення/редагування)', value: 'channel' },
              { name: 'Зміни сервера (назва, іконка тощо)', value: 'server' }
            )
        )
        .addBooleanOption(opt =>
          opt.setName('увімкнено').setDescription('true — писати в журнал, false — не писати').setRequired(true)
        )
    )

    // --- Модерація -------------------------------------------------------------
    .addSubcommand(sub =>
      sub
        .setName('untimeout')
        .setDescription('Зняти таймаут (mute) з учасника')
        .addUserOption(opt =>
          opt.setName('юзер').setDescription('Учасник, з якого зняти таймаут').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('timeout')
        .setDescription('Видати учаснику таймаут (mute) на певний час')
        .addUserOption(opt => opt.setName('юзер').setDescription('Учасник').setRequired(true))
        .addIntegerOption(opt =>
          opt
            .setName('хвилини')
            .setDescription('Тривалість у хвилинах (макс. 40320 = 28 днів)')
            .setMinValue(1)
            .setMaxValue(40320)
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('причина').setDescription('Причина').setRequired(false).setMaxLength(400)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('kick')
        .setDescription('Кікнути учасника з сервера')
        .addUserOption(opt => opt.setName('юзер').setDescription('Учасник').setRequired(true))
        .addStringOption(opt =>
          opt.setName('причина').setDescription('Причина').setRequired(false).setMaxLength(400)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('ban')
        .setDescription('Забанити учасника')
        .addUserOption(opt => opt.setName('юзер').setDescription('Учасник').setRequired(true))
        .addStringOption(opt =>
          opt.setName('причина').setDescription('Причина').setRequired(false).setMaxLength(400)
        )
        .addIntegerOption(opt =>
          opt
            .setName('видалити-дні')
            .setDescription('Видалити повідомлення користувача за останні N днів (0-7)')
            .setMinValue(0)
            .setMaxValue(7)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('warn')
        .setDescription('Видати учаснику попередження (зберігається на сервері)')
        .addUserOption(opt => opt.setName('юзер').setDescription('Учасник').setRequired(true))
        .addStringOption(opt =>
          opt.setName('причина').setDescription('Причина попередження').setRequired(true).setMaxLength(400)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('warnings')
        .setDescription('Показати попередження учасника')
        .addUserOption(opt => opt.setName('юзер').setDescription('Учасник').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('clearwarnings')
        .setDescription('Очистити всі попередження учасника')
        .addUserOption(opt => opt.setName('юзер').setDescription('Учасник').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('clear')
        .setDescription('Видалити останні N повідомлень у поточному каналі')
        .addIntegerOption(opt =>
          opt
            .setName('кількість')
            .setDescription('Скільки повідомлень видалити (1-100)')
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(true)
        )
    )

    // --- Інформація ------------------------------------------------------------
    .addSubcommand(sub =>
      sub
        .setName('stats')
        .setDescription('Показати статистику бота: памʼять, пінг, аптайм, з кнопкою перезавантаження')
    )
    .addSubcommand(sub => sub.setName('serverinfo').setDescription('Показати інформацію про сервер'))
    .addSubcommand(sub =>
      sub
        .setName('userinfo')
        .setDescription('Показати інформацію про учасника')
        .addUserOption(opt =>
          opt.setName('юзер').setDescription('Учасник (за замовчуванням — ти)').setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('settings').setDescription('Показати поточні налаштування PraBot')
    )
    .addSubcommand(sub =>
      sub.setName('help').setDescription('Показати список усіх команд PraBot')
    ),

  async execute(interaction) {
    // Захист-дублікат: навіть якщо адміністратор сервера відкриє цю команду
    // іншим ролям через Server Settings → Integrations, чутливі дії
    // (видача ролей, бан/кік, зняття таймауту) все одно перевіряють права напряму.
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'Ця команда доступна лише адміністраторам сервера.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const sub = interaction.options.getSubcommand();

    switch (sub) {
      case 'welcome-text':
        return handleWelcomeText(interaction);
      case 'welcome-channel':
        return handleWelcomeChannel(interaction);
      case 'welcome-off':
        return handleWelcomeOff(interaction);
      case 'leave-message':
        return handleLeaveMessage(interaction);
      case 'leave-off':
        return handleLeaveOff(interaction);
      case 'autorole':
        return handleAutorole(interaction);
      case 'autorole-off':
        return handleAutoroleOff(interaction);
      case 'logs-channel':
        return handleLogsChannel(interaction);
      case 'logs-off':
        return handleLogsOff(interaction);
      case 'logs-toggle':
        return handleLogsToggle(interaction);
      case 'untimeout':
        return handleUntimeout(interaction);
      case 'timeout':
        return handleTimeout(interaction);
      case 'kick':
        return handleKick(interaction);
      case 'ban':
        return handleBan(interaction);
      case 'warn':
        return handleWarn(interaction);
      case 'warnings':
        return handleWarningsList(interaction);
      case 'clearwarnings':
        return handleClearWarnings(interaction);
      case 'clear':
        return handleClear(interaction);
      case 'stats':
        return handleStats(interaction);
      case 'serverinfo':
        return handleServerInfo(interaction);
      case 'userinfo':
        return handleUserInfo(interaction);
      case 'settings':
        return handleSettings(interaction);
      case 'help':
        return handleHelp(interaction);
      default:
        // Теоретично неможливо, discord.js валідує підкоманди сам,
        // але про всяк випадок — не падаємо мовчки.
        return interaction.reply({
          content: 'Невідома підкоманда.',
          flags: MessageFlags.Ephemeral
        });
    }
  }
};

// Отримує учасника-бота з кешу (де він завжди є завдяки makeCache у index.js)
// або, якщо з якоїсь причини кешу немає, підвантажує напряму.
async function getBotMember(interaction) {
  return interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
}

// -----------------------------------------------------------------------
// Привітання / вихід
// -----------------------------------------------------------------------

async function handleWelcomeText(interaction) {
  const text = interaction.options.getString('текст');
  updateGuildSettings(interaction.guildId, { welcomeMessage: text });
  await interaction.reply({
    content: `Текст привітання оновлено:\n> ${text}`,
    flags: MessageFlags.Ephemeral
  });
  await sendLog(interaction.guild, {
    type: 'settings',
    title: 'Текст привітання оновлено',
    description: `> ${text}`,
    fields: [{ name: 'Хто змінив', value: interaction.user.tag }]
  });
}

async function handleWelcomeChannel(interaction) {
  const channel = interaction.options.getChannel('канал');

  // Перевірка, що бот взагалі бачить і може писати в цей канал
  const botMember = await getBotMember(interaction);
  const perms = channel.permissionsFor(botMember);
  if (!perms || !perms.has(PermissionFlagsBits.SendMessages) || !perms.has(PermissionFlagsBits.ViewChannel)) {
    await interaction.reply({
      content: `Я не бачу канал ${channel} або не маю права писати в ньому. Перевір права бота в цьому каналі.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  updateGuildSettings(interaction.guildId, { welcomeChannelId: channel.id });
  await interaction.reply({
    content: `Канал для привітань і повідомлень про вихід встановлено: ${channel}`,
    flags: MessageFlags.Ephemeral
  });
  await sendLog(interaction.guild, {
    type: 'settings',
    title: 'Канал привітань змінено',
    description: `Новий канал: ${channel}`,
    fields: [{ name: 'Хто змінив', value: interaction.user.tag }]
  });
}

async function handleWelcomeOff(interaction) {
  updateGuildSettings(interaction.guildId, { welcomeChannelId: null, welcomeMessage: null });
  await interaction.reply({ content: 'Привітання нових учасників вимкнено.', flags: MessageFlags.Ephemeral });
  await sendLog(interaction.guild, {
    type: 'settings',
    title: 'Привітання вимкнено',
    fields: [{ name: 'Хто вимкнув', value: interaction.user.tag }]
  });
}

async function handleLeaveMessage(interaction) {
  const text = interaction.options.getString('текст');
  const settings = getGuildSettings(interaction.guildId);
  updateGuildSettings(interaction.guildId, { leaveMessage: text });
  const note = settings.welcomeChannelId
    ? ''
    : '\nКанал ще не встановлено — задай його через /prabot welcome-channel, інакше повідомлення нікуди не надсилатимуться.';
  await interaction.reply({
    content: `Текст повідомлення про вихід оновлено:\n> ${text}${note}`,
    flags: MessageFlags.Ephemeral
  });
  await sendLog(interaction.guild, {
    type: 'settings',
    title: 'Текст повідомлення про вихід оновлено',
    description: `> ${text}`,
    fields: [{ name: 'Хто змінив', value: interaction.user.tag }]
  });
}

async function handleLeaveOff(interaction) {
  updateGuildSettings(interaction.guildId, { leaveMessage: null });
  await interaction.reply({ content: 'Повідомлення про вихід учасників вимкнено.', flags: MessageFlags.Ephemeral });
  await sendLog(interaction.guild, {
    type: 'settings',
    title: 'Повідомлення про вихід вимкнено',
    fields: [{ name: 'Хто вимкнув', value: interaction.user.tag }]
  });
}

// -----------------------------------------------------------------------
// Авто-роль
// -----------------------------------------------------------------------

async function handleAutorole(interaction) {
  const role = interaction.options.getRole('роль');
  const botMember = await getBotMember(interaction);

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({
      content: 'У бота немає права Manage Roles на цьому сервері — авто-роль не запрацює, навіть якщо я її збережу. Видай це право боту в Server Settings → Roles.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (role.id === interaction.guildId) {
    await interaction.reply({
      content: 'Роль @everyone не можна видавати вручну — вона й так є у всіх.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (role.managed) {
    await interaction.reply({
      content: `Роль ${role} керується інтеграцією (бот/бустер/тощо) і не може видаватись вручну.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (role.position >= botMember.roles.highest.position) {
    await interaction.reply({
      content: `Не можу використовувати роль ${role}: вона розташована вище (або на одному рівні) за найвищу роль бота в ієрархії. Підніми роль бота вище в Server Settings → Roles.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  updateGuildSettings(interaction.guildId, { autoRoleId: role.id });
  await interaction.reply({
    content: `Авто-роль встановлено: ${role}`,
    flags: MessageFlags.Ephemeral
  });
  await sendLog(interaction.guild, {
    type: 'settings',
    title: 'Авто-роль змінено',
    description: `Нова роль: ${role}`,
    fields: [{ name: 'Хто змінив', value: interaction.user.tag }]
  });
}

async function handleAutoroleOff(interaction) {
  updateGuildSettings(interaction.guildId, { autoRoleId: null });
  await interaction.reply({ content: 'Авто-видачу ролі вимкнено.', flags: MessageFlags.Ephemeral });
  await sendLog(interaction.guild, {
    type: 'settings',
    title: 'Авто-роль вимкнено',
    fields: [{ name: 'Хто вимкнув', value: interaction.user.tag }]
  });
}

// -----------------------------------------------------------------------
// Журнал дій (логи)
// -----------------------------------------------------------------------

async function handleLogsChannel(interaction) {
  const channel = interaction.options.getChannel('канал');
  const botMember = await getBotMember(interaction);
  const perms = channel.permissionsFor(botMember);

  if (!perms || !perms.has(PermissionFlagsBits.SendMessages) || !perms.has(PermissionFlagsBits.ViewChannel)) {
    await interaction.reply({
      content: `Я не бачу канал ${channel} або не маю права писати в ньому. Перевір права бота в цьому каналі.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  updateGuildSettings(interaction.guildId, { logChannelId: channel.id });
  await interaction.reply({
    content: `Канал журналу дій встановлено: ${channel}. Сюди тепер писатимуться варни, бани, кіки, мути, зняття варнів/мутів, зміни налаштувань, вхід/вихід учасників, а також зміни ролей, каналів і самого сервера, зроблені напряму в Discord — кожен тип можна вимкнути окремо через /prabot logs-toggle.`,
    flags: MessageFlags.Ephemeral
  });
  await sendLog(interaction.guild, {
    type: 'settings',
    title: 'Журнал дій увімкнено',
    description: 'Відтепер PraBot дублює сюди дії модерації та зміни налаштувань.',
    fields: [{ name: 'Хто налаштував', value: interaction.user.tag }]
  });
}

async function handleLogsOff(interaction) {
  const settings = getGuildSettings(interaction.guildId);
  if (!settings.logChannelId) {
    await interaction.reply({ content: 'Журнал дій і так вимкнений.', flags: MessageFlags.Ephemeral });
    return;
  }
  // Надсилаємо прощальний запис у СТАРИЙ канал, поки він ще налаштований
  await sendLog(interaction.guild, {
    type: 'settings',
    title: 'Журнал дій вимкнено',
    fields: [{ name: 'Хто вимкнув', value: interaction.user.tag }]
  });
  updateGuildSettings(interaction.guildId, { logChannelId: null });
  await interaction.reply({ content: 'Журнал дій вимкнено повністю.', flags: MessageFlags.Ephemeral });
}

async function handleLogsToggle(interaction) {
  const eventKey = interaction.options.getString('подія');
  const enabled = interaction.options.getBoolean('увімкнено');
  const settings = getGuildSettings(interaction.guildId);

  const logEvents = { ...settings.logEvents, [eventKey]: enabled };
  updateGuildSettings(interaction.guildId, { logEvents });

  const label = EVENT_LABELS[eventKey] ?? eventKey;
  const note = settings.logChannelId
    ? ''
    : '\nЗауваж: канал журналу ще не налаштований (/prabot logs-channel), тому це поки ні на що не впливає.';

  await interaction.reply({
    content: `«${label}» ${enabled ? 'увімкнено' : 'вимкнено'} у журналі дій.${note}`,
    flags: MessageFlags.Ephemeral
  });
}

// -----------------------------------------------------------------------
// Модерація
// -----------------------------------------------------------------------

async function handleUntimeout(interaction) {
  const targetUser = interaction.options.getUser('юзер');
  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

  if (!member) {
    await interaction.reply({
      content: 'Не вдалось знайти цього учасника на сервері.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!member.isCommunicationDisabled()) {
    await interaction.reply({
      content: `${member} зараз і так не в таймауті.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    await member.timeout(null, `Знято через /prabot untimeout адміністратором ${interaction.user.tag}`);
    await interaction.reply({
      content: `Таймаут знято з ${member}.`,
      flags: MessageFlags.Ephemeral
    });
    await sendLog(interaction.guild, {
      type: 'unmute',
      title: 'Таймаут знято',
      fields: [
        { name: 'Учасник', value: `${targetUser.tag} (${targetUser.id})` },
        { name: 'Модератор', value: interaction.user.tag }
      ]
    });
  } catch (err) {
    log.error('[PraBot] Помилка при знятті таймауту:', err.message);
    await interaction.reply({
      content: 'Не вдалось зняти таймаут. Перевір права бота (Moderate Members) та ієрархію ролей.',
      flags: MessageFlags.Ephemeral
    });
  }
}

async function handleTimeout(interaction) {
  const botMember = await getBotMember(interaction);
  if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    await interaction.reply({
      content: 'У бота немає права Moderate Members на цьому сервері.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const targetUser = interaction.options.getUser('юзер');
  const minutes = interaction.options.getInteger('хвилини');
  const reason = interaction.options.getString('причина') ?? 'без причини';
  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

  if (!member) {
    await interaction.reply({ content: 'Не вдалось знайти цього учасника на сервері.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!member.moderatable) {
    await interaction.reply({
      content: `Не можу видати таймаут ${member}: недостатньо прав або роль учасника вища за роль бота.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    await member.timeout(minutes * 60 * 1000, `${reason} — по команді ${interaction.user.tag}`);
    await interaction.reply({
      content: `${member} отримав(ла) таймаут на ${minutes} хв. Причина: ${reason}`,
      flags: MessageFlags.Ephemeral
    });
    await sendLog(interaction.guild, {
      type: 'mute',
      title: 'Таймаут видано',
      fields: [
        { name: 'Учасник', value: `${targetUser.tag} (${targetUser.id})` },
        { name: 'Модератор', value: interaction.user.tag },
        { name: 'Тривалість', value: `${minutes} хв`, inline: true },
        { name: 'Причина', value: reason, inline: true }
      ]
    });
  } catch (err) {
    log.error('[PraBot] Помилка при видачі таймауту:', err.message);
    await interaction.reply({ content: 'Не вдалось видати таймаут.', flags: MessageFlags.Ephemeral });
  }
}

async function handleKick(interaction) {
  const botMember = await getBotMember(interaction);
  if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) {
    await interaction.reply({ content: 'У бота немає права Kick Members на цьому сервері.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetUser = interaction.options.getUser('юзер');
  const reason = interaction.options.getString('причина') ?? 'без причини';
  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

  if (!member) {
    await interaction.reply({ content: 'Не вдалось знайти цього учасника на сервері.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!member.kickable) {
    await interaction.reply({
      content: `Не можу кікнути ${member}: недостатньо прав або роль учасника вища за роль бота.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    const tag = targetUser.tag;
    await member.kick(`${reason} — по команді ${interaction.user.tag}`);
    await interaction.reply({ content: `${tag} кікнуто. Причина: ${reason}`, flags: MessageFlags.Ephemeral });
    await sendLog(interaction.guild, {
      type: 'kick',
      title: 'Учасника кікнуто',
      fields: [
        { name: 'Учасник', value: `${tag} (${targetUser.id})` },
        { name: 'Модератор', value: interaction.user.tag },
        { name: 'Причина', value: reason }
      ]
    });
  } catch (err) {
    log.error('[PraBot] Помилка кіку:', err.message);
    await interaction.reply({ content: 'Не вдалось кікнути учасника.', flags: MessageFlags.Ephemeral });
  }
}

async function handleBan(interaction) {
  const botMember = await getBotMember(interaction);
  if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
    await interaction.reply({ content: 'У бота немає права Ban Members на цьому сервері.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetUser = interaction.options.getUser('юзер');
  const reason = interaction.options.getString('причина') ?? 'без причини';
  const days = interaction.options.getInteger('видалити-дні') ?? 0;

  // Учасника може вже не бути на сервері (бан по ID) — це нормальна ситуація,
  // на відміну від кіку/таймауту, тому відсутність member тут не помилка.
  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (member && !member.bannable) {
    await interaction.reply({
      content: `Не можу забанити ${member}: недостатньо прав або роль учасника вища за роль бота.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    await interaction.guild.members.ban(targetUser.id, {
      deleteMessageSeconds: days * 86400,
      reason: `${reason} — по команді ${interaction.user.tag}`
    });
    await interaction.reply({ content: `${targetUser.tag} забанено. Причина: ${reason}`, flags: MessageFlags.Ephemeral });
    await sendLog(interaction.guild, {
      type: 'ban',
      title: 'Учасника забанено',
      fields: [
        { name: 'Учасник', value: `${targetUser.tag} (${targetUser.id})` },
        { name: 'Модератор', value: interaction.user.tag },
        { name: 'Причина', value: reason }
      ]
    });
  } catch (err) {
    log.error('[PraBot] Помилка бану:', err.message);
    await interaction.reply({ content: 'Не вдалось забанити користувача.', flags: MessageFlags.Ephemeral });
  }
}

async function handleWarn(interaction) {
  const targetUser = interaction.options.getUser('юзер');
  const reason = interaction.options.getString('причина');

  const list = addWarning(interaction.guildId, targetUser.id, {
    reason,
    moderatorTag: interaction.user.tag,
    timestamp: Date.now()
  });

  await interaction.reply({
    content: `${targetUser.tag} отримав(ла) попередження (усього: ${list.length}).\nПричина: ${reason}`,
    flags: MessageFlags.Ephemeral
  });
  await sendLog(interaction.guild, {
    type: 'warn',
    title: 'Видано попередження',
    fields: [
      { name: 'Учасник', value: `${targetUser.tag} (${targetUser.id})` },
      { name: 'Модератор', value: interaction.user.tag },
      { name: 'Причина', value: reason },
      { name: 'Всього попереджень', value: String(list.length), inline: true }
    ]
  });
}

async function handleWarningsList(interaction) {
  const targetUser = interaction.options.getUser('юзер');
  const list = getWarnings(interaction.guildId, targetUser.id);

  if (list.length === 0) {
    await interaction.reply({ content: `У ${targetUser.tag} немає попереджень.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const lines = list.map(
    (w, i) => `${i + 1}. ${w.reason}\n_від ${w.moderatorTag}, <t:${Math.floor(w.timestamp / 1000)}:R>_`
  );

  await interaction.reply({
    content: `Попередження ${targetUser.tag} (${list.length}):\n${lines.join('\n')}`,
    flags: MessageFlags.Ephemeral
  });
  // Читання списку попереджень — не подія модерації сама по собі, тому в лог не пишемо.
}

async function handleClearWarnings(interaction) {
  const targetUser = interaction.options.getUser('юзер');
  const hadAny = clearWarnings(interaction.guildId, targetUser.id);
  await interaction.reply({
    content: hadAny ? `Попередження ${targetUser.tag} очищено.` : `У ${targetUser.tag} і так не було попереджень.`,
    flags: MessageFlags.Ephemeral
  });
  if (hadAny) {
    await sendLog(interaction.guild, {
      type: 'unwarn',
      title: 'Попередження очищено',
      fields: [
        { name: 'Учасник', value: `${targetUser.tag} (${targetUser.id})` },
        { name: 'Модератор', value: interaction.user.tag }
      ]
    });
  }
}

async function handleClear(interaction) {
  const botMember = await getBotMember(interaction);
  if (!botMember.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({ content: 'У бота немає права Manage Messages на цьому сервері.', flags: MessageFlags.Ephemeral });
    return;
  }

  const count = interaction.options.getInteger('кількість');
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    await interaction.reply({ content: 'Цю команду можна використовувати тільки в текстовому каналі.', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    // Другий аргумент true = пропускати повідомлення старші 14 днів
    // замість падіння з помилкою (обмеження самого Discord API).
    const deleted = await channel.bulkDelete(count, true);
    await interaction.reply({
      content: `Видалено ${deleted.size} повідомлень. (Discord не дозволяє масово видаляти повідомлення старші 14 днів — вони пропускаються.)`,
      flags: MessageFlags.Ephemeral
    });
    await sendLog(interaction.guild, {
      type: 'clear',
      title: 'Повідомлення видалено',
      fields: [
        { name: 'Канал', value: `${channel}` },
        { name: 'Модератор', value: interaction.user.tag },
        { name: 'Видалено', value: String(deleted.size), inline: true }
      ]
    });
  } catch (err) {
    log.error('[PraBot] Помилка очищення повідомлень:', err.message);
    await interaction.reply({ content: 'Не вдалось видалити повідомлення.', flags: MessageFlags.Ephemeral });
  }
}

// -----------------------------------------------------------------------
// Інформація
// -----------------------------------------------------------------------

// Форматує секунди в короткий людський вигляд: "2 д 3 год 14 хв".
// Секунди показуємо лише тоді, коли бот щойно стартував (менше хвилини) —
// інакше рядок тільки захаращується непотрібною точністю.
function formatUptime(totalSeconds) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days) parts.push(`${days} д`);
  if (hours) parts.push(`${hours} год`);
  if (minutes) parts.push(`${minutes} хв`);
  if (parts.length === 0) parts.push(`${seconds} с`);
  return parts.join(' ');
}

const toMb = bytes => (bytes / 1024 / 1024).toFixed(1);

async function handleStats(interaction) {
  const sentAt = Date.now();
  await interaction.reply({ content: 'Збираю статистику...', flags: MessageFlags.Ephemeral });
  const roundTrip = Date.now() - sentAt;
  const wsPing = Math.round(interaction.client.ws.ping);

  const mem = process.memoryUsage();
  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();
  const usedMemBytes = totalMemBytes - freeMemBytes;
  const systemUsedPct = totalMemBytes > 0 ? ((usedMemBytes / totalMemBytes) * 100).toFixed(1) : '?';

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('Статистика PraBot')
    .addFields(
      {
        name: 'Затримка Discord API (heartbeat)',
        value: wsPing >= 0 ? `${wsPing} мс` : 'ще обчислюється, спробуй ще раз за хвилину',
        inline: true
      },
      { name: 'Час відповіді на цю команду', value: `${roundTrip} мс`, inline: true },
      { name: 'Час роботи процесу', value: formatUptime(Math.floor(process.uptime())), inline: true },
      { name: 'Памʼять процесу (RSS)', value: `${toMb(mem.rss)} МБ`, inline: true },
      { name: 'Heap (використано / всього)', value: `${toMb(mem.heapUsed)} / ${toMb(mem.heapTotal)} МБ`, inline: true },
      { name: 'External + Buffers', value: `${toMb(mem.external + (mem.arrayBuffers ?? 0))} МБ`, inline: true },
      {
        name: 'Памʼять пристрою/сервера',
        value: `${toMb(usedMemBytes)} / ${toMb(totalMemBytes)} МБ (${systemUsedPct}%)`
      }
    )
    .setFooter({ text: 'Created by A and I studio' })
    .setTimestamp();

  await interaction.editReply({ content: null, embeds: [embed] });
}

async function handleServerInfo(interaction) {
  const guild = interaction.guild;
  const owner = await guild.fetchOwner().catch(() => null);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(guild.name)
    .addFields(
      { name: 'Учасників', value: String(guild.memberCount), inline: true },
      { name: 'Власник', value: owner ? owner.user.tag : 'невідомо', inline: true },
      { name: 'Рівень бусту', value: String(guild.premiumTier ?? 0), inline: true },
      { name: 'Створено', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
      { name: 'ID сервера', value: guild.id, inline: true }
    );

  const icon = guild.iconURL();
  if (icon) embed.setThumbnail(icon);

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleUserInfo(interaction) {
  const targetUser = interaction.options.getUser('юзер') ?? interaction.user;
  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(targetUser.tag)
    .setThumbnail(targetUser.displayAvatarURL())
    .addFields(
      { name: 'ID', value: targetUser.id, inline: true },
      { name: 'Акаунт створено', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:D>`, inline: true }
    );

  if (member) {
    const roles = member.roles.cache
      .filter(r => r.id !== interaction.guildId)
      .map(r => `${r}`)
      .join(', ') || 'немає';

    embed.addFields(
      {
        name: 'Приєднався до сервера',
        value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'невідомо',
        inline: true
      },
      { name: 'Ролі', value: roles }
    );
  } else {
    embed.setDescription('Цей користувач не є учасником сервера.');
  }

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleSettings(interaction) {
  const settings = getGuildSettings(interaction.guildId);

  const channelText = settings.welcomeChannelId ? `<#${settings.welcomeChannelId}>` : 'не встановлено';
  const roleText = settings.autoRoleId ? `<@&${settings.autoRoleId}>` : 'не встановлено';
  const welcomeText = settings.welcomeMessage ? `\n> ${settings.welcomeMessage}` : ' не встановлено';
  const leaveText = settings.leaveMessage ? `\n> ${settings.leaveMessage}` : ' не встановлено';
  const logsText = settings.logChannelId ? `<#${settings.logChannelId}>` : 'вимкнено';
  const warningsCount = Object.values(settings.warnings).reduce((sum, list) => sum + list.length, 0);

  const disabledEvents = Object.entries(settings.logEvents)
    .filter(([, enabled]) => !enabled)
    .map(([key]) => EVENT_LABELS[key] ?? key);
  const disabledEventsText = disabledEvents.length > 0 ? disabledEvents.join(', ') : 'немає (усі типи увімкнені)';

  await interaction.reply({
    content:
      `Налаштування PraBot\n` +
      `Канал привітань/виходів: ${channelText}\n` +
      `Авто-роль: ${roleText}\n` +
      `Канал журналу дій: ${logsText}\n` +
      `Вимкнені типи подій у журналі: ${disabledEventsText}\n` +
      `Текст привітання:${welcomeText}\n` +
      `Текст про вихід:${leaveText}\n` +
      `Активних попереджень на сервері: ${warningsCount}`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleHelp(interaction) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('Команди PraBot')
    .setDescription('Усі команди — підкоманди /prabot, доступні лише адміністраторам сервера.')
    .addFields(
      {
        name: 'Привітання та вихід',
        value:
          '`welcome-text` — текст привітання\n' +
          '`welcome-channel` — канал для привітань/виходів\n' +
          '`welcome-off` — вимкнути привітання\n' +
          '`leave-message` — текст про вихід\n' +
          '`leave-off` — вимкнути повідомлення про вихід'
      },
      {
        name: 'Авто-роль',
        value: '`autorole` — роль для нових учасників\n`autorole-off` — вимкнути'
      },
      {
        name: 'Журнал дій',
        value:
          '`logs-channel` — канал для журналу\n' +
          '`logs-off` — вимкнути журнал повністю\n' +
          '`logs-toggle` — увімкнути/вимкнути окремий тип подій (варни, кіки, вхід/вихід тощо)'
      },
      {
        name: 'Модерація',
        value:
          '`kick` • `ban` • `timeout` • `untimeout`\n' +
          '`warn` • `warnings` • `clearwarnings`\n' +
          '`clear` — видалити повідомлення в каналі'
      },
      {
        name: 'Інформація',
        value: '`stats` — памʼять, пінг, аптайм (+ кнопка перезавантаження)\n`serverinfo` • `userinfo` • `settings` • `help`'
      }
    )
    .setFooter({ text: 'Created by A and I studio' });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
