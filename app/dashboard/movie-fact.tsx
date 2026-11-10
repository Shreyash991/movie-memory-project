"use client";

import { useEffect, useState } from "react";
import type { FactResponse } from "@/app/api/fact/route";

type State =
  | { status: "loading" }
  | { status: "ready"; text: string }
  | { status: "error"; message: string };

export function MovieFact() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/fact", { cache: "no-store" })
      .then(async (res) => (await res.json()) as FactResponse)
      .catch((): FactResponse => ({ error: "Could not reach the server." }))
      .then((body) => {
        if (cancelled) return;
        setState(
          "fact" in body
            ? { status: "ready", text: body.fact.text }
            : { status: "error", message: body.error },
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <p className="animate-pulse text-slate-500">Finding a fun fact...</p>;
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="text-red-600">
        {state.message}
      </p>
    );
  }
  return <p className="leading-relaxed">{state.text}</p>;
}
