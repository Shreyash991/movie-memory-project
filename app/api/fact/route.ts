import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { FactUnavailableError, getFactForUser, NoFavoriteMovieError } from "@/lib/facts";

export type FactResponse =
  | { fact: { text: string; movie: string; createdAt: string } }
  | { error: string };

// The user id comes only from the session. Query params and body are ignored,
// so there is no way to ask for another user's facts.
export async function GET() {
  const userId = (await auth())?.user?.id;
  if (!userId) {
    return NextResponse.json<FactResponse>({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const fact = await getFactForUser(userId);
    return NextResponse.json<FactResponse>({
      fact: { ...fact, createdAt: fact.createdAt.toISOString() },
    });
  } catch (err) {
    if (err instanceof NoFavoriteMovieError) {
      return NextResponse.json<FactResponse>({ error: err.message }, { status: 409 });
    }
    if (err instanceof FactUnavailableError) {
      return NextResponse.json<FactResponse>({ error: err.message }, { status: 503 });
    }
    console.error("Unexpected error in GET /api/fact", err);
    return NextResponse.json<FactResponse>({ error: "Something went wrong." }, { status: 500 });
  }
}
