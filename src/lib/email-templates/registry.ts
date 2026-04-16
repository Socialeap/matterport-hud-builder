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

export const TEMPLATES: Record<string, TemplateEntry> = {
  'invitation': invitation,
  'lead-capture-alert': leadCaptureAlert,
}
