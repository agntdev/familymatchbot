import { buildBot } from "./bot.js";
import { setDefaultCommands } from "./toolkit/index.js";

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error("BOT_TOKEN is required");
    process.exit(1);
  }
  const bot = await buildBot(token);
  // Publish the localized command menu on every deploy so changed descriptions
  // are applied to the default scope for all private chats.
  await setDefaultCommands(bot);
  bot.start();
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
