// Promote one new map_oracle candidate and create a pending_render outreach row.
import { createClient } from '@supabase/supabase-js'

const PROPERTY_ID = process.argv[2] || 'a576ae3b-cb5b-4778-bf5a-d007f5631b83'

const url = process.env.SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!url || !key) throw new Error('Missing env')
const sb = createClient(url, key)

const { data: beaconId, error: pErr } = await sb.rpc('promote_property_to_beacon', {
  p_property_id: PROPERTY_ID,
})
if (pErr) { console.error('promote err:', pErr); process.exit(1) }
console.log('beacon_id:', beaconId)

const { data: sendRes, error: sErr } = await sb.rpc('send_map_oracle_outreach', {
  p_beacon_id: beaconId,
  p_dry_run: false,
})
if (sErr) { console.error('send err:', sErr); process.exit(1) }
console.log('send_map_oracle_outreach result:', JSON.stringify(sendRes, null, 2))

const { data: log } = await sb
  .from('map_oracle_outreach_log')
  .select('id, beacon_id, recipient_email, template_name, status, unsubscribe_token, pgmq_msg_id')
  .eq('beacon_id', beaconId)
  .order('queued_at', { ascending: false })
  .limit(1)
console.log('outreach_log:', JSON.stringify(log, null, 2))
