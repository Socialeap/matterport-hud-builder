import React from 'react'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

const SITE_NAME = "matterport-hud-builder"

interface InvitationEmailProps {
  providerName?: string
  signupUrl?: string
}

const InvitationEmail = ({ providerName, signupUrl }: InvitationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to {SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>You're Invited!</Heading>
        <Text style={text}>
          {providerName
            ? `${providerName} has invited you to join their platform on ${SITE_NAME}.`
            : `You've been invited to join ${SITE_NAME}.`}
        </Text>
        <Text style={text}>
          Click the button below to create your account and get started.
        </Text>
        {signupUrl && (
          <Button style={button} href={signupUrl}>
            Accept Invitation
          </Button>
        )}
        <Hr style={hr} />
        <Text style={footer}>
          If you didn't expect this invitation, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: InvitationEmail,
  subject: "You've been invited to join " + SITE_NAME,
  displayName: 'Client invitation',
  previewData: {
    providerName: 'Acme Studios',
    signupUrl: 'https://example.com/signup?token=abc123',
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
