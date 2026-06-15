# Public Experience, Operations, And Roadmap Memory

## Public Marketing And PWA
- One coherent ecosystem: discover -> provider -> builder -> publishing -> Atlas.
- Audience-specific pages use truthful, currently available CTAs.
- PWA, fullscreen, sharing, and mobile navigation remain usable.
- No unsupported ROI guarantees, internal track names, or unavailable-feature claims.

## Admin And Operations
- Admin routes use existing role and server authorization.
- Every operation exposes loading, success, empty, failure, audit, and retry states as relevant.
- Verify before active/public/published/queued/sent transitions.
- Routine workflows should not depend on one-off scripts once considered complete.

## TrueSpace
- Approved planned E57-to-Gaussian-Splat track for providers first.
- Requires resumable storage, job queues, scalable GPU workers, validation, compression, viewer delivery, metering, billing, retention, and failure recovery.
- Supabase Edge Functions orchestrate but do not perform heavy compute.
- A personal Mac Mini may support a spike, not production-scale dependence.
- First milestone: measured Matterport sample-E57 conversion quality, duration, storage, GPU cost, and web delivery.

