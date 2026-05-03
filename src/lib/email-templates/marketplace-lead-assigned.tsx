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

interface MarketplaceLeadAssignedProps {
  providerName?: string
  agentName?: string | null
  city?: string
  expiresAtIso?: string
  dashboardUrl?: string
  studioUrl?: string | null
}

function formatExpiry(iso?: string): string {
  if (!iso) return 'in 72 hours'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'in 72 hours'
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

function MarketplaceLeadAssignedEmail({
  providerName = 'there',
  agentName = null,
  city = 'your area',
  expiresAtIso,
  dashboardUrl = 'https://3dps.transcendencemedia.com/dashboard/marketplace',
}: MarketplaceLeadAssignedProps) {
  const expiry = formatExpiry(expiresAtIso)
  const agentLabel = agentName ? agentName : 'A new agent'

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        New exclusive lead in {city} — respond by {expiry}.
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>You have an exclusive lead</Heading>

          <Section style={card}>
            <Text style={text}>Hi {providerName},</Text>
            <Text style={text}>
              <strong>{agentLabel}</strong> in <strong>{city}</strong> has
              joined the 3DPS Marketplace and is matched exclusively to you
              for the next 72 hours. No other Pro Partner sees this lead
              while your window is open.
            </Text>

            <Section style={callout}>
              <Text style={calloutLabel}>Respond by</Text>
              <Text style={calloutValue}>{expiry}</Text>
            </Section>

            <Text style={text}>
              Open your dashboard to see the agent's contact info and reach
              out. If you don't contact them before the window closes, the
              lead automatically re-pools to the next Pro in the queue.
            </Text>

            <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
              <Button style={button} href={dashboardUrl}>
                Open Marketplace Dashboard
              </Button>
            </Section>

            <Text style={hint}>
              You're receiving this because your studio is listed in the
              3DPS Marketplace and serves this location. Pause your listing
              from /dashboard/branding to stop receiving leads.
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
  component: MarketplaceLeadAssignedEmail,
  subject: ({ city }: Record<string, unknown>) =>
    `New exclusive lead in ${city || 'your area'} — respond within 72h`,
  displayName: 'Marketplace Lead Assigned',
  previewData: {
    providerName: 'Magnolia Immersive',
    agentName: 'Sarah Lin',
    city: 'Atlanta, GA',
    expiresAtIso: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    dashboardUrl: 'https://3dps.transcendencemedia.com/dashboard/marketplace',
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
const callout = {
  backgroundColor: '#eff6ff',
  border: '1px solid #bfdbfe',
  borderRadius: '6px',
  padding: '14px 16px',
  margin: '16px 0',
}
const calloutLabel = {
  fontSize: '11px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: '#1e40af',
  fontWeight: '600' as const,
  margin: '0 0 4px',
}
const calloutValue = {
  fontSize: '15px',
  color: '#1e3a8a',
  fontWeight: '600' as const,
  margin: '0',
}
const hint = {
  fontSize: '12px',
  color: '#6b7280',
  margin: '0',
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
