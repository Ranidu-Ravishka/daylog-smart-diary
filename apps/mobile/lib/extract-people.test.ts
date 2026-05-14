import { describe, it, expect } from "vitest";
import { extractNameCandidatesFromText } from "./extract-people";

describe("extractNameCandidatesFromText", () => {
  describe("rejects the previously-buggy phrase", () => {
    it('"talking with my school mates" yields no candidates', () => {
      expect(
        extractNameCandidatesFromText("talking with my school mates"),
      ).toEqual([]);
    });

    it('"chatting with friends" yields no candidates', () => {
      expect(extractNameCandidatesFromText("chatting with friends")).toEqual(
        [],
      );
    });

    it('"meeting my team" yields no candidates', () => {
      expect(extractNameCandidatesFromText("meeting my team")).toEqual([]);
    });
  });

  describe("accepts real names", () => {
    it("single capitalized name", () => {
      expect(extractNameCandidatesFromText("Saw Alice today")).toContain(
        "Alice",
      );
    });

    it("two names joined by 'and'", () => {
      const result = extractNameCandidatesFromText("Lunch with Alice and Bob");
      expect(result).toContain("Alice");
      expect(result).toContain("Bob");
    });

    it("comma-separated list", () => {
      const result = extractNameCandidatesFromText("Alice, Bob, Carol");
      expect(result).toEqual(expect.arrayContaining(["Alice", "Bob", "Carol"]));
    });

    it("multi-word names", () => {
      const result = extractNameCandidatesFromText(
        "Coffee with Mary Jane and Anne-Marie",
      );
      expect(result).toContain("Mary Jane");
      expect(result).toContain("Anne-Marie");
    });

    it('handles "Lunch with Sarah" cleanly', () => {
      const result = extractNameCandidatesFromText("Lunch with Sarah");
      expect(result).toContain("Sarah");
      expect(result).not.toContain("Lunch");
    });
  });

  describe("rejects generic nouns even when capitalized at sentence start", () => {
    it("Friends alone is not a name", () => {
      expect(extractNameCandidatesFromText("Friends came over")).not.toContain(
        "Friends",
      );
    });

    it("Family is not a name", () => {
      expect(extractNameCandidatesFromText("Family dinner")).not.toContain(
        "Family",
      );
    });
  });

  describe("dedupes and handles edge cases", () => {
    it("dedupes repeated names", () => {
      const result = extractNameCandidatesFromText("Alice and Alice and Alice");
      expect(result).toEqual(["Alice"]);
    });

    it("returns empty for empty input", () => {
      expect(extractNameCandidatesFromText("")).toEqual([]);
      expect(extractNameCandidatesFromText("   ")).toEqual([]);
    });

    it("rejects strings with digits", () => {
      expect(extractNameCandidatesFromText("Met user42 today")).not.toContain(
        "user42",
      );
    });

    it("rejects all-lowercase tokens", () => {
      expect(extractNameCandidatesFromText("with someone nice")).toEqual([]);
    });
  });

  describe("works on calendar event titles", () => {
    it("'1:1 with Bob Smith' extracts Bob Smith", () => {
      const result = extractNameCandidatesFromText("1:1 with Bob Smith");
      expect(result).toContain("Bob Smith");
    });

    it("'Standup with Alice & Bob' extracts both", () => {
      const result = extractNameCandidatesFromText("Standup with Alice & Bob");
      expect(result).toContain("Alice");
      expect(result).toContain("Bob");
    });
  });
});
