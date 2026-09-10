// Одноразовий скрипт: встановлює аватарку бота з assets/avatar.png.
// Запускати вручну: npm run set-avatar
//
// НЕ підключено до index.js навмисно — Discord дозволяє міняти аватар
// не частіше ~2 разів на годину. Якби це виконувалось при кожному старті
// бота (а на телефоні бот може перезапускатись часто), можна було б
// нарватись на rate limit або взагалі тимчасове блокування зміни аватара.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const log = require('./utils/logger');

const AVATAR_PATH = path.join(__dirname, 'assets', 'avatar.png');

if (!process.env.DISCORD_TOKEN) {
  log.error('[PraBot] DISCORD_TOKEN не заданий у .env.');
  process.exit(1);
}

if (!fs.existsSync(AVATAR_PATH)) {
  log.error(`[PraBot] Файл не знайдено: ${AVATAR_PATH}`);
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async readyClient => {
  try {
    await readyClient.user.setAvatar(AVATAR_PATH);
    log.info(`[PraBot] Аватарку встановлено для ${readyClient.user.tag}.`);
  } catch (err) {
    log.error('[PraBot] Не вдалось встановити аватарку:', err.message);
    if (err.message?.includes('rate limit')) {
      log.error('→ Discord обмежує зміну аватара — спробуй ще раз пізніше (десь через годину).');
    }
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
  log.error('[PraBot] Не вдалось увійти в Discord:', err.message);
  process.exit(1);
});
