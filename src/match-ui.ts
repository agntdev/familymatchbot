import type { Ctx } from "./bot.js";
import { canonicalMatchId, withTelegramDefaults, type Profile } from "./domain.js";
import { inlineButton, inlineKeyboard, urlButton } from "./toolkit/index.js";

export const MUTUAL_MATCH_TEXT = "💕 У вас взаимная симпатия! Теперь вы можете связаться друг с другом в Telegram";
export const TELEGRAM_FALLBACK_TEXT = "Пользователь не указал Telegram username. Вы можете отправить ему сообщение через внутренние сообщения бота.";

/**
 * Contact details are deliberately derived from the profile being revealed,
 * never from the viewer. This keeps the permission check directional: A sees
 * B's username only when B opted in, and vice versa.
 */
export function contactArea(profile: Profile, matchId: string): { text: string; markup: ReturnType<typeof inlineKeyboard> } {
  const partner = withTelegramDefaults(profile);
  if (partner.telegramUsername && partner.showTelegramOnMatch) {
    return {
      text: `@${partner.telegramUsername}`,
      markup: inlineKeyboard([
        [urlButton("💬 Открыть Telegram", `tg://resolve?domain=${partner.telegramUsername}`)],
        [urlButton("Открыть в браузере", `https://t.me/${partner.telegramUsername}`)],
      ]),
    };
  }
  return {
    text: TELEGRAM_FALLBACK_TEXT,
    markup: inlineKeyboard([[inlineButton("✉️ Написать в боте", `conversation:open:${matchId}`)]]),
  };
}

export function mutualMessage(profile: Profile, matchId: string): { text: string; markup: ReturnType<typeof inlineKeyboard> } {
  const contact = contactArea(profile, matchId);
  return { text: `${MUTUAL_MATCH_TEXT}\n\n${contact.text}`, markup: contact.markup };
}

export async function notifyMutualMatch(ctx: Ctx, recipient: number, matchedProfile: Profile, matchId = canonicalMatchId(recipient, ctx.from?.id ?? recipient)): Promise<void> {
  const message = mutualMessage(matchedProfile, matchId);
  try {
    if (matchedProfile.photos[0]) {
      await ctx.api.sendPhoto(recipient, matchedProfile.photos[0], { caption: message.text, reply_markup: message.markup });
    } else {
      await ctx.api.sendMessage(recipient, message.text, { reply_markup: message.markup });
    }
  } catch {
    // A participant may have blocked or deleted the bot. The match remains
    // usable through the other participant's chat and internal messaging.
  }
}
