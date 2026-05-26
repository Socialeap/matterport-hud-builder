import React from 'react'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface TrialPurgeWarningProps {
  brandName?: string
  purgeDate?: string
  pricingUrl?: string
}

const TrialPurgeWarning = ({
  brandName = 'Your Studio',
  purgeDate = 'soon',
  pricingUrl,
}: TrialPurgeWarningProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      Your Studio files will be permanently deleted on {purgeDate}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your Studio data is scheduled for removal</Heading>
        <Text style={text}>
          Hi {brandName}, because your workspace has been inactive for an extended period,
          we're reaching out to let you know that your custom configurations, templates,
          branding files, and uploaded assets are scheduled for <strong>permanent deletion
          on {purgeDate}</strong>.
        </Text>
        <Text style={text}>
          This includes your logo, hero backgrounds, gallery images, and any saved
          presentation templates. Once removed, this data cannot be recovered.
        </Text>
        <Text style={text}>
          If you'd like to keep your work, simply reactivate your Studio by choosing a
          plan before the date above. Your full workspace will be restored immediately.
        </Text>
        {pricingUrl && (
          <Button style={button} href={pricingUrl}>
            Save My Studio — Choose a Plan
          </Button>
        )}
        <Hr style={hr} />
        <Text style={footer}>
          If you no longer need your Studio workspace, no action is required — your data
          will be cleaned up automatically. Reply to this email if you have questions.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: TrialPurgeWarning,
  subject: (data: Record<string, any>) =>
    `Action required: Your Studio files will be deleted on ${data.purgeDate ?? 'the scheduled date'}`,
  displayName: 'Trial purge warning',
  previewData: {
    brandName: 'Acme 3D Tours',
    purgeDate: 'June 25, 2026',
    pricingUrl: 'https://3dps.transcendencemedia.com/p/acme#pricing',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container = { padding: '40px 25px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#dc2626', margin: '0 0 24px' }
const text = { fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }
const button = {
  backgroundColor: '#dc2626',
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
