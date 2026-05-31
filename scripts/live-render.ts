// Live PR119 renderer call (dryRun=false).
import { createClient } from '@supabase/supabase-js'

const OUTREACH_LOG_ID = 'd1af7c8b-c562-4d28-8f9e-5b8eab9dd23c'
const ROUTE = process.env.RENDER_URL || 'http://localhost:8080/lovable/email/map-oracle/render'

const url = process.env.SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const sb = createClient(url, key)

const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
  type: 'magiclink', email: 'shakoure@transcendencemedia.com',
})
if (linkErr) { console.error('link err', linkErr); process.exit(1) }
const hashedToken = linkData.properties?.hashed_token!
const anon = createClient(url, process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY!)
const { data: v, error: vErr } = await anon.auth.verifyOtp({ token_hash: hashedToken, type: 'magiclink' })
if (vErr) { console.error('verify err', vErr); process.exit(1) }
const accessToken = v.session!.access_token

async function call(dryRun: boolean) {
  const r = await fetch(ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ outreach_log_id: OUTREACH_LOG_ID, dryRun }),
  })
  return { status: r.status, body: await r.text() }
}

console.log('--- LIVE CALL (dryRun=false) ---')
const live = await call(false)
console.log('status:', live.status)
console.log('body:', live.body)

console.log('\n--- REPEAT CALL (should be 409 / not_pending_render) ---')
const repeat = await call(false)
console.log('status:', repeat.status)
console.log('body:', repeat.body)
