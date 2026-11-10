"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { movieSchema } from "@/lib/validation";

export type OnboardingState = { error: string | null };

export async function saveFavoriteMovie(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const userId = (await auth())?.user?.id;
  if (!userId) redirect("/");

  const parsed = movieSchema.safeParse(formData.get("movie") ?? "");
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Onboarding is first-time only: only set the movie if none is stored yet.
  await prisma.user.updateMany({
    where: { id: userId, favoriteMovie: null },
    data: { favoriteMovie: parsed.data },
  });

  redirect("/dashboard");
}
