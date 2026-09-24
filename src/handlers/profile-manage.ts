import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { DomainStore, deactivateProfileRelationships, matchesKey, normalizeTelegramUsername, now, photoCaption, profileIndexKey, profileKey, profileLifecycle, telegramUsernameKey, telegramUsernameOwnerKey, userId, profileSummary, validTelegramUsername, withTelegramDefaults, type Profile } from "../domain.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { blockMessage, enforceViolation, inspectProfileText, recordPolicyAudit } from "../content-policy.js";

registerMainMenuItem({ label: "👤 Моя анкета", data: "profile:manage", order: 10 });
const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("⬅️ В меню", "menu:main")]]);
const menu = back;
const force = (placeholder: string) => ({ force_reply: true as const, input_field_placeholder: placeholder });
const TELEGRAM_PRIVACY_NOTICE = "🔒 До взаимной симпатии ваш Telegram не видят другие пользователи. Он станет доступен только после взаимной симпатии.";
const fields = inlineKeyboard([[inlineButton("Имя", "profile:edit:name"), inlineButton("Возраст", "profile:edit:age")], [inlineButton("Город", "profile:edit:city"), inlineButton("Семейный статус", "profile:edit:maritalStatus")], [inlineButton("Национальность", "profile:edit:nationality"), inlineButton("Профессия", "profile:edit:profession")], [inlineButton("Рост", "profile:edit:height"), inlineButton("О себе", "profile:edit:bio")], [inlineButton("Цель знакомства", "profile:edit:purpose")], [inlineButton("💬 Мой статус", "profile:edit:status")], [inlineButton("Telegram", "profile:edit:telegram")], [inlineButton("⬅️ Назад", "profile:manage")]]);
function manageKeyboard(p: Profile) { const profile = withTelegramDefaults(p); return inlineKeyboard([[inlineButton("Изменить поле", "profile:edit:fields")], [inlineButton("Управление фото", "profile:photos:manage")], [inlineButton(`Показывать мой Telegram при взаимной симпатии: ${profile.showTelegramOnMatch ? "Да" : "Нет"}`, "profile:telegram:toggle")], [inlineButton(profile.visibility ? "Скрыть профиль" : "Показать профиль", "profile:visibility:toggle")], [inlineButton("Предпросмотр", "profile:preview"), inlineButton("Удалить профиль", "profile:delete")], [inlineButton("⬅️ В меню", "menu:main")]]); }
async function show(ctx: Ctx): Promise<void> { const stored = await new DomainStore(ctx).get<Profile>(profileKey(userId(ctx))); if (!stored) { await ctx.reply("У вас пока нет профиля — создайте его за несколько минут.", { reply_markup: inlineKeyboard([[inlineButton("Создать профиль", "profile:create:start")], [inlineButton("⬅️ В меню", "menu:main")]]) }); return; } if (profileLifecycle(stored) === "deleted") { await ctx.reply("Анкета сохранена, но сейчас скрыта.", { reply_markup: inlineKeyboard([[inlineButton("♻️ Восстановить анкету", "profile:restore")], [inlineButton("⬅️ В меню", "menu:main")]]) }); return; } const p = withTelegramDefaults(stored); await ctx.reply(profileSummary(p), { reply_markup: manageKeyboard(p) }); }
composer.callbackQuery("profile:manage", async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx); });
composer.callbackQuery("profile:edit:fields", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText("Что хотите изменить?", { reply_markup: fields }); });
composer.callbackQuery("profile:edit:maritalStatus", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Выберите семейный статус.", { reply_markup: inlineKeyboard([[inlineButton("Не был(а) в браке", "profile:marital:set:single")], [inlineButton("В отношениях", "profile:marital:set:relationship")], [inlineButton("Разведён(а)", "profile:marital:set:divorced")], [inlineButton("Вдовец или вдова", "profile:marital:set:widowed")]]) }); });
composer.callbackQuery(/^profile:marital:set:(single|relationship|divorced|widowed)$/, async (ctx) => { await ctx.answerCallbackQuery(); const p = await new DomainStore(ctx).get<Profile>(profileKey(userId(ctx))); if (!p) { await ctx.reply("Профиль не найден."); return; } p.maritalStatus = ({ single: "Не был(а) в браке", relationship: "В отношениях", divorced: "Разведён(а)", widowed: "Вдовец или вдова" } as Record<string, string>)[ctx.match[1]]; p.updatedAt = now(); await new DomainStore(ctx).set(profileKey(p.userId), p); await ctx.reply("Семейный статус обновлён.", { reply_markup: inlineKeyboard([[inlineButton("Мой профиль", "profile:manage")]]) }); });
composer.callbackQuery(/^profile:edit:(name|age|city|nationality|profession|height|bio|purpose)$/, async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.editField = ctx.match[1]; ctx.session.step = "edit_field"; const labels: Record<string, string> = { name: "имя", age: "возраст от 18 до 99", city: "город", nationality: "национальность до 100 символов", profession: "профессию", height: "рост от 120 до 230 см", bio: "рассказ о себе", purpose: "цель знакомства" }; await ctx.reply(`Введите ${labels[ctx.match[1]]}.`, { reply_markup: force("Введите новое значение") }); });
composer.callbackQuery("profile:edit:status", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.editField = "status"; ctx.session.step = "edit_field"; await ctx.reply("Напишите статус — до 100 символов.", { reply_markup: inlineKeyboard([[inlineButton("Удалить статус", "profile:status:clear")], [inlineButton("⬅️ Назад", "profile:edit:fields")]]) }); });
composer.callbackQuery("profile:status:clear", async (ctx) => { await ctx.answerCallbackQuery(); const store = new DomainStore(ctx); const p = await store.get<Profile>(profileKey(userId(ctx))); if (!p) { await ctx.reply("Профиль не найден."); return; } p.status = null; p.updatedAt = now(); await store.set(profileKey(p.userId), p); ctx.session.step = "idle"; ctx.session.editField = undefined; await ctx.reply("Статус удалён.", { reply_markup: inlineKeyboard([[inlineButton("Открыть профиль", "profile:manage")]]) }); });
composer.callbackQuery("profile:edit:telegram", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.telegramPrivacyNoticeShown = true;
  await ctx.reply(TELEGRAM_PRIVACY_NOTICE);
  const username = normalizeTelegramUsername(`@${ctx.from?.username ?? ""}`);
  ctx.session.editField = "telegram";
  ctx.session.draft = { telegramUsername: username };
  if (username) { ctx.session.step = "telegram"; await ctx.reply(`📱 Telegram: @${username}`, { reply_markup: inlineKeyboard([[inlineButton("Подтвердить", "profile:edit:telegram:confirm"), inlineButton("Изменить", "profile:edit:telegram:change")]]) }); return; }
  ctx.session.step = "telegram_manual";
  await ctx.reply("Пожалуйста, укажите ваш Telegram username в формате @username", { reply_markup: { keyboard: [[{ text: "Пропустить" }]], resize_keyboard: true, one_time_keyboard: true } });
});
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step === "telegram_manual" && ctx.session.editField === "telegram") {
    const text = ctx.message.text.trim();
    const username = text === "Пропустить" ? null : normalizeTelegramUsername(text);
    if (text !== "Пропустить" && !username) { await ctx.reply("Некорректный username. Используйте @ и от 5 до 32 латинских букв, цифр или _.", { reply_markup: force("@username") }); return; }
    ctx.session.draft = { telegramUsername: username }; ctx.session.step = "telegram";
    await ctx.reply(username ? `📱 Telegram: @${username}` : "📱 Telegram: не указан", { reply_markup: inlineKeyboard([[inlineButton("Подтвердить", "profile:edit:telegram:confirm"), inlineButton("Изменить", "profile:edit:telegram:change")]]) }); return;
  }
  if (ctx.session.step !== "edit_field" || !ctx.session.editField) { await next(); return; }
  const value = ctx.message.text.trim(); const field = ctx.session.editField; const stored = await new DomainStore(ctx).get<Profile>(profileKey(userId(ctx))); if (!stored) { ctx.session.step = "idle"; await ctx.reply("Профиль не найден. Создайте его заново."); return; } const p = withTelegramDefaults(stored); const max = field === "status" || field === "nationality" ? 100 : field === "bio" ? Number.POSITIVE_INFINITY : 500; if (field !== "bio" && (!value || value.length > max)) { await ctx.reply(field === "status" ? "Статус должен быть от 1 до 100 символов." : field === "nationality" ? "Укажите национальность от 1 до 100 символов." : "Значение должно быть от 1 до 500 символов.", { reply_markup: force("Введите новое значение") }); return; } if (field === "telegram") { return; } else if (field === "status") { p.status = value || null; } else if (field === "city") { p.city = value; } else if (field === "age") { const n = Number(value); if (!Number.isInteger(n) || n < 18 || n > 99) { await ctx.reply("Укажите возраст от 18 до 99 лет.", { reply_markup: force("Введите возраст") }); return; } p.age = n; } else if (field === "height") { const n = Number(value); if (!Number.isInteger(n) || n < 120 || n > 230) { await ctx.reply("Укажите рост от 120 до 230 сантиметров.", { reply_markup: force("Например, 170") }); return; } p.height = n; } else (p as unknown as Record<string, unknown>)[field] = value;
  if (field !== "bio") { const decision = inspectProfileText({ name: p.name, city: p.city, nationality: p.nationality, profession: p.profession, purpose: p.purpose }); await recordPolicyAudit(ctx, decision.kind === "allowed" ? "allowed" : "allowed-with-suggestion", decision); if (decision.kind === "suggestion") { await ctx.reply(decision.message!, { reply_markup: force("Введите чуть подробнее") }); return; } if (decision.kind === "explicit") { const event = await enforceViolation(ctx, decision); ctx.session.step = "idle"; await ctx.reply(blockMessage(event!), { reply_markup: menu }); return; } }
  p.updatedAt = now(); await new DomainStore(ctx).set(profileKey(p.userId), p); ctx.session.step = "idle"; ctx.session.editField = undefined; await ctx.reply("Изменения сохранены.", { reply_markup: inlineKeyboard([[inlineButton("Открыть профиль", "profile:manage")]]) }); });
async function saveTelegramEdit(ctx: Ctx): Promise<void> {
  const value = ctx.session.draft?.telegramUsername ?? null;
  const store = new DomainStore(ctx); const stored = await store.get<Profile>(profileKey(userId(ctx)));
  if (!stored) { await ctx.reply("Профиль не найден."); return; }
  const previousValue = withTelegramDefaults(stored).telegramUsername;
  if (value) {
    const ownerKey = telegramUsernameOwnerKey(value);
    const owner = await store.get<number>(ownerKey);
    if (owner !== undefined && owner !== userId(ctx)) {
      console.info("telegram username conflict", { username: value.toLowerCase(), owner, attemptedBy: userId(ctx) });
      await ctx.reply("Этот username уже используется. Укажите другой username.", { reply_markup: inlineKeyboard([[inlineButton("Изменить username", "profile:edit:telegram:change")]]) });
      return;
    }
    const ownerSaved = owner === userId(ctx) || await store.setIfAbsent(ownerKey, userId(ctx));
    if (!ownerSaved) { await ctx.reply("Не удалось сохранить username. Попробуйте ещё раз."); return; }
    if (!(await store.set(telegramUsernameKey(userId(ctx)), value))) { await ctx.reply("Не удалось сохранить username. Попробуйте ещё раз."); return; }
    console.info("telegram username saved", { userId: userId(ctx), username: value.toLowerCase() });
  }
  if (previousValue && previousValue.toLowerCase() !== value?.toLowerCase()) {
    const previousOwnerKey = telegramUsernameOwnerKey(previousValue);
    if (await store.get<number>(previousOwnerKey) === userId(ctx)) await store.delete(previousOwnerKey);
  }
  const confirmed = value !== null;
  const p = withTelegramDefaults(stored); p.telegramUsername = value; p.telegramUsernameConfirmed = confirmed; p.telegram_username = value; p.telegram_username_confirmed = confirmed; p.updatedAt = now();
  try { if (!(await store.set(profileKey(p.userId), p))) throw new Error("storage"); } catch { await ctx.reply("Ошибка: не удалось сохранить Telegram. Попробуйте ещё раз."); return; }
  ctx.session.step = "idle"; ctx.session.editField = undefined; ctx.session.draft = undefined;
  await ctx.reply(value ? `📱 Telegram: @${value}` : "📱 Telegram: не указан", { reply_markup: inlineKeyboard([[inlineButton("Мой профиль", "profile:manage")]]) });
}
composer.callbackQuery("profile:edit:telegram:confirm", async (ctx) => { await ctx.answerCallbackQuery(); await saveTelegramEdit(ctx); });
composer.callbackQuery("profile:edit:telegram:change", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.step = "telegram_manual"; if (!ctx.session.telegramPrivacyNoticeShown) { ctx.session.telegramPrivacyNoticeShown = true; await ctx.reply(TELEGRAM_PRIVACY_NOTICE); } await ctx.reply("Пожалуйста, укажите ваш Telegram username в формате @username", { reply_markup: force("@username") }); });
composer.callbackQuery("profile:telegram:toggle", async (ctx) => { await ctx.answerCallbackQuery(); const store = new DomainStore(ctx); const stored = await store.get<Profile>(profileKey(userId(ctx))); if (!stored) { await ctx.reply("Сначала создайте профиль."); return; } const p = withTelegramDefaults(stored); p.showTelegramOnMatch = !p.showTelegramOnMatch; p.show_telegram_on_match = p.showTelegramOnMatch; p.updatedAt = now(); await store.set(profileKey(p.userId), p); await ctx.editMessageText("Настройка Telegram обновлена.", { reply_markup: manageKeyboard(p) }); });
composer.callbackQuery("profile:visibility:toggle", async (ctx) => { await ctx.answerCallbackQuery(); const store = new DomainStore(ctx); const p = await store.get<Profile>(profileKey(userId(ctx))); if (!p) { await ctx.reply("Сначала создайте профиль."); return; } p.visibility = !p.visibility; p.updatedAt = now(); await store.set(profileKey(p.userId), p); await ctx.editMessageText(p.visibility ? "Профиль снова виден другим людям." : "Профиль скрыт и не показывается в знакомствах.", { reply_markup: manageKeyboard(p) }); });
composer.callbackQuery("profile:preview", async (ctx) => { await ctx.answerCallbackQuery(); const p = await new DomainStore(ctx).get<Profile>(profileKey(userId(ctx))); if (!p) { await ctx.reply("Сначала создайте профиль."); return; } if (p.photos[0]) await ctx.replyWithPhoto(p.photos[0], { caption: photoCaption(profileSummary(p)), reply_markup: back }); else await ctx.reply(profileSummary(p), { reply_markup: back }); });
composer.callbackQuery("profile:photos:manage", async (ctx) => { await ctx.answerCallbackQuery(); const p = await new DomainStore(ctx).get<Profile>(profileKey(userId(ctx))); if (!p) { await ctx.reply("Сначала создайте профиль."); return; } const rows = p.photos.map((_, i) => [inlineButton(i === 0 ? `Главное фото ${i + 1}` : `Сделать главным ${i + 1}`, `profile:photo:primary:${i}`), inlineButton(`Удалить ${i + 1}`, `profile:photo:delete:${i}`)]); await ctx.reply(`У вас ${p.photos.length} фото. Первое — главное.`, { reply_markup: inlineKeyboard([...rows, [inlineButton("Добавить фото", "profile:photo:add")], [inlineButton("⬅️ К профилю", "profile:manage")]]) }); });
composer.callbackQuery("profile:photo:add", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.step = "photos"; await ctx.reply("Пришлите фото. Можно добавить до 6 фотографий."); });
composer.on("message:photo", async (ctx, next) => { if (ctx.session.step !== "photos") { await next(); return; } const p = await new DomainStore(ctx).get<Profile>(profileKey(userId(ctx))); const photo = ctx.message.photo.at(-1); if (!p || !photo) { await ctx.reply("Не удалось добавить фото. Попробуйте ещё раз."); return; } if (p.photos.length >= 6) { await ctx.reply("Можно добавить не больше 6 фотографий."); return; } p.photos.push(photo.file_id); p.updatedAt = now(); await new DomainStore(ctx).set(profileKey(p.userId), p); ctx.session.step = "idle"; await ctx.reply("Фото добавлено и профиль обновлён.", { reply_markup: inlineKeyboard([[inlineButton("Управление фото", "profile:photos:manage")], [inlineButton("Мой профиль", "profile:manage")]]) }); });
composer.callbackQuery(/^profile:photo:delete:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const i = Number(ctx.match[1]); const store = new DomainStore(ctx); const p = await store.get<Profile>(profileKey(userId(ctx))); if (!p || i < 0 || i >= p.photos.length) { await ctx.reply("Это фото уже недоступно."); return; } if (p.photos.length === 1) { await ctx.reply("Оставьте хотя бы одну фотографию."); return; } p.photos.splice(i, 1); p.updatedAt = now(); await store.set(profileKey(p.userId), p); await ctx.editMessageText("Фото удалено. Профиль обновлён.", { reply_markup: inlineKeyboard([[inlineButton("Управление фото", "profile:photos:manage")], [inlineButton("Мой профиль", "profile:manage")]]) }); });
composer.callbackQuery(/^profile:photo:primary:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const i = Number(ctx.match[1]); const store = new DomainStore(ctx); const p = await store.get<Profile>(profileKey(userId(ctx))); if (!p || i < 0 || i >= p.photos.length) { await ctx.reply("Это фото уже недоступно."); return; } const [photo] = p.photos.splice(i, 1); p.photos.unshift(photo); p.updatedAt = now(); await store.set(profileKey(p.userId), p); await ctx.editMessageText("Главное фото обновлено.", { reply_markup: inlineKeyboard([[inlineButton("Управление фото", "profile:photos:manage")], [inlineButton("Мой профиль", "profile:manage")]]) }); });
composer.callbackQuery("profile:delete", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Скрыть профиль? Данные сохранятся, и вы сможете восстановить анкету позже.", { reply_markup: inlineKeyboard([[inlineButton("Скрыть профиль", "profile:delete:confirm"), inlineButton("Оставить", "profile:manage")]]) }); });
composer.callbackQuery("profile:delete:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = userId(ctx);
  const store = new DomainStore(ctx);
  const p = await store.get<Profile>(profileKey(id));
  const profileIds = await store.get<number[]>(profileIndexKey()) ?? [];
  const matchIds = await deactivateProfileRelationships(store, id, profileIds);
  for (const candidate of profileIds) if (candidate !== id) {
    const otherMatches = await store.get<string[]>(matchesKey(candidate)) ?? [];
    await store.set(matchesKey(candidate), otherMatches.filter((matchId) => !matchIds.includes(matchId)));
  }
  for (const matchId of matchIds) {
    const match = await store.get<{ user_a_id?: number; user_b_id?: number }>(`match:${matchId}`);
    const other = match && (match.user_a_id === id ? match.user_b_id : match.user_a_id);
    if (other) {
      const otherMatches = await store.get<string[]>(matchesKey(other)) ?? [];
      await store.set(matchesKey(other), otherMatches.filter((value) => value !== matchId));
      try { await ctx.api.sendMessage(other, "Пользователь удалил профиль. Этот разговор больше недоступен."); } catch { /* blocked users are safe to ignore */ }
    }
  }
  if (p) {
    p.accountStatus = "deleted";
    p.visibility = false;
    p.isComplete = true;
    p.updatedAt = now();
    await store.set(profileKey(id), p);
  }
  await store.set(profileIndexKey(), profileIds.filter((candidate) => candidate !== id));
  const admin = adminChatId(ctx);
  if (admin) { try { await ctx.api.sendMessage(admin, `Пользователь удалил профиль${p ? `: ${p.name}` : "."}`); } catch { /* best effort */ } }
  ctx.session.step = "idle";
  await ctx.reply("Профиль скрыт. Ваши данные сохранены — вы сможете восстановить анкету из главного меню.", { reply_markup: menu });
});
export default composer;
