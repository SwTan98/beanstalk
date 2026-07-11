// Single definition of what counts as an "enabled" boolean env flag, shared
// by nuxt.config.ts (baking flags into the client bundle at build time) and
// server routes (reading process.env at request time) so the two sides can't
// drift on accepted values.
export function isFlagEnabled(value: string | undefined): boolean {
  return value === 'true' || value === '1'
}
