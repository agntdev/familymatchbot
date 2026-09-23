import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  DomainStore,
  now,
  searchFiltersKey,
  userId,
  type SearchFilters,
  type SearchGender,
  type SearchRelationshipStatus,
} from "../domain.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "🔎 Изменить поиск", data: "search:open", order: 25 });

const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("⬅️ Назад", "search:cancel")]]);

type Draft = NonNullable<Ctx["session"]["searchDraft"]>;

function draft(ctx: Ctx): Draft {
  return (ctx.session.searchDraft ??= {});
}

function agePrompt(ctx: Ctx, from: boolean): Promise<unknown> {
  ctx.session.step = from ? "search_age_from" : "search_age_to";
  return ctx.reply(
    from ? "От какого возраста искать? Укажите число от 18 до 99." : "До какого возраста искать? Укажите число от 18 до 99.",
    { reply_markup: inlineKeyboard([[inlineButton("Любой возраст", from ? "search:agefrom:any" : "search:ageto:any")], [inlineButton("⬅️ Назад", from ? "search:back:gender" : "search:back:agefrom")], [inlineButton("Отмена", "search:cancel")]]) },
  );
}

function genderKeyboard() {
  return inlineKeyboard([
    [inlineButton("Мужчины", "search:gender:m"), inlineButton("Женщины", "search:gender:f")],
    [inlineButton("Другой вариант", "search:gender:other"), inlineButton("Любой пол", "search:gender:any")],
    [inlineButton("Очистить фильтры", "search:clear"), inlineButton("Отмена", "search:cancel")],
  ]);
}

function relationshipKeyboard() {
  return inlineKeyboard([
    [inlineButton("Свободен(а)", "search:relationship:single"), inlineButton("В отношениях", "search:relationship:relationship")],
    [inlineButton("Разведён(а)", "search:relationship:divorced"), inlineButton("Вдовец или вдова", "search:relationship:widowed")],
    [inlineButton("Любой статус", "search:relationship:any")],
    [inlineButton("⬅️ Назад", "search:back:city"), inlineButton("Отмена", "search:cancel")],
  ]);
}

function describe(filters: Draft): string {
  const gender = ({ m: "мужчины", f: "женщины", other: "другой вариант", any: "любой пол" } as Record<string, string>)[filters.gender ?? "any"];
  const age = filters.ageFrom || filters.ageTo ? `${filters.ageFrom ?? 18}–${filters.ageTo ?? 99} лет` : "любой возраст";
  const city = filters.city || "любой город";
  const status = ({ single: "свободные", relationship: "в отношениях", divorced: "разведённые", widowed: "вдовцы и вдовы", any: "любой статус" } as Record<string, string>)[filters.relationshipStatus ?? "any"];
  return `Сейчас ищем: ${gender}, ${age}, ${city}, ${status}.`;
}

async function showSearch(ctx: Ctx): Promise<void> {
  const saved = await new DomainStore(ctx).get<SearchFilters>(searchFiltersKey(userId(ctx)));
  ctx.session.searchDraft = saved ? { ...saved } : { gender: "any", relationshipStatus: "any" };
  ctx.session.step = "idle";
  await ctx.reply(
    `${saved ? describe(ctx.session.searchDraft) : "Настроим поиск подходящих анкет."}\n\nВыберите пол человека, которого хотите встретить.`,
    { reply_markup: genderKeyboard() },
  );
}

composer.callbackQuery("search:open", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showSearch(ctx);
});

composer.callbackQuery("browse:search", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showSearch(ctx);
});

composer.callbackQuery(/^search:gender:(m|f|other|any)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  draft(ctx).gender = ctx.match[1] as SearchGender;
  await agePrompt(ctx, true);
});

composer.callbackQuery("search:agefrom:any", async (ctx) => {
  await ctx.answerCallbackQuery();
  draft(ctx).ageFrom = undefined;
  draft(ctx).ageTo = undefined;
  ctx.session.step = "search_city";
  await ctx.reply("В каком городе искать?", { reply_markup: inlineKeyboard([[inlineButton("Любой город", "search:city:any")], [inlineButton("⬅️ Назад", "search:back:age")], [inlineButton("Отмена", "search:cancel")]]) });
});

composer.callbackQuery("search:agefrom:keep", async (ctx) => {
  await ctx.answerCallbackQuery();
  await agePrompt(ctx, false);
});

composer.callbackQuery("search:ageto:any", async (ctx) => {
  await ctx.answerCallbackQuery();
  draft(ctx).ageTo = undefined;
  ctx.session.step = "search_city";
  await ctx.reply("В каком городе искать?", { reply_markup: inlineKeyboard([[inlineButton("Любой город", "search:city:any")], [inlineButton("⬅️ Назад", "search:back:age")], [inlineButton("Отмена", "search:cancel")]]) });
});

composer.callbackQuery("search:city:any", async (ctx) => {
  await ctx.answerCallbackQuery();
  draft(ctx).city = undefined;
  ctx.session.step = "idle";
  await ctx.reply("Какой семейный статус вам подходит?", { reply_markup: relationshipKeyboard() });
});

composer.callbackQuery(/^search:relationship:(single|relationship|divorced|widowed|any)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  draft(ctx).relationshipStatus = ctx.match[1] as SearchRelationshipStatus;
  await ctx.reply(`${describe(draft(ctx))}\n\nСохранить эти настройки?`, { reply_markup: inlineKeyboard([[inlineButton("Сохранить поиск", "search:save")], [inlineButton("Изменить", "search:open")], [inlineButton("Отмена", "search:cancel")]]) });
});

composer.callbackQuery("search:save", async (ctx) => {
  await ctx.answerCallbackQuery();
  const current = draft(ctx);
  const filters: SearchFilters = {
    gender: current.gender ?? "any",
    ...(current.ageFrom === undefined ? {} : { ageFrom: current.ageFrom }),
    ...(current.ageTo === undefined ? {} : { ageTo: current.ageTo }),
    ...(current.city ? { city: current.city } : {}),
    relationshipStatus: current.relationshipStatus ?? "any",
    updatedAt: now(),
  };
  const saved = await new DomainStore(ctx).set(searchFiltersKey(userId(ctx)), filters);
  ctx.session.searchDraft = undefined;
  ctx.session.step = "idle";
  if (!saved) {
    await ctx.reply("Настройки готовы, но хранилище пока недоступно. Попробуйте сохранить поиск позже.", { reply_markup: back });
    return;
  }
  await ctx.reply("Поиск сохранён. Теперь в знакомствах будут только подходящие анкеты.", { reply_markup: inlineKeyboard([[inlineButton("Открыть знакомства", "browse:start")], [inlineButton("В меню", "menu:main")]]) });
});

composer.callbackQuery("search:clear", async (ctx) => {
  await ctx.answerCallbackQuery();
  const removed = await new DomainStore(ctx).delete(searchFiltersKey(userId(ctx)));
  ctx.session.searchDraft = undefined;
  ctx.session.step = "idle";
  await ctx.reply(removed ? "Фильтры очищены — покажем больше анкет." : "Фильтры готовы к очистке, но хранилище пока недоступно.", { reply_markup: inlineKeyboard([[inlineButton("Открыть знакомства", "browse:start")], [inlineButton("В меню", "menu:main")]]) });
});

composer.callbackQuery("search:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.searchDraft = undefined;
  ctx.session.step = "idle";
  await ctx.editMessageText("Настройки поиска не изменились.", { reply_markup: inlineKeyboard([[inlineButton("Открыть знакомства", "browse:start")], [inlineButton("В меню", "menu:main")]]) });
});

composer.callbackQuery(/^search:back:(gender|age|city)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const target = ctx.match[1];
  if (target === "gender") { ctx.session.step = "idle"; await ctx.editMessageText("Выберите пол человека, которого хотите встретить.", { reply_markup: genderKeyboard() }); return; }
  if (target === "age" || target === "agefrom") { await agePrompt(ctx, target === "age"); return; }
  ctx.session.step = "search_city";
  await ctx.editMessageText("В каком городе искать?", { reply_markup: inlineKeyboard([[inlineButton("Любой город", "search:city:any")], [inlineButton("⬅️ Назад", "search:back:age")], [inlineButton("Отмена", "search:cancel")]]) });
});

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  const current = draft(ctx);
  if (ctx.session.step === "search_age_from" || ctx.session.step === "search_age_to") {
    const age = Number(text);
    if (!Number.isInteger(age) || age < 18 || age > 99) {
      await ctx.reply("Укажите целый возраст от 18 до 99 лет.", { reply_markup: inlineKeyboard([[inlineButton("Любой возраст", ctx.session.step === "search_age_from" ? "search:agefrom:any" : "search:ageto:any")], [inlineButton("Отмена", "search:cancel")]]) });
      return;
    }
    if (ctx.session.step === "search_age_from") {
      current.ageFrom = age;
      await agePrompt(ctx, false);
      return;
    }
    if (current.ageFrom !== undefined && age < current.ageFrom) {
      await ctx.reply(`Возраст «до» не может быть меньше ${current.ageFrom}. Укажите другое значение.`, { reply_markup: back });
      return;
    }
    current.ageTo = age;
    ctx.session.step = "search_city";
    await ctx.reply("В каком городе искать?", { reply_markup: inlineKeyboard([[inlineButton("Любой город", "search:city:any")], [inlineButton("Отмена", "search:cancel")]]) });
    return;
  }
  if (ctx.session.step === "search_city") {
    if (text.length < 2 || text.length > 80) {
      await ctx.reply("Напишите город от 2 до 80 символов.", { reply_markup: back });
      return;
    }
    current.city = text;
    ctx.session.step = "idle";
    await ctx.reply("Какой семейный статус вам подходит?", { reply_markup: relationshipKeyboard() });
    return;
  }
  await next();
});

export default composer;
