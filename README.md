# Movie Memory

Sign in with Google, tell us your favorite movie, and get a fun fact about it from OpenAI.

**Stack:** Next.js 15 (App Router) · TypeScript · React 19 · Tailwind CSS 4 · Postgres 16 · Prisma 6 · Auth.js v5 (Google) · OpenAI · Zod · Vitest

**Variant chosen: A (backend: caching and correctness).** See [Why Variant A](#why-variant-a).

---

## Setup

### Prerequisites
- Node.js 20+
- Docker (for Postgres), or any Postgres 14+ instance
- A Google OAuth client and an OpenAI API key

### 1. Install
```bash
npm install          # also runs `prisma generate`
cp .env.example .env # then fill in the values (see below)
```

### 2. Start Postgres
```bash
docker compose up -d
```
This starts Postgres on `localhost:5432` with two databases: `movie_memory` for the app and `movie_memory_test` for the tests. The test database is created by `docker/init-test-db.sql` the first time the Docker volume is created. If you already had the volume, run `docker compose down -v` first.

### 3. Run database migrations
```bash
npm run db:migrate   # development: prisma migrate dev (applies migrations, regenerates the client)
npm run db:deploy    # production/CI: prisma migrate deploy (applies committed migrations only)
```
Migrations live in `prisma/migrations/`. The test suite applies them to the test database on its own.

### 4. Create the Google OAuth client
1. In Google Cloud Console, go to **APIs & Services → Credentials → Create credentials → OAuth client ID**. Choose the application type **Web application**.
2. Add the authorized redirect URI: `http://localhost:3000/api/auth/callback/google`.
3. Copy the client ID and secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`. If the consent screen is in "Testing" mode, add your Google account as a test user.

### 5. Run
```bash
npm run dev     # http://localhost:3000
npm test        # backend tests (needs the Docker Postgres running)
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. The default in `.env.example` matches `docker-compose.yml`. |
| `AUTH_SECRET` | yes | Secret Auth.js uses to sign and encrypt cookies. Generate one with `npx auth secret`. |
| `AUTH_GOOGLE_ID` | yes | Google OAuth client ID. |
| `AUTH_GOOGLE_SECRET` | yes | Google OAuth client secret. |
| `OPENAI_API_KEY` | yes | OpenAI API key. Used only on the server. |
| `OPENAI_MODEL` | no | Defaults to `gpt-4o-mini`. |
| `TEST_DATABASE_URL` | no | Overrides the test database. The default is `movie_memory_test` on localhost. The suite refuses to run against a database whose name doesn't contain "test". |

None of these variables has the `NEXT_PUBLIC_` prefix, so none of them can end up in the browser bundle.

---

## Architecture overview

```
app/
  page.tsx                      Landing page ("Sign in with Google"); routes signed-in users onward
  onboarding/                   First-time favorite-movie form + server action (Zod validation)
  dashboard/page.tsx            Profile, favorite movie, logout (server component)
  dashboard/movie-fact.tsx      Client component that calls GET /api/fact (loading/error states)
  api/auth/[...nextauth]/       Auth.js route handlers
  api/fact/route.ts             GET /api/fact: session → getFactForUser → JSON
auth.ts                         Auth.js config: Google provider, Prisma adapter, database sessions
lib/facts.ts                    All fact logic: OpenAI call, 60s cache, lock, fallback
lib/session.ts                  requireUser(): session → DB user, or redirect to "/"
lib/validation.ts               Zod schema for the movie title
lib/prisma.ts                   Prisma client singleton
prisma/schema.prisma            Data model
tests/                          Vitest tests against a real Postgres
```

### Auth flow
- **Auth.js v5** with the Google provider and the **Prisma adapter**. Sessions are stored in the database (`strategy: "database"`). The cookie holds an opaque token, and the user id is looked up on the server on every request. Sessions can be revoked by deleting their row.
- `/` is the single routing point. A signed-out visitor sees the landing page. Sign-in returns to `/`, which sends the user to `/onboarding` if `favoriteMovie` is null, otherwise to `/dashboard`.
- `/dashboard` and `/onboarding` call `requireUser()`, which redirects to `/` when there is no valid session. `/onboarding` redirects to `/dashboard` if a movie is already set, so it really is first-time only. The server action also refuses to overwrite an existing movie (`updateMany … where favoriteMovie: null`), so replaying the form can't change it.
- There is no middleware. Checks happen in the server components, route handler and server action that read data. These are the places that actually need protecting, and Prisma doesn't run on the edge runtime that middleware uses.

### Data model

| Model | Purpose |
|---|---|
| `User` | Auth.js user (`name`, `email`, `image` from Google) plus **`favoriteMovie VARCHAR(200)?`** |
| `Account`, `Session` | Standard Auth.js adapter tables. `VerificationToken` is omitted because it is only used for email sign-in. |
| `Fact` | `id`, `userId → User (cascade)`, **`movie VARCHAR(200)`**, `text`, `createdAt`. Index on **`(userId, movie, createdAt DESC)`**. |

Why this shape:
- **`favoriteMovie` is a column on `User`**, not a separate table. Each user has exactly one favorite movie, and nothing else is known about a movie, so a `Movie` table would add a join and gain nothing. `null` doubles as "not onboarded yet".
- **`Fact.movie` is a copy of the title at generation time.** The cache key in the spec is *user + movie*, so the key is stored on the row. If the favorite ever changes, facts about the old movie stop matching, so there's nothing to invalidate.
- **Facts are append-only.** Every fact generated is kept, which is what the base spec asks for. "The current fact" is simply the newest row, which the composite index finds with a single lookup.
- The column lengths match the Zod limits, so the database enforces them too.

### Fact generation, caching and concurrency (`lib/facts.ts`)

`GET /api/fact` reads the user id from `auth()` and calls `getFactForUser(userId)`:

```
1. Load user.favoriteMovie                       (none → 409)
2. Fast path: newest Fact for (userId, movie)
     age < 60s → return it                       (no lock, no OpenAI)
3. BEGIN
     set lock_timeout = 12s
     pg_advisory_xact_lock(hashtext(userId))     ← concurrent requests for this user wait here
     re-read newest Fact for (userId, movie)
       age < 60s → return it                     ← another request just generated it
     generate via OpenAI (10s timeout, 0 retries)
       ok   → INSERT fact (createdAt = now, from app code) → return it
       fail → newest fact of any age, else FactUnavailableError (503)
   COMMIT (lock released automatically)
4. If the transaction itself fails (lock wait or transaction timeout, DB error):
     newest fact of any age, else FactUnavailableError (503)
```

**Why it's correct under bursts.** Suppose two tabs load at the same moment and both miss the fast path. Both enter step 3. One gets the advisory lock and calls OpenAI; the other blocks on the lock. When the first commits, the second gets the lock, **re-checks the cache**, finds the fact that was just written, and returns it. Result: one OpenAI call and one row, and both tabs show the same fact. The test `two simultaneous requests → one OpenAI call` covers this. With the lock line removed, the test fails with two calls.

**Design details:**
- **The lock is held per user, not per (user, movie).** A user has one movie, and keying on the user also serializes the rare case of the movie changing mid-request. `hashtext` gives a 32-bit key. A collision between two users only makes them wait for each other; it can never mix up their data, because every query filters by `userId`.
- **The lock is a transaction-level advisory lock** (`_xact_`). It is released on commit, rollback, or a dropped connection, so it can't be leaked by a crash or a forgotten unlock.
- **`createdAt` is set in app code, not by `DEFAULT now()`.** Inside a transaction, Postgres `now()` is the time the transaction started. A fact generated after waiting on the lock and OpenAI would be stamped up to ~20s in the past, and the cache window would expire early. The "is it fresh?" check also uses the app clock, so both sides use the same clock.
- **Timeouts are sized to fit together.** OpenAI gets 10s with no retries. The SDK default is a 10-minute timeout plus 2 retries, which would hold the lock for minutes. `lock_timeout` is 12s, a little longer than one generation, so a waiter normally outlasts whoever holds the lock. The Prisma transaction timeout is 25s, enough for the lock wait plus our own generation.

### Failure handling
| Situation | Result |
|---|---|
| OpenAI error or timeout, an older fact exists | 200 with the most recent fact for this user and movie (stale, but useful) |
| OpenAI error or timeout, no fact yet | 503 `{ error: "We couldn't come up with a fun fact right now…" }` |
| Lock wait or transaction timeout | Same fallback as above |
| Not signed in | 401 `{ error: "Not signed in." }` |
| Signed in but not onboarded | 409 `{ error: "Set a favorite movie first." }` |
| Anything else | 500 with a generic message; details are only logged on the server |

The dashboard loads the fact from the browser, so the page appears straight away and shows "Finding a fun fact…", then either the fact or the error message.

### Security
- **The user id always comes from the server-side session.** `GET /api/fact` takes no parameters, and the server action ignores everything except the `movie` field. Every Prisma query is filtered by that `userId`. Tests confirm that a user never receives another user's fact for the same movie: not from the cache, not from the fallback, and not through the route.
- **Movie input is validated on the server with Zod**: trimmed, 1–200 characters. The database column limit repeats this check.
- **Secrets stay on the server.** The OpenAI client is only imported by server code. The movie title goes into the prompt as the user message, and the system prompt tells the model to treat it as a title, not as instructions. The output is only ever shown to the user who typed the title.
- **Missing Google name or photo** is handled: the dashboard shows the email instead of a name, and an initial instead of a photo.

### Tests (`npm test`)
The tests run against a real Postgres database (`movie_memory_test`), because mocking the database would make the advisory-lock test meaningless. OpenAI is replaced with an injected fake generator, and `auth()` is mocked for the route tests.
- **Cache:** a 59s-old fact is served from cache; a 61s-old fact causes a new generation that is stored; a fact is generated when none exists; facts about a previous movie aren't reused.
- **Burst:** two simultaneous requests make one generation and produce one row; different users don't block each other.
- **Failure:** OpenAI failure returns the newest stale fact; with no fact, a friendly `FactUnavailableError`.
- **Authorization:** `/api/fact` returns 401 when signed out; each user gets only their own fact; a user never falls back to another user's fact.

---

## Why Variant A

What this product really has to get right is the fact pipeline. That's where the money is spent (OpenAI calls), where things fail (an external API), and where concurrency bugs show up (refreshes, several tabs). Variant A turns those risks into concrete guarantees that tests can check. The cache window, burst protection and fallbacks are easier to reason about, and more interesting to defend, as backend logic with database-level guarantees than as client-side state.

## Key tradeoffs

- **A database transaction stays open across the OpenAI call.** This keeps the lock, the re-check and the insert atomic and simple. The cost is one pooled database connection per in-flight generation, for up to about 10s. That's fine at this scale. Under heavy load it could exhaust the Prisma pool, and the fix would be a "generation lease" row (see below).
- **Advisory lock instead of a unique constraint per 60s window.** A bucketed unique constraint has edge cases at bucket boundaries (a 59s-old fact can be in the previous bucket) and doesn't stop the duplicate OpenAI *call*, only the duplicate insert. The lock prevents the call itself.
- **Failure fallbacks are served silently.** The spec asks for "the most recent cached fact" on failure, so the response looks the same as a normal one. The user isn't told the fact is old.
- **Facts are kept forever.** At most one row per user per minute while they're active. That's simple and gives history, but it would need pruning eventually.
- **Database sessions instead of JWT.** One extra query per request, in exchange for revocable sessions and no user data in the cookie.
- **Profile data comes from the first sign-in.** Auth.js doesn't update `name` or `image` on later sign-ins by default.
- **The clock comes from the app server.** With several app servers, their clocks need to be in sync (NTP) for the 60s window to be exact.

## With 2 more hours

1. Replace "transaction held across OpenAI" with a short transaction that claims a `FactGeneration` lease row (with an expiry), then generate outside the transaction. This frees database connections during the network call.
2. Add `source: "cache" | "generated" | "stale"` to the API response and show "showing an earlier fact" in the UI when serving a fallback.
3. Add a CI workflow (GitHub Actions with a Postgres service) running lint, typecheck, build and tests.
4. Add a Playwright end-to-end test of the sign-in → onboarding → dashboard flow, with a stubbed OAuth provider.
5. Prune facts older than N days, and refresh the Google name and photo on each sign-in.

---

## AI usage

- Used **Claude Code** as a pair programmer throughout. I set the requirements and the key decisions: Variant A, a Postgres advisory lock inside a Prisma transaction with a second cache check, an OpenAI timeout, the user id only from the session, Zod, Vitest, and step-by-step commits. I had it propose a plan before writing code.
- It drafted the scaffold, schema, Auth.js setup, pages, `lib/facts.ts`, tests and this README. I reviewed each step before moving on.
- It flagged two subtle issues that I kept: Postgres `now()` is frozen at the start of a transaction (so `createdAt` is set in app code), and lock waits count toward Prisma's transaction timeout (so the timeouts were sized together and bounded with `lock_timeout`).
- Checks: typecheck, lint and build after every step. All tests pass against a real Postgres. A mutation check showed that removing the advisory lock makes the burst test fail. Checked the OpenAI key with a single live call.
