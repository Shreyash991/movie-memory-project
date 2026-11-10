import { z } from "zod";

// Must match the VarChar(200) columns in prisma/schema.prisma.
export const MOVIE_MAX_LENGTH = 200;

export const movieSchema = z
  .string()
  .trim()
  .min(1, "Please enter a movie title.")
  .max(MOVIE_MAX_LENGTH, `Movie title must be at most ${MOVIE_MAX_LENGTH} characters.`);
