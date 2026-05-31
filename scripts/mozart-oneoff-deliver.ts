// One-off Mozart delivery — runs from sandbox.
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sendLovableEmail } from '@lovable.dev/email-js'
import { createClient } from '@supabase/supabase-js'
import { template as mozartTpl } from '../src/lib/email-templates/map-oracle-preview-offer'

const OUTREACH_LOG_ID = 'd6e855da-84ec-413c-a87b-724a034cca52'
const RECIPIENT = 'customerservice@mozartscoffee.com'
const TEMPLATE_NAME = 'map-oracle-preview-offer'
const PGMQ_MSG_ID = 11
const SENDER_DOMAIN = 'notify.frontiers3d.com'
const FROM_DOMAIN = 'frontiers3d.com'
const SITE_NAME = '3DPS'
const UNSUBSCRIBE_BASE = 'https://frontiers3d.com'

const supabaseUrl = process.env.SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const apiKey = process.env.LOVABLE_API_KEY!
if (!supabaseUrl || !serviceKey || !apiKey) throw new Error('Missing env')

const supabase = createClient(supabaseUrl, serviceKey)

// 1. Load outreach log
const { data: log, error: logErr } = await supabase
  .from('map_oracle_outreach_log')
  .select('id, beacon_id, recipient_email, unsubscribe_token, metadata, pgmq_msg_id, status')
  .eq('id', OUTREACH_LOG_ID)
  .maybeSingle()
if (logErr || !log) {
  console.error('Outreach log not found', logErr)
  process.exit(1)
}
console.log('outreach_log:', log)

// 2. Duplicate guard
const { data: dup } = await supabase
  .from('email_send_log')
  .select('id, status')
  .eq('message_id', OUTREACH_LOG_ID)
  .eq('status', 'sent')
  .maybeSingle()
if (dup) {
  console.log('Already sent, no-op:', dup)
  process.exit(0)
}

// 3. Suppression
const { data: sup } = await supabase
  .from('suppressed_emails')
  .select('id')
  .eq('email', RECIPIENT.toLowerCase())
  .maybeSingle()
if (sup) {
  console.log('Suppressed; aborting')
  process.exit(2)
}

// 4. Render template
const meta = (log.metadata ?? {}) as { city?: string; region?: string }
const cityStr = meta.region ? `${meta.city}, ${meta.region}` : (meta.city ?? null)
const token = log.unsubscribe_token!
const unsubscribeUrl = `${UNSUBSCRIBE_BASE}/email/unsubscribe?token=${token}`
const data = {
  businessName: "Mozart's Coffee Roasters",
  city: cityStr,
  unsubscribeUrl,
  physicalAddress: 'Transcendence Media, 1100 Peachtree St NE, Suite 200, Atlanta, GA 30309, USA',
}
const element = React.createElement(mozartTpl.component, data)
const html = '<!DOCTYPE html>' + renderToStaticMarkup(element)
// crude plain-text fallback
const text = html
  .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
const subject = typeof mozartTpl.subject === 'function' ? mozartTpl.subject(data) : mozartTpl.subject
console.log('subject:', subject)
console.log('html_len:', html.length, 'text_len:', text.length)

// 5. Send
try {
  const resp = await sendLovableEmail(
    {
      to: RECIPIENT,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject,
      html,
      text,
      purpose: 'transactional',
      label: TEMPLATE_NAME,
      idempotency_key: `map-oracle-outreach-${OUTREACH_LOG_ID}`,
      unsubscribe_token: token,
      message_id: OUTREACH_LOG_ID,
    },
    { apiKey }
  )
  console.log('send response:', resp)
} catch (e: any) {
  console.error('send_failed:', e?.status, e?.message, e?.retryAfterSeconds)
  await supabase.from('email_send_log').insert({
    message_id: OUTREACH_LOG_ID,
    template_name: TEMPLATE_NAME,
    recipient_email: RECIPIENT,
    status: 'failed',
    error_message: String(e?.message ?? e).slice(0, 1000),
  })
  process.exit(3)
}

// 6. Log success
const { error: insErr } = await supabase.from('email_send_log').insert({
  message_id: OUTREACH_LOG_ID,
  template_name: TEMPLATE_NAME,
  recipient_email: RECIPIENT,
  status: 'sent',
})
console.log('log insert error:', insErr)

// 7. Archive/delete pgmq msg 11
const { data: delData, error: delErr } = await supabase.rpc('delete_email', {
  queue_name: 'transactional_emails',
  message_id: PGMQ_MSG_ID,
})
console.log('pgmq delete:', { delData, delErr })

console.log('DONE')
