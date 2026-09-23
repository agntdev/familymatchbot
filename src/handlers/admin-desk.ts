import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem, requireOwner } from "../toolkit/index.js";
import { profileKey, read, reportsKey, write, type Profile } from "../domain/store.js";

registerMainMenuItem({ label: "Панель владельца", data: "admin:desk", order: 90 });
const composer = new Composer<Ctx>();
composer.callbackQuery("admin:desk", async (ctx) => { await ctx.answerCallbackQuery(); if (!(await requireOwner(ctx as never))) return; await ctx.reply("Панель владельца доступна. Выберите действие.", { reply_markup: inlineKeyboard([[inlineButton("Проверить жалобы", "admin:reports"), inlineButton("Мои настройки", "admin:status")]]) }); });
composer.callbackQuery("admin:reports", async (ctx) => { await ctx.answerCallbackQuery(); if (!(await requireOwner(ctx as never))) return; const keys = await read<string[]>(ctx, reportsKey("index")) ?? []; if (!keys.length) { await ctx.reply("Новых жалоб нет."); return; } const buttons: { text: string; callback_data: string }[][] = []; for (const key of keys.slice(-20)) { const report = await read<{ target: string; reason: string }>(ctx, key); if (report) buttons.push([inlineButton(`${report.reason} · скрыть`, `admin:hide:${report.target}`)]); } await ctx.reply("Последние жалобы", { reply_markup: inlineKeyboard(buttons.length ? buttons : [[inlineButton("Назад", "admin:desk")]]) }); });
composer.callbackQuery("admin:status", async (ctx) => { await ctx.answerCallbackQuery(); if (!(await requireOwner(ctx as never))) return; await ctx.reply(adminChatId(ctx) ? "Владелец настроен. Жалобы и новые анкеты будут приходить сюда." : "Owner access isn't set up yet."); });
composer.callbackQuery(/^admin:hide:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); if (!(await requireOwner(ctx as never))) return; const p = await read<Profile>(ctx, profileKey(ctx.match[1])); if (!p) { await ctx.reply("Анкета уже недоступна."); return; } p.visibility = false; await write(ctx, profileKey(p.userId), p); await ctx.reply("Анкета скрыта до проверки."); });
export default composer;
