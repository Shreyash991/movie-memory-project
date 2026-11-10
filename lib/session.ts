import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * Returns the signed-in user's DB row, or redirects to the landing page.
 * The id always comes from the server-side session, never from the request.
 */
export async function requireUser() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/");

  return user;
}
