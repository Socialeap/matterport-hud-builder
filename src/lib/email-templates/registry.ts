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
import { template as askQuotaWarning } from './ask-quota-warning'
import { template as beaconMatchFound } from './beacon-match-found'
import { template as marketplaceLeadAssigned } from './marketplace-lead-assigned'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'invitation': invitation,
  'lead-capture-alert': leadCaptureAlert,
  'grant-expiry-warning': grantExpiryWarning,
  'ask-quota-exhausted': askQuotaExhausted,
  'ask-quota-warning': askQuotaWarning,
  'beacon-match-found': beaconMatchFound,
  'marketplace-lead-assigned': marketplaceLeadAssigned,
}
