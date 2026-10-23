import { beforeEach, describe, expect, it, vi } from "vitest";

const updateSeen = vi.fn<(seenAt: string) => Promise<boolean>>(
  async () => true
);

vi.mock("../src/utils/validate-cron-secret.js", () => ({
  validateCronSecret: () => undefined,
}));

vi.mock("../src/bot/agent.js", () => ({
  getAgent: async () => ({ did: "did:plc:bot" }),
}));

vi.mock("../src/bot/services/get-unread-notifications-count.js", () => ({
  getUnreadNotificationsCount: async () => ({ count: 1 }),
}));

vi.mock("../src/utils/get-unread-mentions.js", () => ({
  getUnreadMentions: async () => {
    // Reading notifications takes time; a mention indexed meanwhile is not
    // in this batch and must stay unread for the next run.
    vi.advanceTimersByTime(500);
    return [
      {
        uri: "at://did:plc:user/app.bsky.feed.post/1",
        author: { handle: "user.test", did: "did:plc:user" },
        record: {},
      },
    ];
  },
}));

vi.mock("../src/bot/services/get-post-thread.js", () => ({
  getPostThread: async () => ({}),
}));

vi.mock("../src/services/handle-error.js", () => ({
  handleError: async () => undefined,
}));

vi.mock("../src/bot/services/updateSeen.js", () => ({
  updateSeen: (seenAt: string) => updateSeen(seenAt),
}));

describe("GET /api/check", () => {
  beforeEach(() => {
    updateSeen.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T16:02:00.000Z"));
  });

  it("marks notifications seen only up to the moment before reading them", async () => {
    const { GET } = await import("../api/check.js");

    await GET(new Request("https://bot.test/api/check"));

    expect(updateSeen).toHaveBeenCalledOnce();
    expect(updateSeen).toHaveBeenCalledWith("2026-10-23T16:02:00.000Z");
  });
});
