import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { DomainStore, matchesKey, profileKey, userId } from "../domain.js";
import { browseProfiles } from "./browse-start.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";

const composer = new Composer<Ctx>();

// Commands are shortcuts to the same screens exposed by the main menu. Resetting
// the session first makes every command an interrupt: a pending name, age, photo,
// or message prompt can never consume text intended for the new screen.
function interrupt(ctx: Ctx): void {
  ctx.session.step = "idle";
  ctx.session.draft = undefined;
  ctx.session.searchDraft = undefined;
  ctx.session.editField = undefined;
  ctx.session.activeMatchId = undefined;
  ctx.session.reportReason = undefined;
}

const menu = inlineKeyboard([[inlineButton("⬅️ В меню", "menu:main")]]);

composer.command("profile", async (ctx) => {
  interrupt(ctx);
  const profile = await new DomainStore(ctx).get(profileKey(userId(ctx)));
  if (!profile) {
    await ctx.reply("У вас пока нет профиля — создайте его за несколько минут.", {
      reply_markup: inlineKeyboard([[inlineButton("Создать профиль", "profile:create:start")], [inlineButton("⬅️ В меню", "menu:main")]]),
    });
    return;
  }
    await ctx.reply("Откройте свою анкету, чтобы рассказать о себе и планах на семью.", {
    reply_markup: inlineKeyboard([[inlineButton("Мой профиль", "profile:manage")], [inlineButton("⬅️ В меню", "menu:main")]]),
  });
});

composer.command("search", async (ctx) => {
  interrupt(ctx);
  await browseProfiles(ctx);
});

composer.command("likes", async (ctx) => {
  interrupt(ctx);
  await ctx.reply("Посмотрим, кому вы понравились.", { reply_markup: inlineKeyboard([[inlineButton("Посмотреть симпатии", "likes:list")], [inlineButton("⬅️ В меню", "menu:main")]]) });
});

composer.command("matches", async (ctx) => {
  interrupt(ctx);
  const ids = await new DomainStore(ctx).get<string[]>(matchesKey(userId(ctx))) ?? [];
  await ctx.reply(ids.length ? "Взаимная симпатия уже открыла вам путь к спокойному знакомству." : "Пока взаимных симпатий нет — знакомьтесь без спешки, и всё может начаться с доброго шага.", {
    reply_markup: inlineKeyboard([[inlineButton("Открыть сообщения", "conversations:list")], [inlineButton("⬅️ В меню", "menu:main")]]),
  });
});

composer.command("messages", async (ctx) => {
  interrupt(ctx);
  await ctx.reply("Здесь хранятся ваши разговоры с взаимными симпатиями.", { reply_markup: inlineKeyboard([[inlineButton("Открыть разговоры", "conversations:list")], [inlineButton("⬅️ В меню", "menu:main")]]) });
});

composer.command("filters", async (ctx) => {
  interrupt(ctx);
  await ctx.reply("Настройте поиск человека, с которым вам будет близко строить семью.", { reply_markup: inlineKeyboard([[inlineButton("Настроить поиск", "search:open")], [inlineButton("⬅️ В меню", "menu:main")]]) });
});

composer.command("settings", async (ctx) => {
  interrupt(ctx);
  await ctx.reply("Здесь можно позаботиться о видимости анкеты и безопасности.", { reply_markup: inlineKeyboard([[inlineButton("Открыть настройки", "settings:open")], [inlineButton("⬅️ В меню", "menu:main")]]) });
});

export { interrupt };
export default composer;
