import { setDefaultAutoSelectFamily } from 'node:net'

// Node's Happy Eyeballs (RFC 8305) dual-stack connection racing can hang
// outbound fetch() calls indefinitely on serverless platforms where IPv6 is
// configured but unreachable - undici does its own DNS/connect racing here,
// independent of dns.setDefaultResultOrder, so the usual ipv4-first fix
// doesn't apply. Disabling it reverts to single-family connection attempts,
// which is what let server/api/parse-label.post.ts's Gemini call hang for
// its full timeout with zero connections ever established.
export default defineNitroPlugin(() => {
  setDefaultAutoSelectFamily(false)
})
