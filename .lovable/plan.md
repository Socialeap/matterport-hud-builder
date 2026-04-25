## Rename: "Template Architect" → "Property Mapper for AI Chat"

Your name is a clear win — it describes the **input** (Property data), the **action** (Mapping), and the **outcome** (smarter AI Chat). I have one small refinement to suggest, then a single recommendation; either is fine.

### Naming options

1. **Property Mapper for AI Chat** (your pick) — clearest and most literal.
2. *Property Knowledge Mapper* — slightly shorter, but loses the "AI Chat" payoff that explains *why* it matters.

**Recommendation: go with your name, "Property Mapper for AI Chat."** It anchors the feature to the visible benefit (the chat), which is exactly what an MSP cares about.

I'll also rename the underlying motion from "Template Architect" → **"Property Mapper"**, and tag the AI step as "AI-assisted" inline rather than as a brand name.

### Plain-language explanation (used across all surfaces)

> **Property Mapper for AI Chat** — Tell us what kind of property this is. The AI will list the facts worth pulling from your property documents (price, address, room counts, amenities, etc.). You tick what matters, and we build the "map" the AI Chat uses to answer your clients' questions.

How it works (3 steps):
1. **Describe** the property class.
2. **Refine** the suggested facts.
3. **Apply** — the AI Chat now knows what to look for in uploaded property docs.

### Surfaces to update

**1. `src/routes/_authenticated.dashboard.vault.tsx`**
- `PropertyDocArchitectCallout` (lines 847–907):
  - Heading: `AI Template Architect` → **`Property Mapper for AI Chat`**
  - Pitch copy → the plain-language explanation above.
  - "How it works" line → `Describe property → Pick the facts → Apply. Your AI Chat instantly gets smarter on uploaded docs.`
  - Primary button: `Launch Template Architect` → **`Open Property Mapper`**
  - Secondary link: `Manage existing templates` → **`Manage saved maps`**
- Add Property Doc dialog hint (lines 694–707):
  - "Build or edit it in Vault → Property Docs → Template Architect" → **"Build or edit it in Vault → Property Docs → Property Mapper"**

**2. `src/routes/_authenticated.dashboard.vault.templates.tsx`**
- Page heading (line 200): `Property Doc Templates` → **`Property Maps for AI Chat`**
- Page subtitle (lines 202–207): rewrite in plain language —
  > "Each map tells the AI which facts to pull from a kind of property document (price, address, beds, amenities…). The AI Chat uses these facts to answer your clients."
- Top-right button (line 220): `New with AI Architect` → **`New with AI`** (tooltip: "Build a map with AI assist")
- Editor dialog title (lines 538–545): description rewrite —
  > "Use the AI-assisted Property Mapper below, or expand the advanced sections to edit JSON, generate from a sample PDF, or dry-run."
- "PRIMARY ACTION: AI Architect" callout (lines 594–601): retain, replace copy with: *"Start here → Describe the property and let AI suggest the facts. You can still hand-edit JSON or use a sample PDF below."*
- EmptyState (lines 286–326): "Build with AI Architect" → **"Build with AI Mapper"**, copy refresh.

**3. `src/components/vault/TemplateArchitect.tsx`** (component file is NOT renamed — only display strings)
- Header label (line 140): `Guided Refinement Template Architect` → **`Property Mapper for AI Chat`**
- Sub-line (lines 146–149): *"Describe the property → pick the facts that matter → we build the map your AI Chat uses on uploaded property docs. No JSON required."*
- Keep the `Gemini 2.5 Flash-Lite` badge (it's accurate and developers will recognize it).

### What is **not** changed

- File names (`TemplateArchitect.tsx`, route URLs, query param `?architect=1`, props like `forceArchitect`, `onArchitect`) — internal only, no user impact, and renaming would touch routing/types unnecessarily.
- Backend / edge function (`induce-schema`) — naming is internal.
- Database column names (`vault_templates`, `doc_kind`, etc.) — out of scope.

### Verification

- Visit `/dashboard/vault` → Property Docs tab → callout reads "Property Mapper for AI Chat" with new copy and button.
- Click **Open Property Mapper** → editor opens, header inside Architect component reads "Property Mapper for AI Chat."
- Empty templates page shows the renamed primary card.
- Add Property Doc dialog hint points to "Property Mapper."
- `npm run verify:html` passes; no TypeScript regressions (only string changes).
