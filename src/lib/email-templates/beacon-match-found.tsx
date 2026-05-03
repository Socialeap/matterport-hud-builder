import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface BeaconMatchFoundProps {
  agentName?: string
  city?: string
  mspBrandName?: string
  studioUrl?: string | null
}

function BeaconMatchFoundEmail({
  agentName = 'there',
  city = 'your area',
  mspBrandName = 'A 3D Presentation Studio Pro Partner',
  studioUrl = null,
}: BeaconMatchFoundProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        Match found in {city} — {mspBrandName} is now active.
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Match found in {city}</Heading>

          <Section style={card}>
            <Text style={text}>Hi {agentName},</Text>
            <Text style={text}>
              Good news — <strong>{mspBrandName}</strong> just activated as a 3D
              Presentation Studio Pro Partner in your market. They offer
              professional Matterport scans plus a self-serve presentation
              studio with branded portals, an AI Concierge, and built-in lead
              capture.
            </Text>

            {studioUrl && (
              <>
                <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
                  <Button style={button} href={studioUrl}>
                    Visit {mspBrandName}'s Studio
                  </Button>
                </Section>
                <Text style={hint}>
                  Or paste this link in your browser:{' '}
                  <span style={linkText}>{studioUrl}</span>
                </Text>
              </>
            )}

            <Text style={text}>
              You're receiving this because you joined the waitlist for a local
              Pro Partner in {city}.
            </Text>
          </Section>

          <Hr style={hr} />
          <Text style={footer}>
            3D Presentation Studio · powered by Transcendence Media
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: BeaconMatchFoundEmail,
  subject: ({ city, mspBrandName }: Record<string, unknown>) =>
    `Match found in ${city || 'your area'}: ${mspBrandName || 'a Pro Partner'} is now active`,
  displayName: 'Beacon Match Found',
  previewData: {
    agentName: 'Sarah',
    city: 'Atlanta, GA',
    mspBrandName: 'Magnolia Immersive',
    studioUrl: 'https://3dps.transcendencemedia.com/p/magnolia-immersive',
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}
const container = { maxWidth: '560px', margin: '0 auto', padding: '20px 0 48px' }
const h1 = {
  fontSize: '24px',
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
}
const hint = {
  fontSize: '12px',
  color: '#6b7280',
  margin: '0 0 16px',
}
const linkText = {
  color: '#2563eb',
  wordBreak: 'break-all' as const,
}
const button = {
  backgroundColor: '#2563eb',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: '600' as const,
  padding: '12px 24px',
  textDecoration: 'none' as const,
  display: 'inline-block' as const,
}
const hr = { borderColor: '#e5e7eb', margin: '24px 0' }
const footer = {
  fontSize: '12px',
  color: '#9ca3af',
  textAlign: 'center' as const,
  margin: '0',
}
