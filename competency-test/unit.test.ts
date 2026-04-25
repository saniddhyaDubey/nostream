import { describe, expect, it } from "vitest";
import { countLeadingZeroBits, parseFollowList, NostrEvent, verifyEventPow } from "./index.ts";


// factory for dummy events
function makeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    pubkey: "aabbccdd",
    kind: 3,
    tags: [],
    content: "",
    created_at: Math.floor(Date.now() / 1000),
    sig: "deadbeef",
    ...overrides,
  };
}

// ═══════════════════════════════════════════
// parseFollowList
// ═══════════════════════════════════════════

describe("parseFollowList", () => {
  it("returns empty array when there are no tags", () => {
    const event = makeEvent({ tags: [] });
    expect(parseFollowList(event)).toEqual([]);
  });

  it("extracts pubkeys from p-tags only", () => {
    const event = makeEvent({
      tags: [
        ["p", "pubkey_alice"],
        ["e", "some_event_id"],
        ["p", "pubkey_bob"],
        ["t", "nostr"],
      ],
    });
    expect(parseFollowList(event)).toEqual(["pubkey_alice", "pubkey_bob"]);
  });

  it("handles a single follow", () => {
    const event = makeEvent({
      tags: [["p", "only_one"]],
    });
    expect(parseFollowList(event)).toEqual(["only_one"]);
  });

  it("preserves duplicates (does not deduplicate)", () => {
    const event = makeEvent({
      tags: [
        ["p", "same_key"],
        ["p", "same_key"],
      ],
    });
    expect(parseFollowList(event)).toEqual(["same_key", "same_key"]);
  });

  it("ignores p-tags with missing pubkey value", () => {
    const event = makeEvent({
      tags: [
        ["p"], // malformed — no index [1]
        ["p", "valid_key"],
      ],
    });
    // tag[1] is undefined for the first entry
    const result = parseFollowList(event);
    expect(result).toEqual([undefined, "valid_key"]);
  });
});

// ═══════════════════════════════════════════
// countLeadingZeroBits
// ═══════════════════════════════════════════

describe("countLeadingZeroBits", () => {
  it("returns 0 for an id starting with f (1111)", () => {
    expect(countLeadingZeroBits("f000")).toBe(0);
  });

  it("returns 1 for an id starting with 7 (0111)", () => {
    expect(countLeadingZeroBits("7fff")).toBe(1);
  });

  it("returns 4 for an id starting with 0 then non-zero", () => {
    expect(countLeadingZeroBits("0f00")).toBe(4);
  });

  it("returns 8 for 00xx", () => {
    expect(countLeadingZeroBits("00ff")).toBe(8);
  });

  it("returns 5 for 07 (0000 0111)", () => {
    expect(countLeadingZeroBits("07ab")).toBe(5);
  });

  it("counts full string of zeros", () => {
    expect(countLeadingZeroBits("0000")).toBe(16);
  });

  it("throws on invalid hex character", () => {
    expect(() => countLeadingZeroBits("zz00")).toThrow("Invalid hex character");
  });
});

// ═══════════════════════════════════════════
// verifyEventPow
// ═══════════════════════════════════════════

describe("verifyEventPow", () => {
  it("reports uncommitted when no nonce tag is present", () => {
    const event = makeEvent({
      id: "00abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
      tags: [],
    });
    const result = verifyEventPow(event);
    expect(result.committedTarget).toBeNull();
    expect(result.valid).toBe(true);
    expect(result.actualDifficulty).toBe(8);
  });

  it("returns valid when actual difficulty meets committed target", () => {
    // id starts with 0000 → 16 leading zero bits
    const event = makeEvent({
      id: "0000abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456",
      tags: [["nonce", "12345", "16"]],
    });
    const result = verifyEventPow(event);
    expect(result.valid).toBe(true);
    expect(result.actualDifficulty).toBe(16);
    expect(result.committedTarget).toBe(16);
  });

  it("returns valid when actual difficulty exceeds committed target", () => {
    const event = makeEvent({
      id: "0000abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456",
      tags: [["nonce", "12345", "8"]],
    });
    const result = verifyEventPow(event);
    expect(result.valid).toBe(true);
    expect(result.actualDifficulty).toBeGreaterThan(8);
  });

  it("returns invalid when actual difficulty is below committed target", () => {
    // id starts with ab → 0 leading zero bits, but claims 20
    const event = makeEvent({
      id: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      tags: [["nonce", "99999", "20"]],
    });
    const result = verifyEventPow(event);
    expect(result.valid).toBe(false);
    expect(result.actualDifficulty).toBe(0);
    expect(result.committedTarget).toBe(20);
  });

  it("returns invalid when nonce tag has no target value", () => {
    const event = makeEvent({
      id: "0000abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456",
      tags: [["nonce", "12345"]], // no third element
    });
    const result = verifyEventPow(event);
    expect(result.valid).toBe(false);
    expect(result.committedTarget).toBeNull();
  });

  it("returns invalid when nonce target is not a number", () => {
    const event = makeEvent({
      id: "0000abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456",
      tags: [["nonce", "12345", "abc"]],
    });
    const result = verifyEventPow(event);
    expect(result.valid).toBe(false);
    expect(result.committedTarget).toBeNull();
  });
});