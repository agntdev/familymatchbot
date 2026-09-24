import type { Ctx } from "./bot.js";
import { canonicalMatchId, withTelegramDefaults, type Profile } from "./domain.js";
import { inlineButton, inlineKeyboard, urlButton } from "./toolkit/index.js";

export const MUTUAL_MATCH_TEXT = "💕 У вас взаимная симпатия!";
export const MUTUAL_MATCH_WITHOUT_TELEGRAM = "💕 У вас взаимная симпатия! У пользователя не указан Telegram. Вы можете написать ему прямо здесь через бота.";

/**
 * Contact details are deliberately derived from the profile being revealed,
 * never from the viewer. This keeps the permission check directional: A sees
 * B's username only when B opted in, and vice versa.
 */
export function contactArea(profile: Profile, matchId: string): { text: string; markup: ReturnType<typeof inlineKeyboard> } {
  const partner = withTelegramDefaults(profile);
  // Sharing is still opt-in. A username that was entered but not explicitly
  // confirmed is deliberately treated exactly like no username.
  if (partner.telegramUsername && partner.telegramUsernameConfirmed && partner.showTelegramOnMatch) {
    return {
      text: `💕 У вас взаимная симпатия!\n\n📱 Telegram: @${partner.telegramUsername}`,
      markup: inlineKeyboard([
        [urlButton("💬 Открыть Telegram", `https://t.me/${partner.telegramUsername}`)],
      ]),
    };
  }
  return {
    text: MUTUAL_MATCH_WITHOUT_TELEGRAM,
    markup: inlineKeyboard([[inlineButton("💬 Написать сообщение", `conversation:open:${matchId}`)]]),
  };
}

export function mutualMessage(profile: Profile, matchId: string): { text: string; markup: ReturnType<typeof inlineKeyboard> } {
  return contactArea(profile, matchId);
}

export async function notifyMutualMatch(ctx: Ctx, recipient: number, matchedProfile: Profile, matchId = canonicalMatchId(recipient, ctx.from?.id ?? recipient)): Promise<void> {
  const message = mutualMessage(matchedProfile, matchId);
  try {
    await ctx.api.sendMessage(recipient, message.text, { reply_markup: message.markup });
  } catch {
    // A participant may have blocked or deleted the bot. The match remains
    // usable through the other participant's chat and internal messaging.
  }
}
