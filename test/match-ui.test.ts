import { describe, expect, it } from "vitest";
import { contactArea, MUTUAL_MATCH_WITHOUT_TELEGRAM } from "../src/match-ui";
import type { Profile } from "../src/domain";

const base: Profile = {
  userId: 2, name: "Анна", age: 30, gender: "f", city: "Москва", photos: [],
  bio: "О себе", maritalStatus: "Не был(а) в браке", profession: "Врач", height: 170,
  purpose: "Серьёзные отношения", relationshipIntent: "serious", telegramUsername: null,
  showTelegramOnMatch: true, visibility: true, createdAt: 1, updatedAt: 1,
};

describe("mutual match contact display", () => {
  it("shows one confirmed opt-in Telegram link", () => {
    const view = contactArea({ ...base, telegramUsername: "anna_test", telegramUsernameConfirmed: true }, "1-2");
    expect(view.text).toContain("@anna_test");
    expect(view.markup.inline_keyboard).toEqual([[{ text: "💬 Открыть Telegram", url: "https://t.me/anna_test" }]]);
  });

  it("keeps an unconfirmed username inside the bot", () => {
    const view = contactArea({ ...base, telegramUsername: "anna_test", telegramUsernameConfirmed: false }, "1-2");
    expect(view.text).toBe(MUTUAL_MATCH_WITHOUT_TELEGRAM);
    expect(view.markup.inline_keyboard).toEqual([[{ text: "💬 Написать сообщение", callback_data: "conversation:open:1-2" }]]);
  });
});
