import { describe, expect, it } from "vitest";
import { apiBase } from "./developers";
import { seatState } from "./org";

describe("seatState", () => {
  it("counts pending invitations towards a full organisation", () => {
    expect(seatState({ used: 4, max: 10 })).toEqual({ pct: 40, full: false });
    expect(seatState({ used: 8, max: 10, pendingInvites: 2 })).toEqual({ pct: 80, full: true });
  });
  it("treats zero seats as full", () => expect(seatState({ used: 0, max: 0 }).full).toBe(true));
});

describe("apiBase", () => {
  it("normalises the configured address", () => expect(apiBase("https://api.example.org/ ")).toBe("https://api.example.org"));
  it("ignores unset or non-http values", () => {
    expect(apiBase("")).toBeNull();
    expect(apiBase("javascript:alert(1)")).toBeNull();
  });
});
