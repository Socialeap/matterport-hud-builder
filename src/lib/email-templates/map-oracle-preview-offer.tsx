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
 * email must not assert a 3D / 360 / Street View / virtual-tour presence until a
 * verifier sets them. A later verification step can populate the `*_verified` /
 * `*_detected` flags and the copy will adapt automatically.
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
  /** Primary CTA destination — a REUSABLE demo/example (never a per-lead mock-up). */
  demoUrl?: string
  /** Reply CTA — a monitored inbox the recipient can reply/write to. */
  replyToEmail?: string
  /**
   * Optional visual proof. ONLY a genuine, public, cached photo of the business
   * (a real `property_photos.cdn_url`). When absent, a neutral "public listing
   * found" callout is shown instead — we never fabricate a business image.
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
  demoUrl = 'https://www.frontiers3d.com',
  replyToEmail = 'info@transcendencemedia.com',
  previewImageUrl = null,
  evidence,
}: MapOraclePreviewOfferProps) {
  const who = businessName ? businessName : 'your business'

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

  const replyMailto = `mailto:${replyToEmail}?subject=${encodeURIComponent(
    `Interested — ${businessName || 'my business'}`
  )}`

  const outcomes = [
    'Show the atmosphere, layout, rooms, patios, private areas, event spaces, displays, or signature features',
    'Help guests answer “is this the right place for us?” before they call, book, or visit',
    'Make reservations, private events, group visits, and high-intent inquiries easier to visualize',
    'Give your website, Google presence, social links, and sales conversations a more memorable visual asset than flat photos alone',
    'Stand out from competitors who only show static image galleries',
  ]

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Most guests start deciding before they ever walk through your front door.</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Brand header */}
          <Section style={brandBar}>
            <Text style={brandWordmark}>FRONTIERS3D</Text>
            <Text style={brandTagline}>Interactive 3D for real-world places</Text>
          </Section>

          <Heading style={h1}>Let future guests explore your space before they arrive</Heading>

          <Section style={card}>
            {/* Hook */}
            <Text style={text}>
              <strong>Most guests start deciding before they ever walk through your front door.</strong>{' '}
              They scan your photos, reviews, map listing, and website to understand the atmosphere,
              layout, and overall feel of the place.
            </Text>

            {/* Personalized observation — only what evidence backs */}
            <Text style={text}>
              We found {who}'s public business listing{ev.website_detected ? ' and website' : ''}. Your
              online presence is already where many guests decide whether your space feels worth
              visiting.
            </Text>

            {/* Visual module: a real cached photo if we have one, otherwise a
                NEUTRAL "public listing found" callout. We never claim a 3D / 360 /
                Street View / virtual-tour presence, and never fabricate an image. */}
            {previewImageUrl ? (
              <Section style={proofImageWrap}>
                <Img src={previewImageUrl} alt={`Public listing image for ${who}`} width="512" style={proofImage} />
                <Text style={proofCaption}>Public listing image</Text>
              </Section>
            ) : (
              <Section style={proofCallout}>
                <Text style={proofBadge}>◍ PUBLIC LISTING{ev.website_detected ? ' + WEBSITE' : ''} FOUND</Text>
                <Text style={proofCalloutText}>
                  Based only on your public Google listing{ev.website_detected ? ' and website' : ''} —
                  nothing about your interior has been inspected or assumed.
                  {has360Evidence ? ' (We also found an existing tour we can build on.)' : ''}
                </Text>
              </Section>
            )}

            {/* Value */}
            <Text style={text}>
              Frontiers|3D helps turn real-world places into interactive 3D presentations people can
              explore before they arrive. For businesses with a strong physical environment, that can
              make the space easier to understand, remember, and choose.
            </Text>

            {/* Outcome bullets */}
            <Section style={{ margin: '4px 0 16px' }}>
              {outcomes.map((o, i) => (
                <Text key={i} style={bullet}>
                  •&nbsp;&nbsp;{o}
                </Text>
              ))}
            </Section>

            {/* Proof / ROI — carefully hedged, rendered as a supporting note */}
            <Text style={proofRoi}>
              Industry signals suggest that richer visual experiences can improve how people evaluate
              a place online. Google Business Profiles are designed to help businesses stand out on
              Search and Maps with photos, updates, reviews, and customer actions. Matterport also
              reports that people are shown to be 300% more engaged with 3D tours than 2D imagery in
              property-marketing contexts. We can't promise a specific result — but if one additional
              private event inquiry, reservation, booking, or high-intent visit comes from helping
              people understand your space sooner, the business case can become easy to justify.
            </Text>

            {/* Offer — reusable example, conditional both-ways (no per-lead mock-up) */}
            <Text style={text}>
              Click below to see an example of the kind of interactive 3D presentation Frontiers|3D can
              create for places like yours. If you already have a compatible tour or 360 imagery, we
              can build on it — and if not, we can help connect you with a local capture provider.
            </Text>

            {/* Primary CTA */}
            <Section style={ctaWrap}>
              <Button href={demoUrl} style={ctaButton}>
                See an example
              </Button>
            </Section>

            {/* Reply CTA */}
            <Text style={secondaryCta}>
              If you want something like this for {who}, just{' '}
              <Link href={replyMailto} style={secondaryLink}>
                reply “interested”
              </Link>{' '}
              and we'll send the simplest next step.
            </Text>

            {/* Closer */}
            <Text style={closer}>
              Your space may already be one of your strongest selling points. The goal is to let people
              experience more of it before they decide.
            </Text>
          </Section>

          <Hr style={hr} />

          {/* CAN-SPAM footer: clear identification, postal address, unsubscribe. */}
          <Section style={footerCard}>
            <Text style={footerLine}>
              This is a one-time outreach offer from Frontiers|3D (Transcendence Media). You're
              receiving it because {who} appears in public business listings as a candidate for an
              interactive presentation.
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

          <Text style={footer}>Frontiers|3D · powered by Transcendence Media</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: MapOraclePreviewOfferEmail,
  // Founder-style subject (one of several on-tone options); makes no 3D/360 claim.
  subject: ({ businessName }: Record<string, unknown>) =>
    `Help guests picture ${businessName || 'your space'} before they visit`,
  displayName: 'Map Oracle — Preview Offer',
  previewData: {
    businessName: "Mozart's Coffee Roasters",
    city: 'Austin, TX',
    unsubscribeUrl: 'https://www.frontiers3d.com/email/unsubscribe?token=preview',
    physicalAddress: 'Transcendence Media, 1100 Peachtree St NE, Suite 200, Atlanta, GA 30309, USA',
    demoUrl: 'https://www.frontiers3d.com',
    replyToEmail: 'info@transcendencemedia.com',
    // Left null so the gallery shows the neutral "public listing found" callout
    // (the common real case before a cached photo exists). A genuine cdn_url
    // renders an image instead.
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

const proofImageWrap = { margin: '4px 0 18px' }
const proofImage = {
  width: '100%',
  maxWidth: '512px',
  borderRadius: '8px',
  border: '1px solid #e5e7eb',
  display: 'block' as const,
}
const proofCaption = { fontSize: '12px', color: '#6b7280', margin: '6px 0 0', textAlign: 'center' as const }

const proofCallout = {
  backgroundColor: '#f3f4f6',
  borderRadius: '8px',
  border: '1px solid #e5e7eb',
  padding: '14px 18px',
  margin: '4px 0 18px',
}
const proofBadge = {
  fontSize: '11px',
  fontWeight: '700' as const,
  letterSpacing: '1px',
  color: '#374151',
  margin: '0 0 6px',
}
const proofCalloutText = { fontSize: '13px', color: '#6b7280', lineHeight: '1.55', margin: '0' }

const card = { backgroundColor: '#ffffff', borderRadius: '8px', padding: '24px', border: '1px solid #e5e7eb' }
const text = { fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }
const bullet = {
  fontSize: '15px',
  color: '#374151',
  lineHeight: '1.5',
  margin: '0 0 9px',
  paddingLeft: '18px',
  textIndent: '-18px',
}
const proofRoi = {
  fontSize: '13px',
  color: '#6b7280',
  lineHeight: '1.6',
  margin: '0 0 16px',
  padding: '12px 16px',
  backgroundColor: '#f9fafb',
  borderRadius: '6px',
  border: '1px solid #eef0f3',
}

const ctaWrap = { margin: '8px 0 12px', textAlign: 'center' as const }
const ctaButton = {
  backgroundColor: '#4f46e5',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: '700' as const,
  textDecoration: 'none' as const,
  borderRadius: '8px',
  padding: '13px 30px',
  display: 'inline-block' as const,
}
const secondaryCta = { fontSize: '14px', color: '#374151', lineHeight: '1.6', margin: '4px 0 0', textAlign: 'center' as const }
const secondaryLink = { color: '#4f46e5', textDecoration: 'underline' as const, fontWeight: '600' as const }
const closer = { fontSize: '14px', color: '#4b5563', lineHeight: '1.6', margin: '18px 0 0', fontStyle: 'italic' as const }

const footerCard = { backgroundColor: '#f9fafb', borderRadius: '6px', padding: '12px 16px', margin: '16px 0', border: '1px solid #e5e7eb' }
const footerLine = { fontSize: '12px', color: '#6b7280', margin: '0 0 6px', lineHeight: '1.5' }
const unsubLink = { color: '#6b7280', textDecoration: 'underline' as const }
const hr = { borderColor: '#e5e7eb', margin: '24px 0' }
const footer = { fontSize: '11px', color: '#9ca3af', textAlign: 'center' as const, margin: '0' }
