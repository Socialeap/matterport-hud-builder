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
// row, so it can never be re-sent here).
//
// Three modes, selected by the request body:
//   • live (default)   — render + enqueue prospect email + mark_queued. Mutates the log.
//   • dryRun:true      — render + return the FULL preview (html/text/headers).
//                        NOT enqueued, NO status change, NO email sent.
//   • testSend:true    — render the SAME template/data but deliver ONLY to the
//                        operator inbox (TEST_RECIPIENT): subject prefixed, banner
//                        injected, unsubscribe neutralized, fresh message_id +
//                        distinct label/idempotency_key. Does NOT read-lock, mark,
//                        consume, or status-change the outreach log; the prospect
//                        is never contacted and the live duplicate guards are
//                        untouched (different idempotency key + recipient).
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
// CTA destinations baked into the outreach email.
// DEMO_URL is the primary CTA ("See an example") — a REUSABLE demo/example, never
// a per-lead mock-up. No dedicated public demo route is configured, so it points
// at the public site; repoint here if a specific example tour is published.
const DEMO_URL = 'https://www.frontiers3d.com'
const REPLY_TO_EMAIL = 'info@transcendencemedia.com'  // reply CTA — monitored inbox

// ── Internal test-send constants ────────────────────────────────────────────
// A test send renders the EXACT same template/data as the live prospect send but
// delivers ONLY to the operator inbox, prefixes the subject, injects a banner,
// and NEVER touches the outreach log (no consume, no status change, no mark).
const TEST_RECIPIENT = 'shakoure@transcendencemedia.com'
const TEST_TEMPLATE_NAME = 'map-oracle-preview-offer-test' // distinct label → never tripped by prospect-keyed queries
const TEST_SUBJECT_PREFIX = '[TEST - NOT SENT TO PROSPECT]'
// Inert, non-matching token so any unsubscribe click in the test inbox cannot
// suppress the real prospect (defense-in-depth beyond the banner warning).
const TEST_UNSUB_TOKEN = 'test-preview-inert-not-a-real-token'
const TEST_UNSUB_URL = `${UNSUB_BASE}/email/unsubscribe?token=${TEST_UNSUB_TOKEN}`

const TEST_BANNER_HTML =
  '<div style="background:#b91c1c;color:#ffffff;padding:14px 18px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-size:14px;line-height:1.5;text-align:center;font-weight:700;">' +
  '&#9888; INTERNAL TEST PREVIEW &mdash; NOT SENT TO THE PROSPECT' +
  '<div style="font-weight:400;font-size:12px;margin-top:6px;">' +
  'This copy was delivered only to the Frontiers3D operator inbox to preview the Map-Oracle outreach email. ' +
  'The business shown below was NOT contacted. Links (including unsubscribe) are inert in this test.' +
  '</div></div>'

const TEST_TEXT_BANNER =
  '============================================================\n' +
  'INTERNAL TEST PREVIEW — NOT SENT TO THE PROSPECT.\n' +
  'Operator preview of the Map-Oracle outreach email. The business\n' +
  'was NOT contacted. Links (including unsubscribe) are inert.\n' +
  '============================================================'

// Inject the test banner immediately after the opening <body> tag (falls back to
// prepending if no body tag is present in the rendered markup).
function injectTestBanner(html: string): string {
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/(<body[^>]*>)/i, `$1${TEST_BANNER_HTML}`)
  }
  return `${TEST_BANNER_HTML}${html}`
}

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

        // ── Input: one outreach_log_id OR one beacon_id; optional dryRun/testSend ──
        let outreachLogId: string | undefined
        let beaconId: string | undefined
        let dryRun = false
        let testSend = false
        try {
          const body = await request.json()
          outreachLogId = body.outreach_log_id || body.outreachLogId
          beaconId = body.beacon_id || body.beaconId
          dryRun = body.dryRun === true || body.dry_run === true
          testSend = body.testSend === true || body.test_send === true
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

        // Only the LIVE prospect send mutates the outreach log on failure.
        // dryRun and testSend never mark the row (status stays pending_render).
        const noMutate = dryRun || testSend
        const fail = async (reason: string) => {
          if (!noMutate) {
            await supabase.rpc('mark_map_oracle_outreach_failed', {
              p_outreach_log_id: log.id,
              p_error: reason.slice(0, 500),
            })
          }
          return json(409, { outreach_log_id: log.id, status: noMutate ? 'pending_render' : 'failed', reason })
        }

        if (!beacon || beacon.source !== 'map_oracle') return fail('beacon missing or not map_oracle')
        // Prospect-state gates apply to LIVE + dryRun (which preview the real send).
        // A test send goes only to the operator inbox, so it isn't gated on prospect
        // suppression/unsubscribe — but we surface those states as flags below.
        if (!testSend) {
          if (beacon.status === 'unsubscribed') return fail('beacon is unsubscribed')
          const { data: suppressed } = await supabase
            .from('suppressed_emails').select('id').eq('email', recipient.toLowerCase()).maybeSingle()
          if (suppressed) return fail('recipient is suppressed')
        }

        // ── Render via the existing template infrastructure ─────────
        const template = TEMPLATES[TEMPLATE_NAME]
        if (!template) return json(500, { error: `template '${TEMPLATE_NAME}' not in registry` })
        const cityDisplay = beacon.region && beacon.city ? `${beacon.city}, ${beacon.region}` : beacon.city
        const realUnsubUrl = `${UNSUB_BASE}/email/unsubscribe?token=${log.unsubscribe_token}`

        // Visual proof: use ONLY a genuine cached photo of the business
        // (property_photos.cdn_url, https). We deliberately do NOT fall back to
        // properties.primary_photo_url — that can be a generic Google Places
        // category icon, and showing it as "proof" would be misleading. No safe
        // asset → the template renders a "presence detected" callout instead.
        let previewImageUrl: string | null = null
        if (log.property_id) {
          const { data: photo } = await supabase
            .from('property_photos')
            .select('cdn_url')
            .eq('property_id', log.property_id)
            .not('cdn_url', 'is', null)
            .order('ordinal', { ascending: true })
            .limit(1)
            .maybeSingle()
          const url = photo?.cdn_url
          if (typeof url === 'string' && /^https:\/\//i.test(url)) previewImageUrl = url
        }

        // Website detection (for the truthful "listing + website" claim).
        let websiteDetected = false
        if (log.property_id) {
          const { data: contact } = await supabase
            .from('property_contacts')
            .select('website_url')
            .eq('property_id', log.property_id)
            .maybeSingle()
          websiteDetected = typeof contact?.website_url === 'string' && contact.website_url.length > 0
        }
        const emailDetected = typeof recipient === 'string' && recipient.length > 0

        // ── Evidence model ──────────────────────────────────────────
        // What we ACTUALLY know. The email may only claim what a flag backs. The
        // pipeline does not verify any indoor Street View / photosphere / panorama
        // / virtual-tour / Matterport-embed signal, so every 360-specific flag is
        // FALSE here. A future verification step can set them and the copy adapts.
        const evidence = {
          listing_detected: true,                  // candidate came from a Google Places listing
          website_detected: websiteDetected,
          photo_detected: previewImageUrl !== null,
          indoor_360_verified: false,              // not checked by the pipeline
          virtual_tour_url_detected: false,        // not checked by the pipeline
          matterport_or_360_embed_detected: false, // not checked by the pipeline
        }
        const evidenceParts = ['Google Places listing']
        if (evidence.website_detected) evidenceParts.push('website')
        if (emailDetected) evidenceParts.push('public email')
        if (evidence.photo_detected) evidenceParts.push('public photo')
        const evidenceSummary = `Evidence: ${evidenceParts.join(' + ')}`
        const verificationNote = '360 verification: not checked / not verified'

        const templateData = {
          businessName: beacon.name,
          city: cityDisplay,
          unsubscribeUrl: realUnsubUrl,
          physicalAddress: POSTAL,
          demoUrl: DEMO_URL,
          replyToEmail: REPLY_TO_EMAIL,
          previewImageUrl,
          evidence,
        }

        // ── TEST SEND: deliver ONLY to the operator inbox ───────────
        // Same template + same business/city data; subject prefixed; banner
        // injected; unsubscribe neutralized. Enqueues to the SAME transactional
        // pipeline with a FRESH message_id and a distinct label/idempotency_key,
        // so it can never collide with — or trip the guards of — the live send.
        // The outreach log is NOT read-locked, marked, or status-changed here.
        if (testSend) {
          // Fail-closed suppression check for the operator/test recipient itself.
          const { data: testSuppressed, error: tsErr } = await supabase
            .from('suppressed_emails').select('id').eq('email', TEST_RECIPIENT.toLowerCase()).maybeSingle()
          if (tsErr) return json(500, { error: 'Failed to verify suppression status for test recipient' })
          if (testSuppressed) {
            return json(409, { test: true, reason: 'test recipient is suppressed', to: TEST_RECIPIENT, outreach_log_id: log.id })
          }

          const testData = { ...templateData, unsubscribeUrl: TEST_UNSUB_URL }
          let tHtml: string
          let tText: string
          let baseSubject: string
          try {
            const el = React.createElement(template.component, testData)
            tHtml = await renderEmailHtml(el)
            tText = htmlToPlainText(tHtml)
            baseSubject = typeof template.subject === 'function' ? template.subject(testData) : template.subject
          } catch (renderErr) {
            const detail = String((renderErr as Error)?.message || renderErr).slice(0, 500)
            return json(500, { test: true, error: `render failed: ${detail}`, outreach_log_id: log.id })
          }

          const testHtml = injectTestBanner(tHtml)
          const testText = `${TEST_TEXT_BANNER}\n\n${tText}`
          const testSubject = `${TEST_SUBJECT_PREFIX} ${baseSubject}`

          const testMessageId = crypto.randomUUID()
          const testPayload = {
            message_id: testMessageId,
            to: TEST_RECIPIENT,
            from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
            sender_domain: SENDER_DOMAIN,
            subject: testSubject,
            html: testHtml,
            text: testText,
            purpose: 'transactional',
            label: TEST_TEMPLATE_NAME,
            idempotency_key: testMessageId, // unique — NEVER the outreach log id
            unsubscribe_token: TEST_UNSUB_TOKEN, // inert; cannot match a real prospect token
            queued_at: new Date().toISOString(),
          }

          // Log + enqueue ONLY against the test template_name / operator recipient.
          // Never inserts a prospect-keyed row, so prospect readiness is unaffected.
          await supabase.from('email_send_log').insert({
            message_id: testMessageId, template_name: TEST_TEMPLATE_NAME, recipient_email: TEST_RECIPIENT, status: 'pending',
          })
          const { data: pgmqMsgId, error: enqErr } = await supabase.rpc('enqueue_email', {
            queue_name: 'transactional_emails', payload: testPayload,
          })
          if (enqErr) {
            await supabase.from('email_send_log').insert({
              message_id: testMessageId, template_name: TEST_TEMPLATE_NAME, recipient_email: TEST_RECIPIENT,
              status: 'failed', error_message: 'enqueue failed (test)',
            })
            return json(500, { test: true, error: 'Failed to enqueue test email', message_id: testMessageId, outreach_log_id: log.id })
          }

          // Enqueued — NOT yet delivered. The dispatcher (queue processor) sends
          // it asynchronously; the UI polls get_test_email_status(message_id) to
          // confirm actual delivery. Trace IDs are returned for that polling and
          // for queue/log inspection.
          return json(200, {
            test: true,
            queued: true,
            delivered: false, // delivery is confirmed later via the status poll, not here
            to: TEST_RECIPIENT,
            message_id: testMessageId,
            pgmq_msg_id: typeof pgmqMsgId === 'number' ? pgmqMsgId : (pgmqMsgId != null ? Number(pgmqMsgId) : null),
            template_label: TEST_TEMPLATE_NAME,
            subject: testSubject,
            outreach_log_id: log.id,
            outreach_status: 'pending_render', // unchanged — proven, not mutated
            beacon_unsubscribed: beacon.status === 'unsubscribed',
            evidence,
            evidence_summary: evidenceSummary,
            verification_note: verificationNote,
            note: 'Internal test ENQUEUED to the operator inbox only (not yet delivered). Prospect NOT contacted; outreach log unchanged; unsubscribe link inert.',
          })
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
        // Returns the FULL rendered html + text so the operator UI can show an
        // accurate preview (not just a head snippet). Nothing is enqueued, no
        // status changes, no email is sent.
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
              unsubscribe_url: realUnsubUrl,
              html_bytes: html.length,
              html, text,
              html_head: html.slice(0, 300), text_head: text.slice(0, 300),
              evidence,
              evidence_summary: evidenceSummary,
              verification_note: verificationNote,
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
