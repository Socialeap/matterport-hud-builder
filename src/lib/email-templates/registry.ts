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
import { template as marketplaceOutreach } from './marketplace-outreach'
import { template as mapOraclePreviewOffer } from './map-oracle-preview-offer'
import { template as serviceMatchReady } from './service-match-ready'
import { template as marketplaceLeadInterest } from './marketplace-lead-interest'
import { template as trialExpired } from './trial-expired'
import { template as trialPurgeWarning } from './trial-purge-warning'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'invitation': invitation,
  'lead-capture-alert': leadCaptureAlert,
  'grant-expiry-warning': grantExpiryWarning,
  'ask-quota-exhausted': askQuotaExhausted,
  'ask-quota-warning': askQuotaWarning,
  'beacon-match-found': beaconMatchFound,
  'marketplace-lead-assigned': marketplaceLeadAssigned,
  'marketplace-outreach': marketplaceOutreach,
  'map-oracle-preview-offer': mapOraclePreviewOffer,
  'service-match-ready': serviceMatchReady,
  'marketplace-lead-interest': marketplaceLeadInterest,
  'trial-expired': trialExpired,
  'trial-purge-warning': trialPurgeWarning,
}
