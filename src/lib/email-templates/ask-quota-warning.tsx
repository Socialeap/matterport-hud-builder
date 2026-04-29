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

interface WarningProps {
  clientName?: string
  propertyName?: string
  presentationName?: string
  remaining?: number
  freeLimit?: number
  byokSetupUrl?: string
}

function AskQuotaWarningEmail({
  clientName = 'there',
  propertyName = 'your property',
  presentationName = 'your presentation',
  remaining = 3,
  freeLimit = 20,
  byokSetupUrl = 'https://example.com/p/your-slug/builder#ask-ai-byok',
}: WarningProps) {
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
            Only {remaining} free Ask AI answers left
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
              Hi {clientName},
            </Text>
            <Text
              style={{ fontSize: '15px', color: '#374151', margin: '0 0 16px' }}
            >
              Heads up — your published presentation{' '}
              <strong>{presentationName}</strong> for{' '}
              <strong>{propertyName}</strong> has only{' '}
              <strong>{remaining} of {freeLimit}</strong> free Ask&nbsp;AI
              visitor answers remaining (these are funded by Transcendence
              Media as part of your subscription).
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
                What happens when the subsidy runs out
              </Text>
              <Text
                style={{ fontSize: '14px', color: '#111827', margin: '0' }}
              >
                Visitors won't be blocked — the Ask AI input is automatically
                replaced by a Get-In-Touch form that emails you directly. To
                keep Ask AI active for visitors, add your own Gemini API key
                in your Builder. Costs are roughly $0.10 per 1M input tokens —
                pennies for thousands of answers.
              </Text>
            </Section>

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
              Add my Gemini key
            </Button>

            <Text
              style={{ fontSize: '12px', color: '#9ca3af', margin: '16px 0 0' }}
            >
              You'll only receive this reminder once per property.
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
  component: AskQuotaWarningEmail,
  subject: ({ remaining, propertyName }) =>
    `Only ${remaining ?? 3} free Ask AI answers left for ${propertyName || 'your property'}`,
  displayName: 'Ask Quota Warning',
  previewData: {
    clientName: 'Sarah',
    propertyName: '123 Ocean Drive, Miami Beach',
    presentationName: 'Spring 2026 Tour',
    remaining: 3,
    freeLimit: 20,
    byokSetupUrl: 'https://example.com/p/your-slug/builder#ask-ai-byok',
  },
}
