import type { Ctx } from "./bot.js";
import { inlineButton, inlineKeyboard, type InlineKeyboardMarkup } from "./toolkit/index.js";

/**
 * Build the top-level menu for the current user. The registry contains both
 * profile actions so feature modules remain independently reachable; the
 * rendered menu deliberately chooses exactly one of them from durable state.
 */
export function mainMenuFor(_ctx?: Ctx): InlineKeyboardMarkup {
  return inlineKeyboard([
    [inlineButton("💚 Смотреть анкеты", "menu:watch_profiles"), inlineButton("👤 Моя анкета", "menu:my_profile")],
    [inlineButton("❤️ Взаимные симпатии", "menu:mutual_likes"), inlineButton("🔎 Поиск", "menu:search")],
    [inlineButton("⚙️ Настройки", "menu:settings")],
  ]);
}
