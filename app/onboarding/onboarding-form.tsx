"use client";

import { useActionState } from "react";
import { saveFavoriteMovie, type OnboardingState } from "./actions";
import { MOVIE_MAX_LENGTH } from "@/lib/validation";

const initialState: OnboardingState = { error: null };

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(saveFavoriteMovie, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label htmlFor="movie" className="font-medium">
        What&apos;s your favorite movie?
      </label>
      {/* Client-side limits are a convenience only; the server action re-validates. */}
      <input
        id="movie"
        name="movie"
        required
        maxLength={MOVIE_MAX_LENGTH}
        className="rounded-md border border-slate-300 px-3 py-2"
        placeholder="e.g. Spirited Away"
      />
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Continue"}
      </button>
    </form>
  );
}
