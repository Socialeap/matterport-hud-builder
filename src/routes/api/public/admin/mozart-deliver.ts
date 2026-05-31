// One-off admin route: deliver the already-queued Map Oracle outreach email for
// Mozart's Coffee Roasters (outreach log d6e855da-…, originally pgmq msg_id 11).
//
// Context: send_map_oracle_outreach enqueued a malformed payload that the
// transactional dispatcher cannot deliver. This route renders the React Email
// template server-side, sends via Lovable Email directly, writes one
// email_send_log row tied to the existing outreach log id, and removes the
// malformed pgmq message.
//
// Scoped to a single beacon. Guarded by SUPABASE_SERVICE_ROLE_KEY bearer.
import * as React from 'react'
import { sendLovableEmail } from '@lovable.dev/email-js'
import { createClient } from '@supabase/supabase-js'
import { createFileRoute } from '@tanstack/react-router'
import { TEMPLATES } from '@/lib/email-templates/registry'
import { htmlToPlainText, renderEmailHtml } from '@/lib/email/render'

const OUTREACH_LOG_ID = 'd6e855da-84ec-413c-a87b-724a034cca52'
const BEACON_ID = 'd75b552b-6c91-4fb9-aa94-e0728d843c39'
const RECIPIENT = 'customerservice@mozartscoffee.com'
const TEMPLATE_NAME = 'map-oracle-preview-offer'
const PGMQ_MSG_ID = 11
const SITE_NAME = '3DPS'
const SENDER_DOMAIN = 'notify.frontiers3d.com'
const FROM_DOMAIN = 'frontiers3d.com'
const UNSUBSCRIBE_BASE = 'https://frontiers3d.com'

export const Route = createFileRoute('/api/public/admin/mozart-deliver')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY
        const supabaseUrl = process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!apiKey || !supabaseUrl || !serviceKey) {
          return Response.json({ error: 'Server misconfigured' }, { status: 500 })
        }

        const auth = request.headers.get('Authorization')
        if (!auth?.startsWith('Bearer ') || auth.slice(7).trim() !== serviceKey) {
          return Response.json({ error: 'Forbidden' }, { status: 403 })
        }

        const supabase = createClient(supabaseUrl, serviceKey)

        // 1. Load existing outreach log row (sanity)
        const { data: log, error: logErr } = await supabase
          .from('map_oracle_outreach_log')
          .select('id, beacon_id, recipient_email, template_name, status, pgmq_msg_id, unsubscribe_token, metadata')
          .eq('id', OUTREACH_LOG_ID)
          .maybeSingle()
        if (logErr || !log) {
          return Response.json({ error: 'Outreach log row not found', detail: logErr?.message }, { status: 404 })
        }
        if (log.recipient_email !== RECIPIENT || log.beacon_id !== BEACON_ID) {
          return Response.json({ error: 'Outreach log identity mismatch' }, { status: 409 })
        }

        // 2. Duplicate-send guard — if email_send_log already has a sent row for this id, do nothing.
        const { data: alreadySent } = await supabase
          .from('email_send_log')
          .select('id')
          .eq('message_id', OUTREACH_LOG_ID)
          .eq('status', 'sent')
          .maybeSingle()
        if (alreadySent) {
          return Response.json({ ok: true, reason: 'already_sent', message_id: OUTREACH_LOG_ID })
        }

        // 3. Suppression guard
        const { data: suppressed } = await supabase
          .from('suppressed_emails')
          .select('id')
          .eq('email', RECIPIENT.toLowerCase())
          .maybeSingle()
        if (suppressed) {
          return Response.json({ ok: false, reason: 'suppressed' }, { status: 409 })
        }

        // 4. Render template
        const tpl = TEMPLATES[TEMPLATE_NAME]
        if (!tpl) {
          return Response.json({ error: `Template ${TEMPLATE_NAME} not registered` }, { status: 500 })
        }
        const meta = (log.metadata ?? {}) as { city?: string; region?: string }
        const cityStr = meta.region ? `${meta.city}, ${meta.region}` : (meta.city ?? null)
        const token = log.unsubscribe_token
        const unsubscribeUrl = `${UNSUBSCRIBE_BASE}/email/unsubscribe?token=${token}`
        const templateData = {
          businessName: "Mozart's Coffee Roasters",
          city: cityStr,
          unsubscribeUrl,
          physicalAddress: 'Transcendence Media, 1100 Peachtree St NE, Suite 200, Atlanta, GA 30309, USA',
        }
        const element = React.createElement(tpl.component, templateData)
        const html = await renderEmailHtml(element)
        const text = htmlToPlainText(html)
        const subject =
          typeof tpl.subject === 'function' ? tpl.subject(templateData) : tpl.subject

        // 5. Send via Lovable Email
        try {
          await sendLovableEmail(
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
              unsubscribe_token: token ?? undefined,
              message_id: OUTREACH_LOG_ID,
            },
            { apiKey, sendUrl: process.env.LOVABLE_SEND_URL }
          )
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          await supabase.from('email_send_log').insert({
            message_id: OUTREACH_LOG_ID,
            template_name: TEMPLATE_NAME,
            recipient_email: RECIPIENT,
            status: 'failed',
            error_message: msg.slice(0, 1000),
          })
          return Response.json({ error: 'send_failed', detail: msg }, { status: 502 })
        }

        // 6. Log success
        await supabase.from('email_send_log').insert({
          message_id: OUTREACH_LOG_ID,
          template_name: TEMPLATE_NAME,
          recipient_email: RECIPIENT,
          status: 'sent',
        })

        // 7. Remove the malformed pgmq message (msg_id 11) so the dispatcher
        //    stops retrying it and never sends a duplicate.
        const { error: delErr } = await supabase.rpc('delete_email', {
          queue_name: 'transactional_emails',
          message_id: PGMQ_MSG_ID,
        })

        return Response.json({
          ok: true,
          outreach_log_id: OUTREACH_LOG_ID,
          message_id: OUTREACH_LOG_ID,
          pgmq_msg_archived: PGMQ_MSG_ID,
          pgmq_delete_error: delErr?.message ?? null,
        })
      },
    },
  },
})
