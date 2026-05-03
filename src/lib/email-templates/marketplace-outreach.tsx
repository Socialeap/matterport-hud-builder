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

interface MarketplaceOutreachProps {
  agentName?: string | null
  mspBrandName?: string
  replyToEmail?: string | null
  subject?: string
  body?: string
  feedbackUrl?: string
}

function MarketplaceOutreachEmail({
  agentName = null,
  mspBrandName = 'A 3DPS Marketplace Pro',
  replyToEmail = null,
  subject = 'A note from your matched 3D presentation studio',
  body = '',
  feedbackUrl,
}: MarketplaceOutreachProps) {
  // Pro-authored body — render as paragraphs so plain-text line
  // breaks survive without us trusting any HTML the Pro typed.
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const greeting = agentName ? `Hi ${agentName},` : 'Hi there,'

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{subject}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{subject}</Heading>

          <Section style={card}>
            <Text style={text}>{greeting}</Text>

            {paragraphs.length > 0 ? (
              paragraphs.map((p, i) => (
                <Text key={i} style={text}>
                  {p}
                </Text>
              ))
            ) : (
              <Text style={text}>{body}</Text>
            )}

            <Text style={text}>
              — {mspBrandName}
              {replyToEmail && (
                <>
                  <br />
                  <Link href={`mailto:${replyToEmail}`} style={replyLink}>
                    Reply directly: {replyToEmail}
                  </Link>
                </>
              )}
            </Text>
          </Section>

          <Hr style={hr} />

          <Section style={footerCard}>
            <Text style={footerLine}>
              Sent via the 3DPS Marketplace because you joined the waitlist
              for a local Pro Partner.
            </Text>
            {feedbackUrl && (
              <Text style={footerLine}>
                <Link href={feedbackUrl} style={feedbackLink}>
                  Report inappropriate outreach
                </Link>
              </Text>
            )}
          </Section>

          <Text style={footer}>
            3D Presentation Studio · powered by Transcendence Media
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: MarketplaceOutreachEmail,
  subject: ({ subject, mspBrandName }: Record<string, unknown>) =>
    String(subject || `A note from ${mspBrandName || 'your matched studio'}`),
  displayName: 'Marketplace Outreach',
  previewData: {
    agentName: 'Sarah',
    mspBrandName: 'Magnolia Immersive',
    replyToEmail: 'studio@magnoliaimmersive.com',
    subject: 'Custom Matterport tour for your Buckhead listing',
    body:
      "Hi Sarah,\n\nI saw your listing on Peachtree and wanted to introduce myself — I'm the studio owner at Magnolia Immersive, a Pro Partner in the 3DPS Marketplace.\n\nWe just delivered a 4-bedroom in West Buckhead last week with a same-day Matterport scan and a branded interactive tour. Would you like to see the result?\n\nHappy to chat about pricing or schedule a walkthrough.",
    feedbackUrl:
      'https://3dps.transcendencemedia.com/marketplace/feedback/00000000-0000-0000-0000-000000000000',
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}
const container = { maxWidth: '560px', margin: '0 auto', padding: '20px 0 48px' }
const h1 = {
  fontSize: '20px',
  fontWeight: '700' as const,
  color: '#1a1a2e',
  margin: '0 0 24px',
}
const card = {
  backgroundColor: '#ffffff',
  borderRadius: '8px',
  padding: '24px',
  border: '1px solid #e5e7eb',
}
const text = {
  fontSize: '15px',
  color: '#374151',
  lineHeight: '1.6',
  margin: '0 0 16px',
  whiteSpace: 'pre-wrap' as const,
}
const replyLink = {
  color: '#2563eb',
  textDecoration: 'underline' as const,
  fontSize: '14px',
}
const footerCard = {
  backgroundColor: '#f9fafb',
  borderRadius: '6px',
  padding: '12px 16px',
  margin: '8px 0 16px',
  border: '1px solid #e5e7eb',
}
const footerLine = {
  fontSize: '12px',
  color: '#6b7280',
  margin: '0 0 4px',
  lineHeight: '1.5',
}
const feedbackLink = {
  color: '#6b7280',
  textDecoration: 'underline' as const,
}
const hr = { borderColor: '#e5e7eb', margin: '24px 0' }
const footer = {
  fontSize: '11px',
  color: '#9ca3af',
  textAlign: 'center' as const,
  margin: '0',
}
