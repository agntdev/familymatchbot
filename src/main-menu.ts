import type { Ctx } from "./bot.js";
import { DomainStore, isProfileComplete, profileKey, userId } from "./domain.js";
import { inlineButton, inlineKeyboard, mainMenuItems, type InlineKeyboardMarkup } from "./toolkit/index.js";

/**
 * Build the top-level menu for the current user. The registry contains both
 * profile actions so feature modules remain independently reachable; the
 * rendered menu deliberately chooses exactly one of them from durable state.
 */
export async function mainMenuFor(ctx: Ctx): Promise<InlineKeyboardMarkup> {
  const profile = await new DomainStore(ctx).get<Parameters<typeof isProfileComplete>[0]>(profileKey(userId(ctx)));
  const completed = profile !== undefined && isProfileComplete(profile);
  const items = mainMenuItems().filter((item) => {
    if (item.data === "profile:create:start") return !completed;
    if (item.data === "profile:manage") return completed;
    return true;
  });
  const rows = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(items.slice(i, i + 2).map((item) => inlineButton(item.label, item.data)));
  }
  rows.push([inlineButton("❓ Помощь", "menu:help")]);
  return inlineKeyboard(rows);
}
