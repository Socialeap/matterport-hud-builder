import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Heading,
  Hr,
  Link,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface LeadCaptureAlertProps {
  agentName?: string
  visitorEmail?: string
  propertyName?: string
  capturedAt?: string
}

function LeadCaptureAlertEmail({
  agentName = 'Agent',
  visitorEmail = 'visitor@example.com',
  propertyName = 'Unknown Property',
  capturedAt = new Date().toISOString(),
}: LeadCaptureAlertProps) {
  const formattedDate = new Date(capturedAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: '#f6f9fc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <Container style={{ maxWidth: '560px', margin: '0 auto', padding: '20px 0 48px' }}>
          <Heading style={{ fontSize: '24px', fontWeight: '700', color: '#1a1a2e', marginBottom: '24px' }}>
            🎯 New Lead Captured
          </Heading>

          <Section style={{ backgroundColor: '#ffffff', borderRadius: '8px', padding: '24px', border: '1px solid #e5e7eb' }}>
            <Text style={{ fontSize: '16px', color: '#374151', margin: '0 0 16px' }}>
              Hi {agentName},
            </Text>
            <Text style={{ fontSize: '15px', color: '#374151', margin: '0 0 16px' }}>
              A visitor just submitted their email while viewing your 3D property presentation.
            </Text>

            <Section style={{ backgroundColor: '#f0f9ff', borderRadius: '6px', padding: '16px', margin: '16px 0' }}>
              <Text style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 4px' }}>Visitor Email</Text>
              <Text style={{ fontSize: '16px', fontWeight: '600', color: '#1e40af', margin: '0 0 12px' }}>
                <Link href={`mailto:${visitorEmail}`} style={{ color: '#1e40af', textDecoration: 'none' }}>
                  {visitorEmail}
                </Link>
              </Text>

              <Text style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 4px' }}>Property</Text>
              <Text style={{ fontSize: '16px', fontWeight: '600', color: '#111827', margin: '0 0 12px' }}>
                {propertyName}
              </Text>

              <Text style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 4px' }}>Captured At</Text>
              <Text style={{ fontSize: '14px', color: '#111827', margin: '0' }}>
                {formattedDate}
              </Text>
            </Section>

            <Text style={{ fontSize: '14px', color: '#6b7280', margin: '16px 0 0' }}>
              We recommend reaching out within 24 hours for the best conversion rate.
            </Text>
          </Section>

          <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />
          <Text style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'center' as const }}>
            This email was sent by the 3D Presentation Studio Lead-Hook Bridge.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template: TemplateEntry = {
  component: LeadCaptureAlertEmail,
  subject: ({ propertyName }) => `🎯 New Lead: ${propertyName || 'Property Inquiry'}`,
  displayName: 'Lead Capture Alert',
  previewData: {
    agentName: 'Sarah Johnson',
    visitorEmail: 'buyer@example.com',
    propertyName: '123 Ocean Drive, Miami Beach',
    capturedAt: new Date().toISOString(),
  },
}
