## Goals

1. Make the "Open Property Mapper" and "Manage saved maps" controls in the Production Vault → Property Docs tab actually respond, regardless of where the user already is.
2. Replace the property-specific language with class/category language across the callout, the templates page, the empty state, and the Architect dialog itself.
3. Tighten the Gemini 2.5 Flash-Lite prompts so the AI explicitly drafts a schema for a *class* of property and prioritizes "Source of Truth" fields for the visitor Ask AI chat.

---

## 1. Bug fix — unresponsive buttons

**Root cause:** Both controls in `PropertyDocArchitectCallout` (in `src/routes/_authenticated.dashboard.vault.tsx`) use `<Link to="/dashboard/vault/templates" …>`. When the user is already on the templates route, TanStack Router treats that as a no-op navigation, so the Architect dialog never opens. The "Open Property Mapper" link relies on the templates page seeing `?architect=1` *on first arrival* — it does not re-fire if the URL search is unchanged or if the page is already mounted with the param cleared.

**Fix:**

- Convert both controls to real buttons that call `useNavigate` with an explicit `search` and `replace: false`, and force an `architect=1` round trip even from the same route. 
- In `_authenticated.dashboard.vault.templates.tsx`, change the auto-open `useEffect` so it reacts to a single `architect` search param hit by:
  - Capturing the param.
  - Clearing it from the URL.
  - Opening the Architect editor.
  
  Make the effect resilient to repeat clicks: if the user clicks "Open Property Mapper" again after the dialog was closed, the param re-appears and the effect re-runs.
- The "Manage saved maps" control becomes a plain navigation to `/dashboard/vault/templates` *without* the architect param. If the user is already on that page, no-op is fine — but we'll also collapse any open Architect dialog so they actually see the saved list.

Both controls remain disabled with the existing Pro / LUS gating; we'll keep the Lock affordance unchanged.

---

## 2. UI copy refinement (clarity)

### a. `PropertyDocArchitectCallout` (Vault page, Property Docs tab)

- Title stays: **"Property Mapper for AI Chat"**
- New description:
  > "Easily build a mapping template for each type or category of property (e.g., Offices, Hotels, Apartments, Galleries, or Luxury Rentals). Your clients can use these to help the AI scan and convert their uploaded property data into real-world answers to visitors in the 'Ask AI' chat."
- New "How it works" footer:
  > "Describe property class → Select key facts → Finalize Mapper for client use."
- Button label stays "Open Property Mapper".
- Secondary link relabel: **"Manage existing mappers"** (replaces "Manage saved maps").

### b. Templates page (`/dashboard/vault/templates`)

- Page title stays "Property Maps for AI Chat".
- Subtitle rewrite to mirror the class-of-property framing:
  > "Each mapper is a reusable blueprint for a type or category of property. Your clients pick the right mapper, and the AI uses it to pull verified facts from their uploaded property documents to answer visitor questions in the 'Ask AI' chat."
- Empty-state copy refreshed in the same direction (mention "blueprints for a class of property" instead of "your clients' uploaded property documents").
- The two CTA cards keep their structure; revise the "Build with AI Mapper" card description to reference *class of property* instead of *your property class*.

### c. Architect dialog (`src/components/vault/TemplateArchitect.tsx`)

- Top title remains "Property Mapper for AI Chat".
- Helper sentence under the title:
  > "Describe a class or category of property → pick the facts that matter → we build the reusable mapper your clients' AI Chat will use on their uploaded docs."
- Phase 1 label change:
  - Replace `"Property class / type / description"` label with primary prompt **"Describe the class or category of property you want to architect."**
  - Replace placeholder with: `"e.g. Boutique Hotels, Luxury Coworking, or Multi-Family Housing..."`
  - Helper microcopy under the textarea: "The richer the class description, the smarter the candidate facts."

---

## 3. Prompt tuning (Gemini 2.5 Flash-Lite)

In `supabase/functions/induce-schema/index.ts`:

- Update `ARCHITECT_MISSION` (or add a one-line preamble in `runArchitectDraft` and `runArchitectRefine`) to make explicit:
  - The MSP is defining a **reusable schema for a class/category of property**, not a single listing.
  - The output must prioritize **"Source of Truth"** fields the AI will quote back to visitors in the Ask AI chat (price, address, capacity, amenities, hours, hospitality stats, brand story, signature features, etc.) over speculative or one-off attributes.
- In `runArchitectDraft` user prompt, change opening to: `Draft a candidate field list for this CLASS of property (a reusable mapping template, not a single listing):`
- In `runArchitectRefine` user prompt, prepend a one-line directive: `Build a reusable mapper schema for this class of property. Every required field must be a Source-of-Truth fact a visitor might ask about in chat.`
- Keep `gemini-2.5-flash-lite` model, temperatures, and JSON output contracts unchanged. No schema shape changes; downstream consumers stay compatible.

---

## Files to change

```text
src/routes/_authenticated.dashboard.vault.tsx
  - PropertyDocArchitectCallout: swap <Link> for navigate-driven <Button>;
    update description, footer, secondary label.

src/routes/_authenticated.dashboard.vault.templates.tsx
  - Update subtitle + empty-state copy.
  - Refactor the architect-search useEffect to re-fire on each new
    ?architect=1 hit and to close any open editor when arriving without it.

src/components/vault/TemplateArchitect.tsx
  - Update header helper text.
  - Update DescribePhase label + placeholder + helper microcopy.

supabase/functions/induce-schema/index.ts
  - Reword runArchitectDraft / runArchitectRefine user prompts to emphasize
    "class of property" and "Source of Truth" facts.
  - Optional: extend ARCHITECT_MISSION with one short clarifying line.
```

No database migrations, no new dependencies, no new routes. The edge function redeploys automatically.

---

## Verification

After the change:

- From `/dashboard/vault` → Property Docs tab, clicking **Open Property Mapper** opens the Architect dialog whether the user is on the Vault page or already on the templates page.
- Clicking **Manage existing mappers** lands on the templates list with no auto-open dialog.
- Architect dialog reads class-of-property language end-to-end.
- Gemini draft results center on facts a visitor would ask the Ask AI chat about, derived from the described property class.
