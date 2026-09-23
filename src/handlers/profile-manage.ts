import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { read, saveProfile, userId, type Profile } from "../domain/store.js";

registerMainMenuItem({ label: "Моя анкета", data: "profile:manage", order: 40 });
const composer = new Composer<Ctx>();
composer.callbackQuery("profile:manage", async (ctx) => { await ctx.answerCallbackQuery(); const p = await read<Profile>(ctx, `profile:${userId(ctx)}`); if (!p) { await ctx.reply("У вас пока нет анкеты — давайте создадим её вместе.", { reply_markup: inlineKeyboard([[inlineButton("Создать профиль", "profile:create:start")]]) }); return; } await show(ctx, p); });
composer.callbackQuery("profile:visibility", async (ctx) => { await ctx.answerCallbackQuery(); const p = await read<Profile>(ctx, `profile:${userId(ctx)}`); if (!p) { await ctx.reply("Сначала создайте анкету."); return; } p.visibility = !p.visibility; await saveProfile(ctx, p); await ctx.reply(p.visibility ? "Анкета снова видна в подборе." : "Анкета скрыта. Вы сможете вернуть её в любой момент.", { reply_markup: inlineKeyboard([[inlineButton("Моя анкета", "profile:manage")]]) }); });
async function show(ctx: Ctx, p: Profile): Promise<void> { await ctx.reply(`${p.name}, ${p.age}, ${p.city}\n\n${p.bio}\n\n${p.visibility ? "Анкета видна в подборе." : "Анкета скрыта."}`, { reply_markup: inlineKeyboard([[inlineButton("Скрыть или показать", "profile:visibility")], [inlineButton("Смотреть анкеты", "browse:start"), inlineButton("⬅️ В меню", "menu:main")]]) }); }
export default composer;
