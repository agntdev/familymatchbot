import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { mainMenuFor } from "../main-menu.js";

// The /start handler renders the bot's MAIN MENU — the primary way users operate
// a button-first bot. A feature adds its own button by calling
// `registerMainMenuItem(...)` in its own `src/handlers/<slug>.ts`; this handler
// renders whatever is registered (plus a Help button), so you do NOT edit this
// file to add a feature. Send ONE message — no placeholder line above the menu.
const composer = new Composer<Ctx>();

const WELCOME = "Найди человека, с которым захочется создать семью 🤍\nЗнакомства для серьёзных отношений и создания семьи";

composer.command("start", async (ctx) => {
  ctx.session.step = "idle";
  ctx.session.draft = undefined;
  ctx.session.searchDraft = undefined;
  ctx.session.editField = undefined;
  ctx.session.activeMatchId = undefined;
  await ctx.reply(WELCOME, { reply_markup: mainMenuFor() });
});

// "Back to menu" — re-render the main menu in place from any sub-view.
composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  // A menu button can be attached to a photo card. Telegram cannot edit a
  // photo into text, so render a fresh menu for media messages and keep the
  // quieter in-place navigation for ordinary text messages.
  if (ctx.callbackQuery.message?.text !== undefined) {
    await ctx.editMessageText(WELCOME, { reply_markup: mainMenuFor() });
  } else {
    await ctx.reply(WELCOME, { reply_markup: mainMenuFor() });
  }
});

export default composer;
