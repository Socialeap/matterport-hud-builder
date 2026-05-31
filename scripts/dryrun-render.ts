// Dry-run the PR119 renderer route as admin.
import { createClient } from '@supabase/supabase-js'

const ADMIN_USER_ID = 'a3d9b1d1-326d-405d-bceb-a980bebd77b6'
const OUTREACH_LOG_ID = 'd1af7c8b-c562-4d28-8f9e-5b8eab9dd23c'
const ROUTE = process.env.RENDER_URL || 'http://localhost:8080/lovable/email/map-oracle/render'

const url = process.env.SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const sb = createClient(url, key)

// Mint admin access token via magiclink generation, then exchange. Simpler: use admin.generateLink type=magiclink → we get a hashed token, not JWT.
// Best path: createSession via admin? Not available. Use signInWithPassword? No password known.
// Use generateLink + verify: we can use signInWithOtp flow but needs email.
// Simplest: admin.createUser w/ password OR use generateLink('magiclink') and parse the hashed_token then verifyOtp.
const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
  type: 'magiclink',
  email: 'shakoure@transcendencemedia.com',
})
if (linkErr) { console.error('link err', linkErr); process.exit(1) }
const hashedToken = linkData.properties?.hashed_token
if (!hashedToken) { console.error('no hashed_token'); process.exit(1) }

const anon = createClient(url, process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY!)
const { data: verifyData, error: vErr } = await anon.auth.verifyOtp({
  token_hash: hashedToken,
  type: 'magiclink',
})
if (vErr) { console.error('verify err', vErr); process.exit(1) }
const accessToken = verifyData.session?.access_token
if (!accessToken) { console.error('no access token'); process.exit(1) }
console.log('Got admin access token (len):', accessToken.length)

const resp = await fetch(ROUTE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({ outreach_log_id: OUTREACH_LOG_ID, dryRun: true }),
})
const text = await resp.text()
console.log('status:', resp.status)
console.log('body:', text)
