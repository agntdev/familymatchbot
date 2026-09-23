import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "VIP", data: "vip:open", order: 55 });
const composer = new Composer<Ctx>();

function show(ctx: Ctx) {
  return ctx.reply("VIP пока готовится. Мы сообщим, когда станут доступны дополнительные возможности.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ В меню", "menu:main")]]),
  });
}

composer.callbackQuery("vip:open", async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx); });
composer.command("vip", async (ctx) => { ctx.session.step = "idle"; await show(ctx); });

export default composer;
