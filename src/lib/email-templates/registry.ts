import type { ComponentType } from 'react'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

import { template as invitation } from './invitation'
import { template as leadCaptureAlert } from './lead-capture-alert'
import { template as grantExpiryWarning } from './grant-expiry-warning'
import { template as askQuotaExhausted } from './ask-quota-exhausted'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'invitation': invitation,
  'lead-capture-alert': leadCaptureAlert,
  'grant-expiry-warning': grantExpiryWarning,
  'ask-quota-exhausted': askQuotaExhausted,
}
