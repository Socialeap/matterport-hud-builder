import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  agentName?: string
  city?: string
  essentialServices?: string[]
  preferableServices?: string[]
  matchUrl?: string
}

const formatLabel = (s: string) =>
  s.replace(/^scan-|^vault-|^ai-/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

function ServiceMatchReadyEmail({
  agentName = 'there',
  city = 'your area',
  essentialServices = [],
  preferableServices = [],
  matchUrl = '#',
}: Props) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your MSP Service Match is ready in {city}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Your MSP Service Match is ready</Heading>
          <Section style={card}>
            <Text style={text}>Hi {agentName},</Text>
            <Text style={text}>
              We've put together your MSP Service Match for <strong>{city}</strong>. During the
              first 24 hours, Pro Partner studios appear first; after that, the match window
              opens to all qualifying studios.
            </Text>
            {essentialServices.length > 0 && (
              <Text style={text}><strong>Essential:</strong> {essentialServices.map(formatLabel).join(', ')}</Text>
            )}
            {preferableServices.length > 0 && (
              <Text style={text}><strong>Preferable:</strong> {preferableServices.map(formatLabel).join(', ')}</Text>
            )}
            <Section style={{ textAlign: 'center', margin: '24px 0' }}>
              <Button style={button} href={matchUrl}>View matching studios</Button>
            </Section>
            <Text style={hint}>Or paste this link in your browser: <span style={linkText}>{matchUrl}</span></Text>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>3D Presentation Studio · powered by Transcendence Media</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: ServiceMatchReadyEmail,
  subject: ({ city }: Record<string, unknown>) =>
    `Your MSP Service Match is ready${city ? ` in ${city}` : ''}`,
  displayName: 'Service Match Ready',
  previewData: {
    agentName: 'Sarah',
    city: 'Atlanta, GA',
    essentialServices: ['scan-matterport-pro3', 'scan-floor-plans'],
    preferableServices: ['scan-drone-aerial'],
    matchUrl: 'https://www.frontiers3d.com/agents/match/00000000-0000-0000-0000-000000000000',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#f6f9fc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container = { maxWidth: '560px', margin: '0 auto', padding: '20px 0 48px' }
const h1 = { fontSize: '24px', fontWeight: '700' as const, color: '#1a1a2e', margin: '0 0 24px' }
const card = { backgroundColor: '#ffffff', borderRadius: '8px', padding: '24px', border: '1px solid #e5e7eb' }
const text = { fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }
const hint = { fontSize: '12px', color: '#6b7280', margin: '0 0 16px' }
const linkText = { color: '#2563eb', wordBreak: 'break-all' as const }
const button = { backgroundColor: '#2563eb', borderRadius: '6px', color: '#ffffff', fontSize: '15px', fontWeight: '600' as const, padding: '12px 24px', textDecoration: 'none' as const, display: 'inline-block' as const }
const hr = { borderColor: '#e5e7eb', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#9ca3af', textAlign: 'center' as const, margin: '0' }
