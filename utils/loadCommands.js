const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');
const log = require('./logger');

/**
 * Читає всі файли команд з /commands, валідує їх і повертає:
 * - collection: Collection<name, command>  — для обробки взаємодій
 * - json: Array<object>                     — готово для реєстрації через REST API
 *
 * Битий файл команди (синтаксична помилка, відсутній data/execute)
 * пропускається з попередженням, а не валить весь процес.
 */
function loadCommands() {
  const collection = new Collection();
  const json = [];

  const commandsPath = path.join(__dirname, '..', 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    try {
      const filePath = path.join(commandsPath, file);
      delete require.cache[require.resolve(filePath)]; // на випадок гарячого перезавантаження
      const command = require(filePath);

      if (!command?.data?.name || typeof command.execute !== 'function') {
        log.warn(`[PraBot] Файл команди ${file} пропущено: немає data.name або execute()`);
        continue;
      }

      collection.set(command.data.name, command);
      json.push(command.data.toJSON());
    } catch (err) {
      log.error(`[PraBot] Не вдалось завантажити команду з ${file}:`, err.message);
    }
  }

  return { collection, json };
}

module.exports = { loadCommands };
