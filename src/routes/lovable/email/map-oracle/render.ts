import * as React from 'react'
import { createClient } from '@supabase/supabase-js'
import { createFileRoute } from '@tanstack/react-router'
import { TEMPLATES } from '@/lib/email-templates/registry'
import { htmlToPlainText, renderEmailHtml } from '@/lib/email/render'

// ============================================================
// Map-Oracle Outreach Renderer / Admin Action
// ------------------------------------------------------------
// Completes ONE pending_render outreach send at a time (admin-only).
// Consumes exactly one map_oracle_outreach_log row with status='pending_render',
// renders the `map-oracle-preview-offer` React template via the EXISTING
// email/template infrastructure, enqueues the correctly-shaped PRE-RENDERED
// transactional payload (identical to /lovable/email/transactional/send), and
// finalizes the row via mark_map_oracle_outreach_queued / _failed (PR118).
//
// Re-checks suppression + unsubscribe at render time. Duplicate protection is
// inherent: only status='pending_render' rows are eligible, and finalizing
// transitions them to 'queued' (Mozart, already 'sent', has no pending_render
// row, so it can never be re-sent here). dryRun proves the payload shape
// WITHOUT enqueuing (no live send, no status change).
//
// One row per call. No batch, no cron, no auto-send. No B4/binding, Stripe, or
// Track A.
// ============================================================

// Mirror the transactional sender's configuration (must match send.ts).
const SITE_NAME = '3DPS'
const SENDER_DOMAIN = 'notify.frontiers3d.com'
const FROM_DOMAIN = 'frontiers3d.com'
const UNSUB_BASE = 'https://frontiers3d.com'
const POSTAL = 'Transcendence Media, 1100 Peachtree St NE, Suite 200, Atlanta, GA 30309, USA'
const TEMPLATE_NAME = 'map-oracle-preview-offer'

const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status })

export const Route = createFileRoute('/lovable/email/map-oracle/render')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl =
          process.env.SUPABASE_URL ||
          process.env.VITE_SUPABASE_URL ||
          import.meta.env.VITE_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !supabaseServiceKey) {
          return json(500, { error: 'Server configuration error' })
        }

        // ── Auth: valid JWT AND admin role ──────────────────────────
        const authHeader = request.headers.get('Authorization')
        if (!authHeader?.startsWith('Bearer ')) return json(401, { error: 'Unauthorized' })
        const token = authHeader.slice('Bearer '.length).trim()
        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        const { data: { user }, error: authError } = await supabase.auth.getUser(token)
        if (authError || !user) return json(401, { error: 'Unauthorized' })
        const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' })
        if (isAdmin !== true) return json(403, { error: 'Forbidden — admin only' })

        // ── Input: one outreach_log_id OR one beacon_id; optional dryRun ──
        let outreachLogId: string | undefined
        let beaconId: string | undefined
        let dryRun = false
        try {
          const body = await request.json()
          outreachLogId = body.outreach_log_id || body.outreachLogId
          beaconId = body.beacon_id || body.beaconId
          dryRun = body.dryRun === true || body.dry_run === true
        } catch {
          return json(400, { error: 'Invalid JSON body' })
        }
        if (!outreachLogId && !beaconId) {
          return json(400, { error: 'Provide outreach_log_id or beacon_id' })
        }

        // ── Consume exactly ONE pending_render row ──────────────────
        let q = supabase
          .from('map_oracle_outreach_log')
          .select('id, beacon_id, property_id, recipient_email, template_name, status, unsubscribe_token')
          .eq('status', 'pending_render')
          .order('queued_at', { ascending: false })
          .limit(1)
        q = outreachLogId ? q.eq('id', outreachLogId) : q.eq('beacon_id', beaconId!)
        const { data: rows, error: logErr } = await q
        if (logErr) return json(500, { error: 'Failed to read outreach log', detail: logErr.message })
        const log = rows?.[0]
        if (!log) {
          // No eligible row — e.g. already queued/sent (Mozart) or wrong id.
          return json(409, { error: 'no pending_render outreach row for the given selector', reason: 'not_pending_render' })
        }

        // ── Load beacon + re-check suppression / unsubscribe ────────
        const { data: beacon } = await supabase
          .from('agent_beacons')
          .select('id, name, city, region, status, source')
          .eq('id', log.beacon_id)
          .maybeSingle()
        const recipient = log.recipient_email

        const fail = async (reason: string) => {
          if (!dryRun) {
            await supabase.rpc('mark_map_oracle_outreach_failed', {
              p_outreach_log_id: log.id,
              p_error: reason.slice(0, 500),
            })
          }
          return json(409, { outreach_log_id: log.id, status: dryRun ? 'pending_render' : 'failed', reason })
        }

        if (!beacon || beacon.source !== 'map_oracle') return fail('beacon missing or not map_oracle')
        if (beacon.status === 'unsubscribed') return fail('beacon is unsubscribed')
        const { data: suppressed } = await supabase
          .from('suppressed_emails').select('id').eq('email', recipient.toLowerCase()).maybeSingle()
        if (suppressed) return fail('recipient is suppressed')

        // ── Render via the existing template infrastructure ─────────
        const template = TEMPLATES[TEMPLATE_NAME]
        if (!template) return json(500, { error: `template '${TEMPLATE_NAME}' not in registry` })
        const cityDisplay = beacon.region && beacon.city ? `${beacon.city}, ${beacon.region}` : beacon.city
        const templateData = {
          businessName: beacon.name,
          city: cityDisplay,
          unsubscribeUrl: `${UNSUB_BASE}/email/unsubscribe?token=${log.unsubscribe_token}`,
          physicalAddress: POSTAL,
        }

        let html: string
        let text: string
        let subject: string
        try {
          const element = React.createElement(template.component, templateData)
          html = await renderEmailHtml(element)
          text = htmlToPlainText(html)
          subject = typeof template.subject === 'function' ? template.subject(templateData) : template.subject
        } catch (renderErr) {
          const detail = String((renderErr as Error)?.message || renderErr).slice(0, 500)
          return fail(`render failed: ${detail}`)
        }

        // ── Build the PRE-RENDERED payload (identical shape to send.ts) ──
        const messageId = crypto.randomUUID()
        const payload = {
          message_id: messageId,
          to: recipient,
          from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
          sender_domain: SENDER_DOMAIN,
          subject,
          html,
          text,
          purpose: 'transactional',
          label: TEMPLATE_NAME,
          idempotency_key: log.id, // outreach log id — idempotent per pending send
          unsubscribe_token: log.unsubscribe_token,
          queued_at: new Date().toISOString(),
        }

        // ── dryRun: prove the shape WITHOUT enqueue / mark / send ───
        if (dryRun) {
          return json(200, {
            dryRun: true,
            outreach_log_id: log.id,
            note: 'rendered + built payload; NOT enqueued, NO status change, NO email sent',
            payload_keys: Object.keys(payload),
            preview: {
              to: payload.to, from: payload.from, sender_domain: payload.sender_domain,
              subject: payload.subject, label: payload.label, purpose: payload.purpose,
              unsubscribe_token: payload.unsubscribe_token,
              html_bytes: html.length, html_head: html.slice(0, 300), text_head: text.slice(0, 300),
            },
          })
        }

        // ── Live: log pending, enqueue, finalize ────────────────────
        await supabase.from('email_send_log').insert({
          message_id: messageId, template_name: TEMPLATE_NAME, recipient_email: recipient, status: 'pending',
        })
        const { data: pgmqMsgId, error: enqErr } = await supabase.rpc('enqueue_email', {
          queue_name: 'transactional_emails', payload,
        })
        if (enqErr) {
          await supabase.from('email_send_log').insert({
            message_id: messageId, template_name: TEMPLATE_NAME, recipient_email: recipient,
            status: 'failed', error_message: 'enqueue failed',
          })
          await supabase.rpc('mark_map_oracle_outreach_failed', {
            p_outreach_log_id: log.id, p_error: `enqueue failed: ${enqErr.message}`.slice(0, 500),
          })
          return json(500, { error: 'Failed to enqueue email', outreach_log_id: log.id, status: 'failed' })
        }

        const { error: markErr } = await supabase.rpc('mark_map_oracle_outreach_queued', {
          p_outreach_log_id: log.id,
          p_pgmq_msg_id: typeof pgmqMsgId === 'number' ? pgmqMsgId : Number(pgmqMsgId),
        })
        if (markErr) {
          // Enqueued but finalize failed — surface loudly; the message_id ties the records.
          return json(500, {
            error: 'enqueued but failed to finalize outreach log', outreach_log_id: log.id,
            pgmq_msg_id: pgmqMsgId, detail: markErr.message,
          })
        }

        return json(200, {
          success: true, queued: true, outreach_log_id: log.id,
          pgmq_msg_id: pgmqMsgId, message_id: messageId,
        })
      },
    },
  },
})
