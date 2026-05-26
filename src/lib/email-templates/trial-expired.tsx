import React from 'react'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface TrialExpiredProps {
  brandName?: string
  pricingUrl?: string
}

const TrialExpired = ({
  brandName = 'Your Studio',
  pricingUrl,
}: TrialExpiredProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      Your 30-day trial has ended — workspace now restricted
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your free trial has reached its limit</Heading>
        <Text style={text}>
          Hi {brandName}, your 30-day free evaluation period has now ended. Your
          workspace has been reverted to restricted basic functionality.
        </Text>
        <Text style={text}>
          Your builder workspace is now in read-only mode — editing, publishing, and
          client access are paused. Your saved configurations and uploaded assets are
          safe for now and nothing has been deleted.
        </Text>
        <Text style={text}>
          To restore full access, unlock your builder, and bring your public studio
          URL back online, choose the tier that fits your business.
        </Text>
        {pricingUrl && (
          <Button style={button} href={pricingUrl}>
            Unlock My Studio
          </Button>
        )}
        <Hr style={hr} />
        <Text style={footer}>
          Questions? Just reply to this email and we'll help you out.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: TrialExpired,
  subject: 'Your 30-day trial has ended — workspace restricted',
  displayName: 'Trial expired notification',
  previewData: {
    brandName: 'Acme 3D Tours',
    pricingUrl: 'https://3dps.transcendencemedia.com/p/acme#pricing',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container = { padding: '40px 25px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#111827', margin: '0 0 24px' }
const text = { fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }
const button = {
  backgroundColor: '#2563eb',
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
