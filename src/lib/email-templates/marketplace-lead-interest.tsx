import {
  Body, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  mspBrandName?: string
  agentName?: string | null
  agentEmail?: string
  agentBrokerage?: string | null
  agentCity?: string
  agentRegion?: string | null
  essentialServices?: string[]
  preferableServices?: string[]
}

const formatLabel = (s: string) =>
  s.replace(/^scan-|^vault-|^ai-/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

function MarketplaceLeadInterestEmail({
  mspBrandName = 'there',
  agentName = null,
  agentEmail = '',
  agentBrokerage = null,
  agentCity = '',
  agentRegion = null,
  essentialServices = [],
  preferableServices = [],
}: Props) {
  const location = [agentCity, agentRegion].filter(Boolean).join(', ')
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>An agent is interested in your studio</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>An agent wants to connect</Heading>
          <Section style={card}>
            <Text style={text}>Hi {mspBrandName},</Text>
            <Text style={text}>
              An agent in <strong>{location || 'your service area'}</strong> reviewed their MSP
              Service Match results and asked us to introduce you. Their contact details are below
              — they consented to share these so you can reach out directly.
            </Text>
            <Text style={text}>
              <strong>Name:</strong> {agentName || '(not provided)'}<br />
              <strong>Email:</strong> <Link href={`mailto:${agentEmail}`} style={linkText}>{agentEmail}</Link><br />
              {agentBrokerage && (<><strong>Brokerage:</strong> {agentBrokerage}<br /></>)}
              <strong>Location:</strong> {location || '—'}
            </Text>
            {essentialServices.length > 0 && (
              <Text style={text}><strong>Essential services:</strong> {essentialServices.map(formatLabel).join(', ')}</Text>
            )}
            {preferableServices.length > 0 && (
              <Text style={text}><strong>Preferable services:</strong> {preferableServices.map(formatLabel).join(', ')}</Text>
            )}
          </Section>
          <Hr style={hr} />
          <Text style={footer}>3D Presentation Studio · powered by Transcendence Media</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: MarketplaceLeadInterestEmail,
  subject: ({ agentCity }: Record<string, unknown>) =>
    `Agent interested in your studio${agentCity ? ` (${agentCity})` : ''}`,
  displayName: 'Marketplace Lead Interest',
  previewData: {
    mspBrandName: 'Magnolia Immersive',
    agentName: 'Sarah Chen',
    agentEmail: 'sarah@brokerage.com',
    agentBrokerage: 'Buckhead Realty',
    agentCity: 'Atlanta',
    agentRegion: 'GA',
    essentialServices: ['scan-matterport-pro3'],
    preferableServices: ['scan-drone-aerial'],
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#f6f9fc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container = { maxWidth: '560px', margin: '0 auto', padding: '20px 0 48px' }
const h1 = { fontSize: '22px', fontWeight: '700' as const, color: '#1a1a2e', margin: '0 0 24px' }
const card = { backgroundColor: '#ffffff', borderRadius: '8px', padding: '24px', border: '1px solid #e5e7eb' }
const text = { fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }
const linkText = { color: '#2563eb' }
const hr = { borderColor: '#e5e7eb', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#9ca3af', textAlign: 'center' as const, margin: '0' }
