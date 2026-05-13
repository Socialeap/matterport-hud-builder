# Directory Service Filter — Essentials Filter, Preferables Rank

## Goal
In the MSP Directory service rail, change the behavior of the two preference levels:

- **Essential** — hard filter. Hide any MSP card that does not offer every Essential-marked service.
- **Preferable** — soft rank. Do not remove cards. MSPs that match more Preferable items rise to the top; those missing some still appear, just lower.

This keeps MSPs that satisfy the Essentials visible even when they don't have every Preferable item.

## Scope
Single file: `src/routes/agents.tsx`. No backend, schema, geocoding, or RPC changes — current `search_msp_directory` already returns the candidate set; this is purely a client-side filter/sort tweak on `results`.

## Changes

1. **Replace the `filtered` memo** (around lines 535–541) with a two-pass pipeline that uses both `essentialServices` and `preferableServices`:
   - Pass 1 — filter: keep only MSPs whose `specialties` include every entry in `essentialServices`. If `essentialServices` is empty, skip filtering.
   - Pass 2 — rank: compute a `preferableMatchCount` per MSP (count of `preferableServices` present in `m.specialties`). Sort descending by that count; ties preserve original order (stable sort via `Array.prototype.sort` on a mapped index, or `.map` + index tiebreak).
   - When `preferableServices` is empty, skip sorting and return the filtered list as-is.

2. **Tighten copy** in the two result headers (around lines 853–855 and the searched-results header near line 919) so the language matches the new behavior:
   - When only Preferables are selected: "ranked by your preferred services".
   - When Essentials are selected: keep "matching your service filters" / similar.
   - Optional: a small muted line under the list explaining the sort when Preferables are active.

3. **Optional UX polish (low risk):** on each `MSPCard`, when Preferables are selected, add a subtle chip like "Matches N of M preferred" — only if `MSPCard` already accepts a prop hook. If it doesn't, skip to keep scope tight; the user only asked for ordering behavior.

## Verification
- Essentials only: MSPs missing any Essential disappear; others retain original order.
- Preferables only: full result list shown; MSPs with most matches appear first.
- Both: Essentials filter first, then Preferables rank within the filtered set.
- None selected: identical to today's behavior.
- Reset clears both Maps as before.

## Risk Assessment
- `selectedSpecialties`, `essentialServices`, `preferableServices` memos already exist and are unchanged.
- `MSPCard` API untouched (unless we opt into the chip in step 3).
- No effect on geocoding, polygon match, or `search_msp_directory` SQL.
- Sort is pure and deterministic; no flicker because `filtered` is recomputed in the same memo.
