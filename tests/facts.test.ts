import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { FactUnavailableError, getFactForUser, NoFavoriteMovieError } from "@/lib/facts";
import { createFact, createUser, resetDb } from "./helpers";

const SECOND = 1_000;

beforeEach(async () => {
  await resetDb();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("60-second cache window", () => {
  it("returns the cached fact when the latest one is 59s old", async () => {
    const user = await createUser("a@example.com");
    await createFact(user.id, "Inception", "cached fact", 59 * SECOND);
    const generate = vi.fn();

    const fact = await getFactForUser(user.id, generate);

    expect(fact.text).toBe("cached fact");
    expect(generate).not.toHaveBeenCalled();
  });

  it("generates and stores a new fact when the latest one is 61s old", async () => {
    const user = await createUser("a@example.com");
    await createFact(user.id, "Inception", "old fact", 61 * SECOND);
    const generate = vi.fn().mockResolvedValue("new fact");

    const fact = await getFactForUser(user.id, generate);

    expect(fact.text).toBe("new fact");
    expect(generate).toHaveBeenCalledExactlyOnceWith("Inception");
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(2);
  });

  it("generates a fact when none exists yet", async () => {
    const user = await createUser("a@example.com");
    const generate = vi.fn().mockResolvedValue("first fact");

    expect((await getFactForUser(user.id, generate)).text).toBe("first fact");
    expect(generate).toHaveBeenCalledOnce();
  });

  it("does not reuse a fresh fact about a previous favorite movie", async () => {
    const user = await createUser("a@example.com", "Up");
    await createFact(user.id, "Inception", "fact about the old movie", 5 * SECOND);
    const generate = vi.fn().mockResolvedValue("fact about Up");

    expect((await getFactForUser(user.id, generate)).text).toBe("fact about Up");
    expect(generate).toHaveBeenCalledExactlyOnceWith("Up");
  });

  it("rejects users who have not chosen a movie", async () => {
    const user = await createUser("a@example.com", null);
    await expect(getFactForUser(user.id, vi.fn())).rejects.toBeInstanceOf(NoFavoriteMovieError);
  });
});

describe("burst protection", () => {
  it("makes one OpenAI call for two simultaneous requests", async () => {
    const user = await createUser("a@example.com");
    // Slow generator so both requests are in flight at the same time.
    const generate = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return "only fact";
    });

    const [first, second] = await Promise.all([
      getFactForUser(user.id, generate),
      getFactForUser(user.id, generate),
    ]);

    expect(generate).toHaveBeenCalledOnce();
    expect(first.text).toBe("only fact");
    expect(second.text).toBe("only fact");
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(1);
  });

  it("does not block a different user's generation", async () => {
    const alice = await createUser("alice@example.com");
    const bob = await createUser("bob@example.com");
    const generate = vi.fn(async (movie: string) => `fact about ${movie}`);

    await Promise.all([getFactForUser(alice.id, generate), getFactForUser(bob.id, generate)]);

    expect(generate).toHaveBeenCalledTimes(2);
  });
});

describe("OpenAI failure handling", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns the most recent (stale) fact when generation fails", async () => {
    const user = await createUser("a@example.com");
    await createFact(user.id, "Inception", "older fact", 10 * 60 * SECOND);
    await createFact(user.id, "Inception", "most recent fact", 5 * 60 * SECOND);
    const generate = vi.fn().mockRejectedValue(new Error("Request timed out."));

    const fact = await getFactForUser(user.id, generate);

    expect(fact.text).toBe("most recent fact");
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(2);
  });

  it("throws a user-friendly error when generation fails and nothing is cached", async () => {
    const user = await createUser("a@example.com");
    const generate = vi.fn().mockRejectedValue(new Error("500 Internal Server Error"));

    const result = getFactForUser(user.id, generate);

    await expect(result).rejects.toBeInstanceOf(FactUnavailableError);
    await expect(result).rejects.toThrow(/couldn't come up with a fun fact/);
  });
});

describe("authorization", () => {
  it("never serves another user's fact for the same movie", async () => {
    const alice = await createUser("alice@example.com");
    const bob = await createUser("bob@example.com");
    await createFact(bob.id, "Inception", "bob's fact", 5 * SECOND);
    const generate = vi.fn().mockResolvedValue("alice's fact");

    const fact = await getFactForUser(alice.id, generate);

    expect(fact.text).toBe("alice's fact");
    expect(generate).toHaveBeenCalledOnce();
  });

  it("never falls back to another user's fact when generation fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const alice = await createUser("alice@example.com");
    const bob = await createUser("bob@example.com");
    await createFact(bob.id, "Inception", "bob's fact", 5 * 60 * SECOND);

    await expect(
      getFactForUser(alice.id, vi.fn().mockRejectedValue(new Error("down"))),
    ).rejects.toBeInstanceOf(FactUnavailableError);
  });
});
