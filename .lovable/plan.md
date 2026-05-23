# Make Mattertag photo thumbnails appear

## Root cause

The preview renderer is already correct. `classifyMediaUrl()` matches `cdn-2.matterport.com/.../IMG_2956.jpg?t=…` (host matches `PHOTO_HOST=/matterport/i`, and `.jpg?` matches `IMG_EXT`), and `findImageUrlIn(description)` would also surface it. A thumbnail renders whenever the URL is anywhere in `tag.media` or `tag.description`.

The problem is upstream: that URL never reaches the saved data. Inspecting the most recent saved models in the database confirms it — every imported Mattertag has `"media": ""`, and no description contains a `cdn-2.matterport.com/attachments/…` URL. The mattertag the user has in the testing model that contains an inline image is stored on Matterport's side as a **photo attachment**, not as the GraphQL `media` field.

The current GraphQL query in `supabase/functions/fetch-mattertags/index.ts` only requests:

```graphql
mattertags(includeDisabled: false) {
  id label description media anchorPosition { x y z }
}
```

Matterport's `media` field is a legacy single-URL slot used mostly by tags with rich/embedded media (YouTube, custom URLs). Tags created in the modern editor with an uploaded image store that image in the separate `attachments` connection — exactly the `cdn-2.matterport.com/attachments/<asset>/IMG_2956.jpg?t=…` shape the user pasted. The current importer never asks for `attachments`, so the photo never lands in `tag.media` and the card has nothing to display.

## Fix

Expand the importer to request `attachments` and fold the first image attachment URL into `media` when the legacy `media` field is empty. This keeps the existing `MattertagData` wire shape (`id / label / description / media / anchorPosition`) intact — no client, runtime, draft-storage, or end-product changes required.

### 1. `supabase/functions/fetch-mattertags/index.ts`

- **Extend the GraphQL query** to request attachments:

  ```graphql
  mattertags(includeDisabled: false) {
    id
    label
    description
    media
    mediaType                # "photo" | "video" | "rich" | "" — used to bias selection
    attachments {            # modern uploaded media
      src
      type                   # "PHOTO" | "VIDEO" | "MODEL" | "PDF" | ...
    }
    anchorPosition { x y z }
  }
  ```

  If the field name turns out to be `model` or returns errors on this Matterport API version, fall back gracefully: a GraphQL error on `attachments` should not fail the whole import — log it and keep the legacy `media`-only path working.

- **Sanitization** (in `sanitizeMattertags`): after computing the legacy `media`, when `media` is empty, scan `attachments[]` for the first entry whose `type` is `PHOTO` (or whose `src` is an `https://` URL passing a simple image-host check covering `cdn-2.matterport.com`, `cdn.matterport.com`, and generic image extensions). Promote that `src` into `media`. Cap length at 2048 chars as today; drop non-https values.

  Keep the existing rule that `media` must be a real `https://` URL; never store relative paths.

- **No schema change** to the response: we still ship `{id, label, description, media, anchorPosition}` to the client. This means zero changes to `MattertagData`, draft storage, the saved-model JSON shape, the preview, or the generated end-product HTML.

### 2. No frontend changes

`HudPreview.tsx` already classifies `cdn-2.matterport.com/...jpg?t=...` as an image and renders a thumbnail when `tag.media` is set. The end-product runtime in `src/lib/portal.functions.ts` does the same. Once the importer fills `tag.media`, both surfaces light up automatically.

### 3. Validate

- Re-import Mattertags for the testing model. Confirm in the DB (or via the import modal preview) that the photo-tag's `media` now starts with `https://cdn-2.matterport.com/attachments/…`.
- Reload the property and confirm the Mattertag card shows the thumbnail and that clicking it opens the in-app media carousel (the existing playable-media gate handles this).
- Confirm social-only tags (Facebook/Instagram link tags) are unchanged: still no thumbnail, still no Open Media button, still get the link-icon chips.

## Technical notes

- The Matterport public/anonymous GraphQL endpoint exposes `Mattertag.attachments` on most modern models; the older `mediaType` "photo" tags with the inline image use it. If a particular model returns `null`/empty attachments, the function silently falls back to today's behavior (no regression).
- Edge function changes deploy automatically; no `supabase/config.toml` edits needed.
- No migration, no env vars, no UI changes, no end-product HTML changes.
