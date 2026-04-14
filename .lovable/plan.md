

## Plan: Add Google Analytics Measurement ID Field

The Google Analytics Measurement ID is a per-agent/per-presentation setting that clients enter so it gets injected into the generated HTML file's `<head>`. The most logical place is the **Agent** tab, since it contains the client's profile and contact info — analytics tracking is another per-client configuration.

### Changes

**1. Update `AgentContact` type (`src/components/portal/types.ts`)**
- Add `gaTrackingId: string` to the `AgentContact` interface
- Add `gaTrackingId: ""` to `DEFAULT_AGENT`

**2. Add GA field to `AgentContactSection` (`src/components/portal/AgentContactSection.tsx`)**
- Add a new input field after the social links section (or as a separate card/subsection labeled "Analytics & Tracking")
- Field label: "Google Analytics Measurement ID"
- Placeholder: `G-XXXXXXXXXX`
- Include helper text: "Enter your GA4 Measurement ID. This will be injected into the generated presentation's header for traffic monitoring."
- Use the `BarChart3` icon from lucide-react for visual consistency

**3. Update demo page state (`src/routes/_authenticated.dashboard.demo.tsx`)**
- No changes needed — the `AgentContact` type flows through automatically since the demo page already uses `agent` state with `DEFAULT_AGENT` and passes `onChange` generically by field key.

### Technical Notes
- The field value will be available at generation time as `agent.gaTrackingId` for injection into the standalone HTML `<head>` as the standard `gtag.js` snippet.
- No database migration needed — `saved_models` already stores config as JSONB (`tour_config`), which can include this field.

