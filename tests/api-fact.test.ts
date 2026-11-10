import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFact, createUser, resetDb } from "./helpers";

// The route reads the user only from auth(); mock it to impersonate a session.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));

const { GET } = await import("@/app/api/fact/route");

function signInAs(userId: string | null) {
  authMock.mockResolvedValue(
    userId ? { user: { id: userId }, expires: new Date(Date.now() + 60_000).toISOString() } : null,
  );
}

beforeEach(async () => {
  await resetDb();
  authMock.mockReset();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/fact authorization", () => {
  it("returns 401 and generates nothing when not signed in", async () => {
    signInAs(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not signed in." });
    expect(await prisma.fact.count()).toBe(0);
  });

  it("returns only the signed-in user's fact", async () => {
    const alice = await createUser("alice@example.com");
    const bob = await createUser("bob@example.com");
    // Both facts are fresh, so the cache is hit and OpenAI is never called.
    await createFact(alice.id, "Inception", "alice's fact", 1_000);
    await createFact(bob.id, "Inception", "bob's fact", 1_000);

    signInAs(alice.id);
    const asAlice = await GET();
    signInAs(bob.id);
    const asBob = await GET();

    expect(asAlice.status).toBe(200);
    expect((await asAlice.json()).fact.text).toBe("alice's fact");
    expect((await asBob.json()).fact.text).toBe("bob's fact");
  });

  it("returns 409 when the user has not finished onboarding", async () => {
    const user = await createUser("new@example.com", null);
    signInAs(user.id);

    expect((await GET()).status).toBe(409);
  });
});
