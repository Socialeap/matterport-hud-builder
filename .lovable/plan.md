## Goal

Restructure the landing page Self-Serve Work Flow section into 3 thematic subgroups, and remove the now-redundant Visitor Experience section.

## Changes (all in `src/routes/index.tsx`)

### 1. Replace flat `clientFeatures` array with 3 grouped arrays

Replace the single `clientFeatures` array (lines ~141–226) with three named arrays (preserving existing icons + descriptions verbatim):

**`presentationFeatures` — "Stunning Interactive Presentations"**
1. Multi-Model Presentation Portal (`Layers`)
2. 15+ Tour Behaviors (`Zap`)
3. Matterport Media Sync & Cinema Mode (`Film`)
4. Google-Powered Neighborhood Map (`MapPin`)
5. Production Vault Add-Ons (`Archive`)

**`salesFeatures` — "24/7 Smart Sales & Chat"**
1. The AI Concierge (`Bot`)
2. Teach Your AI in Minutes (`GraduationCap`)
3. Unlimited AI Answers (`InfinityIcon`)
4. Instant Lead Alerts (`MailCheck`)
5. Host Live Guided Tours (`Video`)

**`ownershipFeatures` — "Privacy, Stats & Ownership"**
1. Brand + SEO/GEO Sovereignty (`Globe`)
2. Built-In Traffic Analytics (`BarChart3`)
3. Secure, VIP Access Gates (`Lock`)
4. Try Before You Buy Presentations (`Wand2`)

### 2. Update Self-Serve section JSX (lines ~719–743)

Keep the outer `<section>`, main `<h2>` ("Clients will Love your Studio's Self-Serve Work Flow"), and lead-in paragraph. Replace the single grid with three subgroup blocks:

```tsx
{[
  { heading: "Stunning Interactive Presentations", items: presentationFeatures },
  { heading: "24/7 Smart Sales & Chat", items: salesFeatures },
  { heading: "Privacy, Stats & Ownership", items: ownershipFeatures },
].map((group) => (
  <div key={group.heading} className="mt-14 first:mt-12">
    <h3 className="text-center text-xl font-semibold text-amber-300/90 sm:text-2xl">
      {group.heading}
    </h3>
    <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {group.items.map((f) => (
        <Card key={f.title} className={`${cardBg} backdrop-blur transition-all ...`}>
          {/* identical card markup as today */}
        </Card>
      ))}
    </div>
  </div>
))}
```

Card markup, `cardBg`, hover treatment, icon tint — all unchanged.

### 3. Delete Visitor Experience section + dead code

- Remove the entire `{/* ---- Visitor experience section ---- */}` block (lines ~745–769).
- Remove the `visitorFeatures` array (lines ~228–247).
- Remove unused icon imports: `KeyRound`, `Inbox`, `ShieldCheck` (only used by the deleted section — will verify with `rg` before removing).

### 4. Untouched

- All other arrays (`whyFeatures`, `starterFeatures`, `proFeatures`), pricing, hero, problem, footer.
- Section background tints (`sectionTint`), borders, typography, color tokens.
- All card styling and hover behavior.

## Result

One main section with the existing heading, three clearly labeled subgroups (5 / 5 / 4 cards) using the same card component, and the redundant visitor section removed.
