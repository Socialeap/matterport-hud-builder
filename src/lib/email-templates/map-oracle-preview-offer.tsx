import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface MapOraclePreviewOfferProps {
  businessName?: string | null
  city?: string | null
  /** Working unsubscribe URL (token-based). Supplied by send_map_oracle_outreach. */
  unsubscribeUrl?: string
  /** CAN-SPAM physical postal address of the sender. */
  physicalAddress?: string
}

function MapOraclePreviewOfferEmail({
  businessName = null,
  city = null,
  unsubscribeUrl,
  physicalAddress = 'Transcendence Media, Atlanta, GA, USA',
}: MapOraclePreviewOfferProps) {
  const who = businessName ? businessName : 'your business'
  const place = city ? ` in ${city}` : ''

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>A free preview of an interactive 3D tour for {who}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Turn your Google Maps presence into an interactive tour</Heading>

          <Section style={card}>
            <Text style={text}>Hi {who} team,</Text>

            <Text style={text}>
              We noticed {who}{place} has Google Maps Street View / 360 / inside-tour
              potential. We'd like to offer a <strong>free preview</strong> of adding
              <strong> interactive functionality</strong> on top of that presence — so
              prospective customers can explore your space online before they visit.
            </Text>

            <Text style={text}>
              If you don't have 3D imagery yet, we can also <strong>connect you with a
              local provider</strong> to virtualize your space first, then layer the
              interactive experience on top.
            </Text>

            <Text style={text}>
              Interested in seeing a preview for {who}? Just reply to this email and
              we'll put one together — no cost and no obligation.
            </Text>
          </Section>

          <Hr style={hr} />

          {/* CAN-SPAM footer: clear identification, postal address, unsubscribe. */}
          <Section style={footerCard}>
            <Text style={footerLine}>
              This is a one-time outreach offer from Frontiers3D (Transcendence Media).
              You're receiving it because {who} appears in public business listings as a
              candidate for interactive 3D presentation.
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
    unsubscribeUrl: 'https://3dps.transcendencemedia.com/email/unsubscribe?token=preview',
    physicalAddress: 'Transcendence Media, 1100 Peachtree St NE, Suite 200, Atlanta, GA 30309, USA',
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}
const container = { maxWidth: '560px', margin: '0 auto', padding: '20px 0 48px' }
const h1 = { fontSize: '20px', fontWeight: '700' as const, color: '#1a1a2e', margin: '0 0 24px' }
const card = { backgroundColor: '#ffffff', borderRadius: '8px', padding: '24px', border: '1px solid #e5e7eb' }
const text = { fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }
const footerCard = { backgroundColor: '#f9fafb', borderRadius: '6px', padding: '12px 16px', margin: '8px 0 16px', border: '1px solid #e5e7eb' }
const footerLine = { fontSize: '12px', color: '#6b7280', margin: '0 0 6px', lineHeight: '1.5' }
const unsubLink = { color: '#6b7280', textDecoration: 'underline' as const }
const hr = { borderColor: '#e5e7eb', margin: '24px 0' }
const footer = { fontSize: '11px', color: '#9ca3af', textAlign: 'center' as const, margin: '0' }
