import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  DomainStore, adminBlockedKey, blockKey, blocksKey, matchA, matchB, matchesKey, matchKey,
  messagesKey, messageEventKey, now, profileKey, reportKey, userId,
  type Match, type Message, type Profile,
} from "../domain.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "Сообщения", data: "conversations:list", order: 50 });
const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("Назад", "conversations:list")], [inlineButton("В меню", "menu:main")]]);

function otherUser(match: Match, me: number): number {
  return matchA(match) === me ? matchB(match) : matchA(match);
}

function messageTime(value: number): string {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function isUnread(message: Message, me: number): boolean {
  return message.to === me && message.read !== true && message.readAt === undefined;
}

async function blocked(store: DomainStore, me: number, other: number): Promise<boolean> {
  return Boolean(await store.get(adminBlockedKey(me)) || await store.get(adminBlockedKey(other)) || await store.get(blockKey(me, other)) || await store.get(blockKey(other, me)));
}

async function activeMatch(ctx: Ctx, id: string): Promise<{ store: DomainStore; match: Match; other: number } | undefined> {
  const store = new DomainStore(ctx);
  const match = await store.get<Match>(matchKey(id));
  const me = userId(ctx);
  if (!match?.active || (matchA(match) !== me && matchB(match) !== me)) return undefined;
  const other = otherUser(match, me);
  if (await blocked(store, me, other)) return undefined;
  return { store, match, other };
}

function chatKeyboard(id: string, enabled: boolean) {
  return inlineKeyboard([
    [inlineButton("Назад", "conversations:list")],
    [inlineButton("Заблокировать", `conversation:block:${id}`), inlineButton("Пожаловаться", `conversation:report:${id}`)],
    ...(enabled ? [[inlineButton("Отправить сообщение", `conversation:write:${id}`)]] : []),
  ]);
}

function header(profile: Profile): string {
  return `💬 ${profile.name}, ${profile.age}\n📍 ${profile.city}`;
}

function body(messages: Message[], me: number): string {
  if (!messages.length) return "Начните разговор с добрых слов.";
  return messages.slice(-30).map((message) => {
    const own = message.from === me || message.sender_id === me;
    return `${own ? "Вы" : "Собеседник"} · ${messageTime(message.sentAt)}\n${message.text}`;
  }).join("\n\n");
}

async function openChat(ctx: Ctx, id: string): Promise<void> {
  const access = await activeMatch(ctx, id);
  if (!access) {
    await ctx.reply("Этот разговор больше недоступен — взаимная симпатия прекращена или пользователь заблокирован.", { reply_markup: back });
    return;
  }
  const { store, match, other } = access;
  const profile = await store.get<Profile>(profileKey(other));
  if (!profile) { await ctx.reply("Профиль собеседника больше недоступен.", { reply_markup: back }); return; }
  const key = match.match_id ?? match.id ?? id;
  const messages = await store.get<Message[]>(messagesKey(key)) ?? [];
  const stamp = now();
  let changed = false;
  for (const message of messages) {
    if (isUnread(message, userId(ctx))) { message.read = true; message.readAt = stamp; changed = true; }
  }
  if (changed) await store.set(messagesKey(key), messages);
  ctx.session.activeMatchId = key;
  const text = `${header(profile)}\n\n${body(messages, userId(ctx))}`;
  if (profile.photos[0]) await ctx.replyWithPhoto(profile.photos[0], { caption: text, reply_markup: chatKeyboard(key, true) });
  else await ctx.reply(text, { reply_markup: chatKeyboard(key, true) });
}

composer.callbackQuery("conversations:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = new DomainStore(ctx);
  const me = userId(ctx);
  const ids = await store.get<string[]>(matchesKey(me)) ?? [];
  const cards: Array<{ profile: Profile; id: string; preview: string; when: string; unread: number }> = [];
  for (const id of ids) {
    const match = await store.get<Match>(matchKey(id));
    if (!match?.active) continue;
    const other = otherUser(match, me);
    if (await blocked(store, me, other)) continue;
    const profile = await store.get<Profile>(profileKey(other));
    if (!profile) continue;
    const messages = await store.get<Message[]>(messagesKey(id)) ?? [];
    const last = messages.at(-1);
    const unread = messages.filter((message) => isUnread(message, me)).length;
    const preview = last ? `${last.text.slice(0, 24)}${last.text.length > 24 ? "…" : ""}` : "Начните разговор";
    cards.push({ profile, id, preview, when: last ? messageTime(last.sentAt) : "Пока без сообщений", unread });
  }
  if (!cards.length) {
    await ctx.reply("Здесь появятся разговоры после взаимной симпатии.", { reply_markup: inlineKeyboard([[inlineButton("В меню", "menu:main")]]) });
    return;
  }
  await ctx.reply("Ваши разговоры");
  for (const card of cards) {
    const badge = card.unread ? `\nНовых сообщений: ${card.unread}` : "";
    const text = `${header(card.profile)}\n\n${card.preview}\nВремя: ${card.when}${badge}`;
    const markup = inlineKeyboard([[inlineButton("Открыть разговор", `conversation:open:${card.id}`)]]);
    if (card.profile.photos[0]) await ctx.replyWithPhoto(card.profile.photos[0], { caption: text, reply_markup: markup });
    else await ctx.reply(text, { reply_markup: markup });
  }
  await ctx.reply("Выберите разговор или вернитесь в меню.", { reply_markup: inlineKeyboard([[inlineButton("В меню", "menu:main")]]) });
});

composer.callbackQuery(/^conversation:open:(\d+-\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await openChat(ctx, ctx.match[1]);
});

composer.callbackQuery(/^conversation:write:(\d+-\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const access = await activeMatch(ctx, ctx.match[1]);
  if (!access) { await ctx.reply("Отправка недоступна: этот разговор больше не защищён взаимной симпатией.", { reply_markup: back }); return; }
  ctx.session.step = "message";
  ctx.session.activeMatchId = ctx.match[1];
  await ctx.reply("Напишите сообщение одним текстом.", { reply_markup: { force_reply: true, input_field_placeholder: "Ваше сообщение" } });
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "message" || !ctx.session.activeMatchId) { await next(); return; }
  const text = ctx.message.text.trim();
  const id = ctx.session.activeMatchId;
  const access = await activeMatch(ctx, id);
  if (!access) { ctx.session.step = "idle"; await ctx.reply("Сообщение не отправлено: этот разговор больше недоступен.", { reply_markup: back }); return; }
  if (!text) { await ctx.reply("Напишите хотя бы одно слово.", { reply_markup: { force_reply: true, input_field_placeholder: "Ваше сообщение" } }); return; }
  if (text.length > 1000) { await ctx.reply("Сообщение слишком длинное. Уложите его в 1000 символов.", { reply_markup: { force_reply: true, input_field_placeholder: "Ваше сообщение" } }); return; }
  const stamp = now();
  if (ctx.session.lastMessageAt && stamp - ctx.session.lastMessageAt < 2_000) { await ctx.reply("Давайте не спешить — отправить следующее сообщение можно через пару секунд."); return; }
  const { store, match, other } = access;
  const key = match.match_id ?? match.id ?? id;
  const eventKey = messageEventKey(key, ctx.update.update_id, userId(ctx));
  if (await store.get<boolean>(eventKey)) {
    ctx.session.step = "idle";
    await ctx.reply("Это сообщение уже обработано.", { reply_markup: chatKeyboard(key, true) });
    return;
  }
  if (await store.available() && !(await store.setIfAbsent(eventKey, true))) {
    ctx.session.step = "idle";
    await ctx.reply("Это сообщение уже обработано.", { reply_markup: chatKeyboard(key, true) });
    return;
  }
  const messages = await store.get<Message[]>(messagesKey(key)) ?? [];
  const message: Message = {
    id: `${userId(ctx)}-${stamp}`,
    matchId: key,
    from: userId(ctx), to: other, text, sentAt: stamp, delivered: false,
    sender_id: userId(ctx), recipient_id: other, created_at: stamp, read: false,
  };
  messages.push(message);
  if (!(await store.set(messagesKey(key), messages))) {
    ctx.session.step = "idle";
    await ctx.reply("Не получилось сохранить сообщение. Попробуйте ещё раз через минуту.");
    return;
  }
  ctx.session.lastMessageAt = stamp;
  ctx.session.step = "idle";
  const sender = await store.get<Profile>(profileKey(userId(ctx)));
  try {
    await ctx.api.sendMessage(other, `${sender?.name ?? "Ваш собеседник"} написал(а):\n\n${text}`, { reply_markup: inlineKeyboard([[inlineButton("Открыть разговор", `conversation:open:${key}`)]]) });
    message.delivered = true;
    await store.set(messagesKey(key), messages);
    await ctx.reply("Сообщение отправлено.", { reply_markup: chatKeyboard(key, true) });
  } catch {
    await ctx.reply("Сообщение сохранено, но пока не доставлено. Возможно, собеседник заблокировал бота.", { reply_markup: chatKeyboard(key, true) });
  }
});

composer.callbackQuery(/^conversation:block:(\d+-\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const access = await activeMatch(ctx, ctx.match[1]);
  if (!access) { await ctx.reply("Этот разговор уже недоступен.", { reply_markup: back }); return; }
  const { store, match, other } = access;
  const me = userId(ctx);
  await store.setIfAbsent(blockKey(me, other), { blocker: me, blocked: other, at: now() });
  const ownBlocks = await store.get<number[]>(blocksKey(me)) ?? [];
  if (!ownBlocks.includes(other)) await store.set(blocksKey(me), [...ownBlocks, other]);
  match.active = false;
  await store.set(matchKey(match.match_id ?? ctx.match[1]), match);
  for (const participant of [me, other]) {
    const ids = await store.get<string[]>(matchesKey(participant)) ?? [];
    await store.set(matchesKey(participant), ids.filter((id) => id !== match.match_id));
  }
  ctx.session.step = "idle";
  await ctx.reply("Пользователь заблокирован. Разговор скрыт, а история сохранена для безопасности.", { reply_markup: back });
});

composer.callbackQuery(/^conversation:report:(\d+-\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const access = await activeMatch(ctx, ctx.match[1]);
  if (!access) { await ctx.reply("Этот разговор больше недоступен.", { reply_markup: back }); return; }
  const { store, match, other } = access;
  const messages = await store.get<Message[]>(messagesKey(match.match_id ?? ctx.match[1])) ?? [];
  const reportId = `${userId(ctx)}-${other}-${now()}`;
  const report = { id: reportId, reporter: userId(ctx), target: other, chatId: match.match_id, reason: "conversation", details: "Жалоба из разговора", messages: messages.slice(-20), at: now(), snapshot: await store.get<Profile>(profileKey(other)), adminAction: "pending" };
  await store.set(reportKey(reportId), report);
  const reportIds = await store.get<string[]>("reports:index") ?? [];
  if (!reportIds.includes(reportId)) await store.set("reports:index", [...reportIds, reportId]);
  const admin = adminChatId(ctx);
  if (admin) {
    const transcript = report.messages.map((message: Message) => `${message.from === userId(ctx) ? "Жалующийся" : "Собеседник"} · ${messageTime(message.sentAt)}\n${message.text}`).join("\n\n");
    try { await ctx.api.sendMessage(admin, `Жалоба на разговор\nПрофиль: ${report.snapshot?.name ?? "недоступен"}\nПоследние сообщений: ${report.messages.length}\nВремя: ${messageTime(report.at)}\n\n${transcript || "Сообщений пока нет."}`); } catch { /* owner delivery is best effort */ }
  }
  await ctx.reply(admin ? "Спасибо, жалоба отправлена. Хотите сразу заблокировать пользователя?" : "Спасибо, жалоба сохранена. Владелец ещё не подключил канал безопасности.", { reply_markup: inlineKeyboard([[inlineButton("Заблокировать", `conversation:block:${match.match_id}`)], [inlineButton("Назад", `conversation:open:${match.match_id}`)]] ) });
});

export default composer;
