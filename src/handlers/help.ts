import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";

// /help — plain-language explanation for non-technical users. This bot is
// button-driven: tell the user to tap /start to open the menu rather than listing
// slash commands. The same text is shown when the user taps the Help button on the
// main menu (`menu:help`). Enhance the copy for your specific bot; keep it short.
const composer = new Composer<Ctx>();

const HELP =
  "ℹ️ «Никах» помогает взрослым людям встретить близкого человека для серьёзных отношений и семьи. Откройте /start и выберите нужный раздел кнопкой.\n\n" +
  "Создайте анкету, настройте поиск, знакомьтесь с подходящими людьми и пишите только взаимным симпатиям. Берегите личные границы и сообщайте о том, что кажется небезопасным.";

const backToMenu = inlineKeyboard([[inlineButton("⬅️ В меню", "menu:main")]]);

composer.command("help", async (ctx) => {
  ctx.session.step = "idle";
  ctx.session.draft = undefined;
  ctx.session.searchDraft = undefined;
  ctx.session.editField = undefined;
  ctx.session.activeMatchId = undefined;
  await ctx.reply(HELP);
});

composer.callbackQuery("menu:help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(HELP, { reply_markup: backToMenu });
});

export default composer;
