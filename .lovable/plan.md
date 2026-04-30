# Landing Page Feature Refresh — 3DPS

Goal: surface 8 newly-built capabilities on the homepage without touching layout, theme, or styling. We reuse the existing `Card` grid pattern and `lucide-react` icons already in use on `src/routes/index.tsx`.

## What changes

### 1. Extend the `clientFeatures` array (Agent/Builder section)

Add 5 new entries to the existing `clientFeatures` array (`src/routes/index.tsx` ~line 134). They'll render automatically inside the existing 3-column grid under the heading "Clients will Love your Studio's Self-Serve Work Flow". Icons come from `lucide-react` (some already imported, a few new ones added to the existing import block).

| # | Title | Icon | Body |
|---|---|---|---|
| 1 | Host Live Guided Tours | `Video` (new) | Don't just send a link — walk them through it. Hop into a live, two-way audio session right inside the 3D presentation. You can even "teleport" your client so they see exactly what you're looking at, all in real time. |
| 2 | Unlimited AI Answers | `Infinity` (new) | We give you 20 free AI answers per property. Want more? Plug in your own Google Gemini API key to remove the cap and let your AI Concierge run 24/7 on your own terms. |
| 3 | Built-In Traffic Analytics | `BarChart3` (new) | Know exactly how many eyeballs are on your properties. Check your built-in dashboard for weekly and monthly visit stats, or easily plug in your Google Analytics ID for deeper audience tracking. |
| 4 | Secure, VIP Access Gates | `Lock` (already imported) | Have an off-market or exclusive listing? Lock your presentation behind a secure password. Visitors can't view the tour, documents, or your contact info until they enter the correct code. |
| 5 | Teach Your AI in Minutes | `GraduationCap` (new) | You don't need to be a prompt engineer. Our simple 4-step training wizard lets you upload property docs and instantly teaches your AI Concierge exactly how to answer questions about the home. |

The existing grid is `sm:grid-cols-2 lg:grid-cols-3` and maps over the array, so no markup changes are needed — just data.

### 2. New "Visitor Experience" section (3 cards)

Insert a brand-new section between the Client value section (~line 685) and the Pricing section (~line 687). It mirrors the existing pattern exactly: same `<section>` wrapper classes, same heading styles, same `Card` markup, same hover treatments. A small local `visitorFeatures` array keeps the section self-contained.

Section copy:
- Heading: "What Visitors Get the Moment They Open the Tour"
- Subhead: "Your presentations are built to convert — frictionless to enter, always-on for leads, and private when it matters."

Cards:
| # | Title | Icon | Body |
|---|---|---|---|
| 1 | Seamless Live-Tour Access | `KeyRound` (new) | Joining a live guided tour is as easy as typing a 4-digit PIN. No software to download, no accounts to create — visitors just enter the code and instantly connect with their agent. |
| 2 | Never Miss a Lead | `Inbox` (new) | If your property gets a massive spike in traffic and exhausts your AI's free answer limit, the chat gracefully switches to a standard contact form. Your visitors are always taken care of. |
| 3 | VIP Privacy | `ShieldCheck` (new) | For password-protected properties, the entire experience stays fully encrypted in the browser until the correct password is provided, keeping sensitive listing details safe from prying eyes. |

Grid: `sm:grid-cols-2 lg:grid-cols-3` (same as Client value section).

### 3. Tighten the Client section subheading

The current subhead on the Client value section reads:
> "Hand your clients a self closing tool — not a service ticket. Your Studio makes 3D tour Presentations easily configurable and finalizes them into a permanent self-contained files."

It's grown stale and grammatically rough now that the section has 14 cards. Replace with:
> "Hand clients a self-serve studio — not a service ticket. They configure, brand, and walk away with a permanent, self-contained presentation file."

No other headings or layout change.

## Technical notes

- File: `src/routes/index.tsx` only.
- Icon imports: add `Video, Infinity, BarChart3, GraduationCap, KeyRound, Inbox, ShieldCheck` to the existing `lucide-react` import block (lines 16–44). All exist in `lucide-react`.
- No new components, no CSS, no routing changes, no schema changes.
- Card markup reused verbatim — same `cardBg`, `backdrop-blur`, hover translate/shadow, amber icon tint.
- Section background alternation preserved: visitor section uses `sectionTint2` + `border-t borderLight` so it visually alternates with the client section above (which uses `sectionTint`) and the pricing section below.

## Out of scope

- Pricing tier feature lists (`starterFeatures` / `proFeatures`) — left untouched per "do not change layout/styling" guidance. Can be revisited in a follow-up if you want these new capabilities reflected in the comparison table.
- Hero copy, problem section, footer.
