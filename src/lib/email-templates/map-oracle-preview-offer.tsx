import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

/**
 * Future-safe evidence model for what we actually know about a prospect. The
 * email may ONLY make a claim that a corresponding flag backs. The pipeline does
 * not (yet) verify any indoor Street View / photosphere / panorama / virtual-tour
 * / Matterport-embed signal, so all 360-specific flags default to FALSE and the
 * email must not assert a 3D / 360 / Street View presence until a verifier sets
 * them. A later verification step can populate the `*_verified` / `*_detected`
 * flags and the copy will adapt automatically.
 */
export interface OutreachEvidence {
  /** A public Google Places / Maps business listing was found. */
  listing_detected?: boolean
  /** A public website was found for the business. */
  website_detected?: boolean
  /** A genuine public (cached) photo is available. */
  photo_detected?: boolean
  /** VERIFIED indoor 360 / photosphere. Not checked by the current pipeline. */
  indoor_360_verified?: boolean
  /** A virtual-tour URL was detected. Not checked by the current pipeline. */
  virtual_tour_url_detected?: boolean
  /** A Matterport / 360 embed was detected. Not checked by the current pipeline. */
  matterport_or_360_embed_detected?: boolean
}

interface MapOraclePreviewOfferProps {
  businessName?: string | null
  city?: string | null
  /** Working unsubscribe URL (token-based). Supplied by send_map_oracle_outreach. */
  unsubscribeUrl?: string
  /** CAN-SPAM physical postal address of the sender. */
  physicalAddress?: string
  /** Primary CTA destination — the public Frontiers3D explainer. */
  learnMoreUrl?: string
  /** Secondary CTA — a monitored inbox the recipient can reply/write to. */
  replyToEmail?: string
  /**
   * Optional visual proof. ONLY a genuine, public, cached photo of the business
   * (a real `property_photos.cdn_url`). When absent, a truthful "listing found"
   * callout is shown instead — we never fabricate a business image.
   */
  previewImageUrl?: string | null
  /** What we actually verified about this prospect. Gates every factual claim. */
  evidence?: OutreachEvidence
}

function MapOraclePreviewOfferEmail({
  businessName = null,
  city = null,
  unsubscribeUrl,
  physicalAddress = 'Transcendence Media, Atlanta, GA, USA',
  learnMoreUrl = 'https://www.frontiers3d.com',
  replyToEmail = 'info@transcendencemedia.com',
  previewImageUrl = null,
  evidence,
}: MapOraclePreviewOfferProps) {
  const who = businessName ? businessName : 'your business'
  const place = city ? ` in ${city}` : ''

  // Resolve evidence with claim-safe defaults: every factual claim defaults to
  // NOT asserted. 360-specific signals are not verified by the pipeline, so they
  // stay false unless a caller explicitly proves them.
  const ev: Required<OutreachEvidence> = {
    listing_detected: true, // candidate came from a Google Places listing
    website_detected: false,
    photo_detected: previewImageUrl != null,
    indoor_360_verified: false,
    virtual_tour_url_detected: false,
    matterport_or_360_embed_detected: false,
    ...evidence,
  }
  const has360Evidence =
    ev.indoor_360_verified || ev.virtual_tour_url_detected || ev.matterport_or_360_embed_detected

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>A free interactive presentation preview for {who} — no cost, no obligation</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Brand header */}
          <Section style={brandBar}>
            <Text style={brandWordmark}>FRONTIERS3D</Text>
            <Text style={brandTagline}>Interactive 3D for real-world places</Text>
          </Section>

          <Heading style={h1}>Turn your Google Maps listing into an interactive customer experience</Heading>

          {/* Visual proof: a real cached photo if we have one, otherwise a
              TRUTHFUL "listing found" callout. We only claim what evidence backs —
              never a 3D / 360 / Street View presence (the pipeline doesn't verify
              those), and never a faked screenshot. */}
          {previewImageUrl ? (
            <Section style={proofImageWrap}>
              <Img
                src={previewImageUrl}
                alt={`Public listing photo for ${who}`}
                width="560"
                style={proofImage}
              />
              <Text style={proofCaption}>From {who}'s public business listing</Text>
            </Section>
          ) : (
            <Section style={proofCallout}>
              <Text style={proofBadge}>◍ PUBLIC BUSINESS LISTING FOUND</Text>
              <Text style={proofCalloutText}>
                We found {who}'s public Google Maps listing
                {ev.website_detected ? ' and website' : ''}
                {place}.
                {has360Evidence
                  ? ' We also detected existing 360 / virtual-tour imagery we can build on.'
                  : ''}
              </Text>
            </Section>
          )}

          <Section style={card}>
            {/* One-sentence offer */}
            <Text style={offerLine}>
              We'd like to build you a <strong>free preview</strong> of an interactive presentation
              for {who} — at no cost and no obligation.
            </Text>

            <Text style={text}>
              If you already have Street View, 360, or virtual-tour imagery, Frontiers3D can add an{' '}
              <strong>interactive presentation layer</strong> on top of it — so prospective customers
              can explore your space online before they ever visit.
            </Text>

            <Text style={text}>
              If you don't, Frontiers3D can help <strong>connect you with a local provider</strong> to
              capture your space first, then layer the interactive experience on top.
            </Text>

            {/* Primary CTA */}
            <Section style={ctaWrap}>
              <Button href={learnMoreUrl} style={ctaButton}>
                See what Frontiers3D does
              </Button>
            </Section>

            {/* Secondary CTA */}
            <Text style={secondaryCta}>
              Want a preview for {who}, or have questions?{' '}
              <Link href={`mailto:${replyToEmail}`} style={secondaryLink}>
                Reply to ask us to prepare your free preview
              </Link>
              .
            </Text>
          </Section>

          <Hr style={hr} />

          {/* CAN-SPAM footer: clear identification, postal address, unsubscribe. */}
          <Section style={footerCard}>
            <Text style={footerLine}>
              This is a one-time outreach offer from Frontiers3D (Transcendence Media). You're
              receiving it because {who} appears in public business listings as a candidate for
              an interactive presentation.
            </Text>
            <Text style={footerLine}>{physicalAddress}</Text>
            <Text style={footerLine}>
              {unsubscribeUrl ? (
                <Link href={unsubscribeUrl} style={unsubLink}>
                  Unsubscribe / opt out of future emails
                </Link>
              ) : (
                <>To opt out of future emails, reply with “unsubscribe”.</>
              )}
            </Text>
          </Section>

          <Text style={footer}>Frontiers3D · powered by Transcendence Media</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: MapOraclePreviewOfferEmail,
  subject: ({ businessName }: Record<string, unknown>) =>
    `A free interactive tour preview for ${businessName || 'your business'}`,
  displayName: 'Map Oracle — Preview Offer',
  previewData: {
    businessName: "Mozart's Coffee Roasters",
    city: 'Austin, TX',
    unsubscribeUrl: 'https://www.frontiers3d.com/email/unsubscribe?token=preview',
    physicalAddress: 'Transcendence Media, 1100 Peachtree St NE, Suite 200, Atlanta, GA 30309, USA',
    learnMoreUrl: 'https://www.frontiers3d.com',
    replyToEmail: 'info@transcendencemedia.com',
    // Left null so the gallery shows the truthful "listing found" callout (the
    // common real case before a cached photo exists). A genuine cdn_url renders
    // an image instead.
    previewImageUrl: null,
    // Only listing + website are known; all 360-specific signals stay false until
    // a verifier proves them.
    evidence: {
      listing_detected: true,
      website_detected: true,
      photo_detected: false,
      indoor_360_verified: false,
      virtual_tour_url_detected: false,
      matterport_or_360_embed_detected: false,
    },
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}
const container = { maxWidth: '560px', margin: '0 auto', padding: '20px 0 48px' }

const brandBar = {
  backgroundColor: '#0b1020',
  borderRadius: '8px 8px 0 0',
  padding: '18px 24px',
}
const brandWordmark = {
  fontSize: '18px',
  fontWeight: '800' as const,
  letterSpacing: '2px',
  color: '#ffffff',
  margin: '0',
}
const brandTagline = { fontSize: '12px', color: '#9aa4d4', margin: '2px 0 0' }

const h1 = {
  fontSize: '22px',
  fontWeight: '700' as const,
  color: '#1a1a2e',
  lineHeight: '1.3',
  margin: '20px 0 16px',
}

const proofImageWrap = { margin: '0 0 20px' }
const proofImage = {
  width: '100%',
  maxWidth: '560px',
  borderRadius: '8px',
  border: '1px solid #e5e7eb',
  display: 'block' as const,
}
const proofCaption = { fontSize: '12px', color: '#6b7280', margin: '6px 0 0', textAlign: 'center' as const }

const proofCallout = {
  background: 'linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%)',
  backgroundColor: '#eef2ff',
  borderRadius: '8px',
  border: '1px solid #c7d2fe',
  padding: '20px 24px',
  margin: '0 0 20px',
}
const proofBadge = {
  fontSize: '11px',
  fontWeight: '700' as const,
  letterSpacing: '1px',
  color: '#4338ca',
  margin: '0 0 8px',
}
const proofCalloutText = { fontSize: '14px', color: '#3730a3', lineHeight: '1.6', margin: '0' }

const card = { backgroundColor: '#ffffff', borderRadius: '8px', padding: '24px', border: '1px solid #e5e7eb' }
const offerLine = { fontSize: '16px', color: '#111827', lineHeight: '1.6', margin: '0 0 16px', fontWeight: '600' as const }
const text = { fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }

const ctaWrap = { margin: '8px 0 16px', textAlign: 'center' as const }
const ctaButton = {
  backgroundColor: '#4f46e5',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: '700' as const,
  textDecoration: 'none' as const,
  borderRadius: '8px',
  padding: '13px 28px',
  display: 'inline-block' as const,
}
const secondaryCta = { fontSize: '14px', color: '#374151', lineHeight: '1.6', margin: '4px 0 0', textAlign: 'center' as const }
const secondaryLink = { color: '#4f46e5', textDecoration: 'underline' as const, fontWeight: '600' as const }

const footerCard = { backgroundColor: '#f9fafb', borderRadius: '6px', padding: '12px 16px', margin: '16px 0', border: '1px solid #e5e7eb' }
const footerLine = { fontSize: '12px', color: '#6b7280', margin: '0 0 6px', lineHeight: '1.5' }
const unsubLink = { color: '#6b7280', textDecoration: 'underline' as const }
const hr = { borderColor: '#e5e7eb', margin: '24px 0' }
const footer = { fontSize: '11px', color: '#9ca3af', textAlign: 'center' as const, margin: '0' }
