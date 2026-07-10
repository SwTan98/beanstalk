// Single source of truth for the Gemini call's timeout budget. The three
// dependents (Vercel's function duration limit, the server's own timeout on
// the upstream Gemini call, and the client's timeout on /api/parse-label)
// must satisfy GEMINI_FUNCTION_MAX_DURATION_S * 1000 > GEMINI_CLIENT_TIMEOUT_MS
// > GEMINI_UPSTREAM_TIMEOUT_MS with margin - the client needs to outlast the
// server's own timeout so it can still receive a clean failure response
// instead of aborting first, and the function needs room beyond the client
// timeout for cold start and response overhead. Import these everywhere
// instead of hardcoding the numbers again: a prior version of this budget
// drifted out of sync across files and caused a real production incident.
export const GEMINI_UPSTREAM_TIMEOUT_MS = 20_000
export const GEMINI_CLIENT_TIMEOUT_MS = 23_000
export const GEMINI_FUNCTION_MAX_DURATION_S = 25
