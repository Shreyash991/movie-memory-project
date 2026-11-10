import { prisma } from "@/lib/prisma";

export async function resetDb() {
  // Facts and sessions cascade from users.
  await prisma.user.deleteMany();
}

export function createUser(email: string, favoriteMovie: string | null = "Inception") {
  return prisma.user.create({ data: { email, name: email.split("@")[0], favoriteMovie } });
}

export function createFact(userId: string, movie: string, text: string, ageMs: number) {
  return prisma.fact.create({
    data: { userId, movie, text, createdAt: new Date(Date.now() - ageMs) },
  });
}
