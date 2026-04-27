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
  Button,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface ExhaustedProps {
  agentName?: string
  propertyName?: string
  presentationName?: string
  freeLimit?: number
  byokSetupUrl?: string
  exhaustedAt?: string
}

function AskQuotaExhaustedEmail({
  agentName = 'Agent',
  propertyName = 'Unknown Property',
  presentationName = 'your presentation',
  freeLimit = 20,
  byokSetupUrl = 'https://example.com/dashboard/account',
  exhaustedAt = new Date().toISOString(),
}: ExhaustedProps) {
  const formattedDate = new Date(exhaustedAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <Html>
      <Head />
      <Body
        style={{
          backgroundColor: '#f6f9fc',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <Container
          style={{ maxWidth: '560px', margin: '0 auto', padding: '20px 0 48px' }}
        >
          <Heading
            style={{
              fontSize: '24px',
              fontWeight: '700',
              color: '#1a1a2e',
              marginBottom: '24px',
            }}
          >
            Ask AI free quota reached
          </Heading>

          <Section
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              padding: '24px',
              border: '1px solid #e5e7eb',
            }}
          >
            <Text
              style={{ fontSize: '16px', color: '#374151', margin: '0 0 16px' }}
            >
              Hi {agentName},
            </Text>
            <Text
              style={{ fontSize: '15px', color: '#374151', margin: '0 0 16px' }}
            >
              The {freeLimit}-answer free Gemini subsidy for{' '}
              <strong>{propertyName}</strong> in {presentationName} has been
              used up.
            </Text>

            <Section
              style={{
                backgroundColor: '#fffbeb',
                borderRadius: '6px',
                padding: '16px',
                margin: '16px 0',
              }}
            >
              <Text
                style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 4px' }}
              >
                What visitors see now
              </Text>
              <Text
                style={{ fontSize: '14px', color: '#111827', margin: '0' }}
              >
                The Ask AI input is automatically replaced by an inquiry form
                that emails you directly. Visitors are not blocked — they're
                routed straight to a lead-capture conversation with you.
              </Text>
            </Section>

            <Text
              style={{ fontSize: '15px', color: '#374151', margin: '16px 0 12px' }}
            >
              To reinstate Ask AI immediately, add your own Gemini API key.
              Costs are approximately $0.10 per 1M input tokens — pennies for
              thousands of visitor answers.
            </Text>

            <Button
              href={byokSetupUrl}
              style={{
                backgroundColor: '#1a1a2e',
                color: '#ffffff',
                padding: '10px 20px',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '600',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              Add Gemini key
            </Button>

            <Text
              style={{ fontSize: '12px', color: '#9ca3af', margin: '16px 0 0' }}
            >
              Quota exhausted at {formattedDate}.
            </Text>
          </Section>

          <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />
          <Text
            style={{
              fontSize: '12px',
              color: '#9ca3af',
              textAlign: 'center' as const,
            }}
          >
            See current Gemini pricing at{' '}
            <Link href="https://ai.google.dev/gemini-api/docs/pricing">
              ai.google.dev/gemini-api/docs/pricing
            </Link>
            .
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template: TemplateEntry = {
  component: AskQuotaExhaustedEmail,
  subject: ({ propertyName }) =>
    `Ask AI quota reached for ${propertyName || 'your property'}`,
  displayName: 'Ask Quota Exhausted',
  previewData: {
    agentName: 'Sarah Johnson',
    propertyName: '123 Ocean Drive, Miami Beach',
    presentationName: 'Spring 2026 Tour',
    freeLimit: 20,
    byokSetupUrl: 'https://example.com/dashboard/account',
    exhaustedAt: new Date().toISOString(),
  },
}
