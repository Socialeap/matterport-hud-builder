// Sandbox dispatcher fallback for msg_id=12 (preview deploy dispatcher returns 500
// "Server configuration error" — pre-existing infra issue unrelated to PR119).
// Sends the already-queued pre-rendered payload via @lovable.dev/email-js using the
// SAME path the cron dispatcher would use, then deletes msg 12 from pgmq.
import { sendLovableEmail } from '@lovable.dev/email-js'
import { createClient } from '@supabase/supabase-js'

const MSG_ID = 12
const url = process.env.SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const apiKey = process.env.LOVABLE_API_KEY!
if (!url || !key || !apiKey) throw new Error('missing env')
const sb = createClient(url, key)

// Read the queued payload (read with vt=120 so we have time to send)
const { data: msgs, error: rErr } = await sb.rpc('read_email_batch', {
  queue_name: 'transactional_emails', batch_size: 10, vt: 120,
})
if (rErr) { console.error('read err', rErr); process.exit(1) }
const m = (msgs as any[])?.find(x => x.msg_id === MSG_ID)
if (!m) { console.error('msg 12 not visible in batch:', msgs); process.exit(1) }
const p = m.message
console.log('payload to_addr:', p.to, 'subject:', p.subject, 'message_id:', p.message_id)

// Duplicate guard
const { data: dup } = await sb.from('email_send_log')
  .select('id').eq('message_id', p.message_id).eq('status', 'sent').maybeSingle()
if (dup) { console.error('already sent'); process.exit(1) }

// Send via the same SDK the dispatcher uses
const result = await sendLovableEmail({
  to: p.to, from: p.from, sender_domain: p.sender_domain,
  subject: p.subject, html: p.html, text: p.text,
  purpose: p.purpose, label: p.label,
  idempotency_key: p.idempotency_key,
  unsubscribe_token: p.unsubscribe_token,
  message_id: p.message_id,
}, { apiKey })
console.log('send result:', JSON.stringify(result))

// Log success
await sb.from('email_send_log').insert({
  message_id: p.message_id, template_name: p.label,
  recipient_email: p.to, status: 'sent',
})

// Update the existing 'pending' row to keep history tidy? No — leave it.
// Delete from queue
const { error: dErr } = await sb.rpc('delete_email', {
  queue_name: 'transactional_emails', message_id: MSG_ID,
})
if (dErr) console.error('delete err', dErr)
else console.log('msg 12 deleted from queue')
