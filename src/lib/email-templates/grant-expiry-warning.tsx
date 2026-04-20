import React from 'react'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface GrantExpiryWarningProps {
  brandName?: string
  daysLeft?: number
  expiryDate?: string
  pricingUrl?: string
}

const GrantExpiryWarning = ({
  brandName = 'Your Studio',
  daysLeft = 14,
  expiryDate = 'soon',
  pricingUrl,
}: GrantExpiryWarningProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      Your complimentary Studio access expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your access expires soon</Heading>
        <Text style={text}>
          Hi {brandName}, your complimentary Studio access will expire in{' '}
          <strong>
            {daysLeft} day{daysLeft !== 1 ? 's' : ''}
          </strong>{' '}
          on <strong>{expiryDate}</strong>.
        </Text>
        <Text style={text}>
          To keep your studio online and continue serving your clients without
          interruption, please purchase a plan before your access ends.
        </Text>
        {pricingUrl && (
          <Button style={button} href={pricingUrl}>
            View Plans &amp; Purchase
          </Button>
        )}
        <Hr style={hr} />
        <Text style={footer}>
          If you have any questions, reply to this email and we'll be happy to help.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: GrantExpiryWarning,
  subject: (data: Record<string, any>) =>
    `Your complimentary Studio access expires in ${data.daysLeft ?? 14} day${data.daysLeft !== 1 ? 's' : ''}`,
  displayName: 'Grant expiry warning',
  previewData: {
    brandName: 'Acme 3D Tours',
    daysLeft: 7,
    expiryDate: 'May 1, 2026',
    pricingUrl: 'https://3dps.transcendencemedia.com/p/acme#pricing',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container = { padding: '40px 25px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#111827', margin: '0 0 24px' }
const text = { fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }
const button = {
  backgroundColor: '#d97706',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: '600' as const,
  padding: '12px 24px',
  textDecoration: 'none' as const,
  display: 'inline-block' as const,
  margin: '8px 0 24px',
}
const hr = { borderColor: '#e5e7eb', margin: '24px 0' }
const footer = { fontSize: '13px', color: '#9ca3af', margin: '0' }
