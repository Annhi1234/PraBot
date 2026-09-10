require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { loadCommands } = require('./utils/loadCommands');
const log = require('./utils/logger');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  log.error(
    '[PraBot] Не вистачає змінних у .env (DISCORD_TOKEN, CLIENT_ID, GUILD_ID). Перевір .env.example.'
  );
  process.exit(1);
}

const { json: commandsJson } = loadCommands();

if (commandsJson.length === 0) {
  log.error('[PraBot] Не знайдено жодної валідної команди в папці commands/. Нічого реєструвати.');
  process.exit(1);
}

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    // Спершу перевіряємо, що токен і CLIENT_ID взагалі валідні й відповідають
    // один одному — якщо ні, краще сказати про це прямо, ніж отримати
    // незрозумілу помилку 401/403 нижче.
    const app = await rest.get(Routes.oauth2CurrentApplication());
    if (app.id !== CLIENT_ID) {
      log.warn(
        `[PraBot] УВАГА: CLIENT_ID у .env (${CLIENT_ID}) не збігається з ID застосунку цього токена (${app.id}). ` +
        'Виправ CLIENT_ID у .env — інакше команди можуть реєструватись не туди.'
      );
    }

    log.info(`Реєструю ${commandsJson.length} слеш-команд(и) для сервера ${GUILD_ID}...`);

    const registered = await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commandsJson }
    );

    log.info(
      `Готово. Зареєстровано (з'являться миттєво на сервері): ` +
      registered.map(c => `/${c.name}`).join(', ')
    );
  } catch (err) {
    log.error('Помилка реєстрації команд:', err.message);
    if (err.status === 401) {
      log.error('→ Схоже, DISCORD_TOKEN невірний або застарілий.');
    } else if (err.status === 403 || err.status === 404) {
      log.error('→ Перевір GUILD_ID (бот доданий саме на цей сервер?) і що бот запрошений зі scope "applications.commands".');
    }
    process.exit(1);
  }
})();
