import { describe, expect, it } from "vitest";
import { isDiscoverable, type Profile } from "../src/domain";

const published = (overrides: Partial<Profile> = {}): Partial<Profile> => ({
  userId: 7,
  name: "Анна",
  age: 30,
  gender: "f",
  city: "Москва",
  photos: ["photo-7"],
  bio: "Ищу серьёзные отношения.",
  maritalStatus: "Не был(а) в браке",
  profession: "Врач",
  height: 170,
  purpose: "Семья",
  relationshipIntent: "serious",
  visibility: true,
  isComplete: true,
  status: "published",
  accountStatus: "published",
  active: true,
  hidden: false,
  deleted: false,
  isTest: false,
  ...overrides,
});

describe("published profile discovery gate", () => {
  it("returns a newly published profile", () => {
    expect(isDiscoverable(published())).toBe(true);
  });

  it.each([
    { status: "draft", active: false },
    { hidden: true, active: false },
    { deleted: true, active: false },
    { isTest: true },
  ])("excludes non-public profile flags: %o", (flags) => {
    expect(isDiscoverable(published(flags))).toBe(false);
  });
});
