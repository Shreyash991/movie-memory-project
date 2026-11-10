import Image from "next/image";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/session";
import { MovieFact } from "./movie-fact";

export default async function DashboardPage() {
  const user = await requireUser();
  if (!user.favoriteMovie) redirect("/onboarding");

  // Google may not provide a name or photo; fall back gracefully.
  const displayName = user.name?.trim() || user.email;
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8 p-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {user.image ? (
            <Image
              src={user.image}
              alt=""
              width={56}
              height={56}
              className="rounded-full"
            />
          ) : (
            <div
              aria-hidden
              className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-300 text-xl font-semibold text-slate-700"
            >
              {initial}
            </div>
          )}
          <div>
            <p className="font-semibold">{displayName}</p>
            <p className="text-sm text-slate-600">{user.email}</p>
          </div>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
          >
            Log out
          </button>
        </form>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
          Favorite movie
        </h2>
        <p className="mt-1 text-2xl font-semibold">{user.favoriteMovie}</p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-500">
          Fun fact
        </h2>
        <MovieFact />
      </section>
    </main>
  );
}
