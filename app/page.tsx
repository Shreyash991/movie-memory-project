import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { prisma } from "@/lib/prisma";

export default async function Home() {
  const session = await auth();

  // Signed in: route first-time users to onboarding, returning users to the dashboard.
  if (session?.user?.id) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { favoriteMovie: true },
    });
    redirect(user?.favoriteMovie ? "/dashboard" : "/onboarding");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold">Movie Memory</h1>
      <p className="max-w-md text-slate-600">
        Tell us your favorite movie and get a fun fact about it.
      </p>
      <form
        action={async () => {
          "use server";
          // Come back to "/" so the routing above decides onboarding vs dashboard.
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-5 py-2.5 font-medium text-white hover:bg-slate-700"
        >
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
