import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Coffee, BedDouble, PartyPopper, Palette, Flower2, Store,
  MapPin, X, ArrowRight, Compass, Play, Sparkles, Eye, MessageSquareText, ExternalLink, MapPinned,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { listActiveAtlasDemoListings } from "@/lib/atlas-demo.functions";
import { categoryLabel, type AtlasDemoListing, type AtlasCategory } from "@/lib/atlas-demo-data";

export const Route = createFileRoute("/atlas")({
  head: () => ({
    meta: [
      { title: "Frontiers3D Atlas — Explore real places before you visit" },
      {
        name: "description",
        content:
          "A public immersive discovery layer. See how venues, stays, studios, and spaces can be explored online before the visit — sample Atlas listings from Frontiers3D.",
      },
      { property: "og:title", content: "Frontiers3D Atlas — Step inside real places from the map" },
      {
        property: "og:description",
        content: "Turn a 3D presentation into a public discovery listing. Explore the sample Atlas experience.",
      },
    ],
  }),
  loader: async () => await listActiveAtlasDemoListings(),
  component: AtlasDemoPage,
});

// Category → presentation (icon + accent + soft gradient placeholder).
const CATEGORY_UI: Record<AtlasCategory, { icon: LucideIcon; accent: string; tint: string }> = {
  cafe:        { icon: Coffee,      accent: "#b45309", tint: "from-amber-200/70 to-orange-100" },
  restaurant:  { icon: Coffee,      accent: "#9a3412", tint: "from-orange-200/70 to-rose-100" },
  hotel:       { icon: BedDouble,   accent: "#0e7490", tint: "from-cyan-200/70 to-sky-100" },
  event_space: { icon: PartyPopper, accent: "#7c3aed", tint: "from-violet-200/70 to-fuchsia-100" },
  gallery:     { icon: Palette,     accent: "#be185d", tint: "from-pink-200/70 to-rose-100" },
  wellness:    { icon: Flower2,     accent: "#15803d", tint: "from-emerald-200/70 to-teal-100" },
  retail:      { icon: Store,       accent: "#4f46e5", tint: "from-indigo-200/70 to-blue-100" },
  other:       { icon: MapPinned,   accent: "#4f46e5", tint: "from-slate-200/70 to-slate-100" },
};
const uiFor = (category: string) => CATEGORY_UI[category as AtlasCategory] ?? CATEGORY_UI.other;

function AtlasDemoPage() {
  const { listings } = Route.useLoaderData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [active, setActive] = useState<AtlasDemoListing | null>(null);

  // Esc closes the viewer (effect runs client-side only — SSR-safe).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setActive(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  // Pins only for listings that have coordinates.
  const pinned = useMemo(
    () => listings.filter((l) => l.latitude != null && l.longitude != null),
    [listings],
  );
  const bounds = useMemo(() => {
    if (pinned.length === 0) return null;
    const lats = pinned.map((l) => l.latitude as number);
    const lngs = pinned.map((l) => l.longitude as number);
    return {
      minLat: Math.min(...lats), maxLat: Math.max(...lats),
      minLng: Math.min(...lngs), maxLng: Math.max(...lngs),
    };
  }, [pinned]);
  const project = (l: AtlasDemoListing) => {
    if (!bounds) return { left: "50%", top: "50%" };
    const px = ((l.longitude as number) - bounds.minLng) / ((bounds.maxLng - bounds.minLng) || 1);
    const py = ((l.latitude as number) - bounds.minLat) / ((bounds.maxLat - bounds.minLat) || 1);
    return { left: `${10 + px * 80}%`, top: `${10 + (1 - py) * 80}%` };
  };

  const selectEntry = (id: string) => {
    setSelectedId(id);
    if (typeof document !== "undefined") {
      document.getElementById(`atlas-card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-sm font-extrabold tracking-[0.2em] text-foreground">FRONTIERS3D</span>
            <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white">ATLAS</span>
          </Link>
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
            <Sparkles className="size-3" /> Sample experience
          </span>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pt-10 pb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">The immersive discovery layer</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-bold leading-tight sm:text-4xl">
          Explore real places before you ever arrive
        </h1>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground">
          Frontiers3D Atlas turns a 3D presentation into a public discovery listing — so guests, buyers, renters,
          and customers can step inside a space online before they visit, book, or inquire.
        </p>
        <div className="mt-5 flex flex-wrap gap-2.5">
          {[
            { icon: Eye, label: "See the layout & atmosphere" },
            { icon: Compass, label: "Answer “is this the right place?” early" },
            { icon: MessageSquareText, label: "Fewer repetitive questions" },
          ].map(({ icon: Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground">
              <Icon className="size-4 text-indigo-600" /> {label}
            </span>
          ))}
        </div>
      </section>

      {listings.length === 0 ? (
        <section className="mx-auto max-w-6xl px-4 pb-16">
          <div className="rounded-xl border border-border bg-card px-6 py-16 text-center">
            <MapPinned className="mx-auto mb-3 size-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Sample listings are on the way</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              The Frontiers3D Atlas demo is being curated. Check back shortly to step inside sample spaces.
            </p>
          </div>
        </section>
      ) : (
        <section className="mx-auto max-w-6xl px-4 pb-12">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Discover spaces on the map</h2>
            <span className="text-sm text-muted-foreground">{listings.length} sample {listings.length === 1 ? "listing" : "listings"}</span>
          </div>

          <div className="flex flex-col-reverse gap-6 lg:grid lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
            {/* List */}
            <div className="space-y-4">
              {listings.map((l) => {
                const ui = uiFor(l.category);
                const Icon = ui.icon;
                const selected = selectedId === l.id;
                const loc = [l.city, l.region].filter(Boolean).join(", ");
                return (
                  <article
                    key={l.id}
                    id={`atlas-card-${l.id}`}
                    onMouseEnter={() => setSelectedId(l.id)}
                    className={`overflow-hidden rounded-xl border bg-card transition-shadow ${
                      selected ? "border-indigo-400 shadow-md" : "border-border"
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row">
                      {l.hero_image_url ? (
                        <img
                          src={l.hero_image_url}
                          alt={`${l.title} (sample listing)`}
                          className="h-32 w-full object-cover sm:h-auto sm:w-40"
                          loading="lazy"
                        />
                      ) : (
                        <div className={`relative flex h-32 w-full items-center justify-center bg-gradient-to-br sm:h-auto sm:w-40 ${ui.tint}`}>
                          <Icon className="size-9" style={{ color: ui.accent }} />
                          <span className="absolute bottom-1.5 left-1.5 rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                            Sample listing
                          </span>
                        </div>
                      )}
                      <div className="flex flex-1 flex-col p-4">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-white" style={{ backgroundColor: ui.accent }}>
                            {categoryLabel(l.category)}
                          </span>
                          {loc && (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <MapPin className="size-3.5" /> {loc}
                            </span>
                          )}
                        </div>
                        <h3 className="mt-1.5 text-base font-semibold">{l.title}</h3>
                        {l.summary && <p className="mt-1 text-sm text-muted-foreground">{l.summary}</p>}
                        {l.tags && l.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {l.tags.slice(0, 4).map((t) => (
                              <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">#{t}</span>
                            ))}
                          </div>
                        )}
                        <div className="mt-3 flex items-center justify-end">
                          {l.presentation_url ? (
                            <button
                              onClick={() => setActive(l)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
                            >
                              <Play className="size-3.5" /> Step Inside
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Presentation coming soon</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Map-like discovery panel */}
            <div className="lg:sticky lg:top-20">
              <div
                className="relative h-72 overflow-hidden rounded-xl border border-border bg-[#0b1020] lg:h-[520px]"
                style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.10) 1px, transparent 1px)", backgroundSize: "22px 22px" }}
                aria-label="Sample discovery map"
              >
                <div className="pointer-events-none absolute -left-10 top-10 h-40 w-56 rounded-full bg-indigo-500/10 blur-2xl" />
                <div className="pointer-events-none absolute right-0 bottom-6 h-44 w-60 rounded-full bg-cyan-500/10 blur-2xl" />
                <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-[11px] font-medium text-white/80">
                  <Compass className="size-3.5" /> Sample discovery map
                </span>

                {pinned.map((l) => {
                  const ui = uiFor(l.category);
                  const pos = project(l);
                  const selected = selectedId === l.id;
                  return (
                    <button
                      key={l.id}
                      onClick={() => selectEntry(l.id)}
                      onMouseEnter={() => setSelectedId(l.id)}
                      style={{ left: pos.left, top: pos.top }}
                      className="group absolute -translate-x-1/2 -translate-y-1/2"
                      aria-label={`${l.title}${l.city ? ` — ${l.city}` : ""}`}
                    >
                      <span
                        className={`block rounded-full ring-2 ring-white/80 transition-all ${selected ? "size-4" : "size-3"}`}
                        style={{ backgroundColor: ui.accent }}
                      />
                      <span className={`pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 whitespace-nowrap rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 shadow transition-opacity ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                        {l.title}
                      </span>
                    </button>
                  );
                })}

                {pinned.length === 0 && (
                  <span className="absolute inset-0 flex items-center justify-center text-xs text-white/50">
                    Listings without coordinates won’t appear on the map.
                  </span>
                )}
                <span className="absolute bottom-3 right-3 rounded bg-white/10 px-2 py-1 text-[10px] text-white/60">
                  Pins are sample locations
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Tap a pin to highlight its listing. A live Atlas adds filters for category, location, amenities, and more.
              </p>
            </div>
          </div>

          {/* Truthful framing */}
          <p className="mt-8 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <strong className="text-foreground">About this demo:</strong> these are Frontiers3D sample Atlas listings that
            show how spaces appear in the discovery layer. They’re for demonstration — not specific businesses’ tours, and
            not a preview built for any one business.
          </p>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t border-border bg-[#070b1f] px-4 py-10 text-white/70">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-extrabold tracking-[0.2em] text-white">FRONTIERS3D</span>
            <Link to="/" className="text-sm text-white/70 hover:text-white">Back to frontiers3d.com →</Link>
          </div>
          <p className="mt-4 text-xs text-white/50">
            © {new Date().getFullYear()} Transcendence Media · Frontiers3D Atlas. Sample listings shown for
            demonstration. Turn your immersive presentation into a discoverable public listing.
          </p>
        </div>
      </footer>

      {/* Presentation viewer (opens the listing's hosted URL; fully unmounts on close) */}
      {active && active.presentation_url && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-4" role="dialog" aria-modal="true">
          <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">SAMPLE</span>
                <span className="truncate text-sm font-semibold">{active.title} — immersive presentation</span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href={active.presentation_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                >
                  Open in new tab <ExternalLink className="size-3.5" />
                </a>
                <button onClick={() => setActive(null)} aria-label="Close" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <X className="size-5" />
                </button>
              </div>
            </div>

            {/* Admin-curated, Frontiers3D-owned presentation URL. */}
            <div className="relative aspect-video w-full bg-black">
              <iframe
                key={active.id}
                src={active.presentation_url}
                title={`${active.title} — sample immersive presentation`}
                className="absolute inset-0 h-full w-full"
                loading="lazy"
                allow="accelerometer; autoplay; fullscreen; gyroscope; xr-spatial-tracking"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3.5" />
                {[active.city, active.region].filter(Boolean).join(", ") || "Sample location"} · {categoryLabel(active.category)}
              </span>
              <span className="text-[11px] text-muted-foreground">
                Sample Frontiers3D Atlas listing — not a specific business’s tour.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
