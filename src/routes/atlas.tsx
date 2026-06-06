import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  MapPin,
  MapPinOff,
  Compass,
  ExternalLink,
  X,
  ShieldCheck,
  Sparkles,
  Star,
  Box,
  Play,
  SlidersHorizontal,
  LocateFixed,
  House,
  List,
  Map as MapIcon,
  Layers,
  Building2,
  Hotel,
  UtensilsCrossed,
  Landmark,
  ShoppingBag,
  Flower2,
  PartyPopper,
  Image as ImageIcon,
  Tag,
  Share2,
  Maximize2,
  Minimize2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { listActiveAtlasEntries } from "@/lib/atlas.functions";
import { categoryLabel, MAX_MAP_TAGS, type AtlasEntry } from "@/lib/atlas-demo-data";
import { buildAtlasSpotUrl } from "@/lib/public-url";
import { useFullscreen } from "@/hooks/use-fullscreen";

/** Lucide icon per known category (text-light scanning). Falls back to a tag. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  residential: House,
  commercial: Building2,
  hospitality: Hotel,
  hotel: Hotel,
  cultural: Landmark,
  gallery: ImageIcon,
  restaurant: UtensilsCrossed,
  event_space: PartyPopper,
  wellness: Flower2,
  retail: ShoppingBag,
  other: Tag,
};

/** Default hero image per category — used when an entry has no
 *  `hero_image_url` (or its URL fails to load). Files live in `/public`;
 *  filenames preserve exact casing/spaces and are URL-encoded at use sites. */
const CATEGORY_IMAGES: Record<string, string> = {
  residential: "/residential.jpg",
  commercial: "/Office.jpg",
  hospitality: "/Hotel.jpg",
  hotel: "/Hotel.jpg",
  cultural: "/Museum.jpg",
  gallery: "/Gallery.jpg",
  restaurant: "/Restaurant.jpg",
  event_space: "/Event Space.jpg",
  wellness: "/Spa.jpg",
  retail: "/Retail.jpg",
  other: "/Other.jpg",
};

function getCategoryImageUrl(category: string): string {
  return CATEGORY_IMAGES[category] ?? CATEGORY_IMAGES.other;
}

function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = CATEGORY_ICONS[category] ?? Tag;
  return <Icon className={className} aria-hidden="true" />;
}

export const Route = createFileRoute("/atlas")({
  head: () => ({
    meta: [
      { title: "Frontiers|3D Atlas — Step inside real places from the map" },
      {
        name: "description",
        content:
          "Frontiers|3D Atlas is a discovery layer for immersive 3D spaces. Explore verified sample listings and step inside before you visit, book, or inquire.",
      },
      { property: "og:title", content: "Frontiers|3D Atlas — Immersive discovery layer" },
      {
        property: "og:description",
        content: "Discover verified immersive 3D spaces on a dark interactive map.",
      },
      { property: "og:url", content: "https://www.frontiers3d.com/atlas" },
    ],
    links: [{ rel: "canonical", href: "https://www.frontiers3d.com/atlas" }],
  }),

  validateSearch: (search: Record<string, unknown>) => ({
    spot: typeof search.spot === "string" && search.spot.length > 0
      ? search.spot
      : undefined,
  }),
  loader: async () => await listActiveAtlasEntries(),
  component: AtlasPage,
});

type LeafletNs = typeof import("leaflet");

interface MapRefs {
  L: LeafletNs;
  map: import("leaflet").Map;
  layer: import("leaflet").LayerGroup;
  markers: Map<string, import("leaflet").Marker>;
}

// ── Rich hover tooltip (raw HTML through Leaflet's native bindTooltip) ──────
// The card is plain HTML + CSS (see `.atlas-tip*` in styles.css) so mousemove
// never touches React. All user-supplied strings are escaped before injection.

/** Pins whose screen centers are closer than this overlap — suppress hover card.
 *  Same 30px threshold as the original text-tooltip overlap formula. */
const PIN_OVERLAP_PX = 30;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** https-only URL made safe inside `url('…')` in an injected style attribute. */
function cssSafeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!/^https:\/\/[^\s<>"']+$/i.test(trimmed)) return null;
  return trimmed.replace(/['"()\\]/g, (c) => encodeURIComponent(c));
}

/**
 * 220×120 image-backed hover card. The hero renders as a CSS background under
 * a dark overlay gradient; if the image URL is missing/invalid (or fails to
 * load — CSS multi-backgrounds degrade silently), the dark-slate fallback
 * gradient + background-color shows instead.
 */
function buildTooltipHtml(entry: AtlasEntry): string {
  const img =
    (entry.hero_image_url ? cssSafeUrl(entry.hero_image_url) : null) ??
    encodeURI(getCategoryImageUrl(entry.category));
  const style =
    ` style="background-image:linear-gradient(to top, rgba(15,23,42,0.95) 0%, rgba(15,23,42,0.1) 100%),url('${img}')"`;
  const tags = (entry.tags ?? [])
    .slice(0, MAX_MAP_TAGS)
    .map((t) => `<span class="atlas-tip-tag">${escapeHtml(t)}</span>`)
    .join("");
  return (
    `<div class="atlas-tip${img ? "" : " atlas-tip--noimg"}"${style}>` +
    (tags ? `<div class="atlas-tip-tags">${tags}</div>` : "") +
    `<div class="atlas-tip-text">` +
    `<p class="atlas-tip-cat">${escapeHtml(categoryLabel(entry.category))}</p>` +
    `<h4 class="atlas-tip-title">${escapeHtml(entry.title)}</h4>` +
    `</div></div>`
  );
}

/** Pixel-distance overlap check: true when another pin sits within PIN_OVERLAP_PX on screen. */
function isMarkerOverlapped(refs: MapRefs, id: string): boolean {
  const marker = refs.markers.get(id);
  if (!marker) return false;
  const p = refs.map.latLngToContainerPoint(marker.getLatLng());
  for (const [otherId, other] of refs.markers) {
    if (otherId === id) continue;
    const q = refs.map.latLngToContainerPoint(other.getLatLng());
    if (p.distanceTo(q) < PIN_OVERLAP_PX) return true;
  }
  return false;
}

function AtlasPage() {
  const { entries } = Route.useLoaderData() as {
    entries: AtlasEntry[];
    error: string | null;
  };
  const { spot } = Route.useSearch();
  const navigate = useNavigate({ from: "/atlas" });

  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [active, setActiveState] = useState<AtlasEntry | null>(null);
  // Business card shown over the map when a pin is clicked (replaces the old
  // Leaflet mini-popup). Cleared by its close button or a background map click.
  const [preview, setPreview] = useState<AtlasEntry | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Open/close the immersive modal AND keep `?spot=<id>` in the URL in sync,
  // so the modal state is shareable as a deep link.
  const setActive = useCallback(
    (entry: AtlasEntry | null) => {
      setActiveState(entry);
      if (entry) {
        navigate({ search: { spot: entry.id }, replace: false });
      } else {
        navigate({ search: {}, replace: true });
      }
    },
    [navigate],
  );

  // Auto-open from a shared /atlas?spot=<id> URL. Guarded by a ref so the
  // modal isn't re-opened after the user manually closes it.
  const autoOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!spot || autoOpenedRef.current === spot) return;
    const match = entries.find((e) => e.id === spot);
    if (!match || !match.presentation_url) return;
    autoOpenedRef.current = spot;
    setActiveState(match);
    setSelectedId(match.id);
  }, [spot, entries]);


  // Lazy-load card backgrounds in batches of 10 as user scrolls the list.
  const LAZY_BATCH = 10;
  const [visibleCount, setVisibleCount] = useState(LAZY_BATCH);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Category chips built from the union of active-listing categories.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(e.category);
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (activeCategory !== "all" && e.category !== activeCategory) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        (e.city ?? "").toLowerCase().includes(q) ||
        (e.region ?? "").toLowerCase().includes(q)
      );
    });
  }, [entries, query, activeCategory]);

  const pinned = useMemo(
    () => filtered.filter((e) => e.latitude != null && e.longitude != null),
    [filtered],
  );

  // Reset lazy batch when the filtered list identity changes (search/category).
  useEffect(() => {
    setVisibleCount(LAZY_BATCH);
  }, [filtered]);

  // Sentinel-based IntersectionObserver: bump visibleCount by LAZY_BATCH when
  // the sentinel scrolls into view, until we've revealed every filtered card.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    if (visibleCount >= filtered.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((c) => Math.min(filtered.length, c + LAZY_BATCH));
        }
      },
      { root: node.parentElement, rootMargin: "200px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [filtered.length, visibleCount]);

  // ── Leaflet (client-only) ───────────────────────────────────────────────
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const refsRef = useRef<MapRefs | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined" || !mapElRef.current) return;
      const L = (await import("leaflet")) as unknown as LeafletNs;
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !mapElRef.current) return;
      const map = L.map(mapElRef.current, {
        center: [39.5, -98.35],
        zoom: 4,
        zoomControl: false,
        attributionControl: false,
        worldCopyJump: true,
      });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
      }).addTo(map);
      L.control.zoom({ position: "topright" }).addTo(map);
      // Clicking the empty map (not a pin) dismisses the floating card.
      map.on("click", () => setPreview(null));
      const layer = L.layerGroup().addTo(map);
      refsRef.current = { L, map, layer, markers: new Map() };
      setMapReady(true);
    })();
    return () => {
      cancelled = true;
      refsRef.current?.map.remove();
      refsRef.current = null;
    };
  }, []);

  // Sync markers with filtered listings.
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs || !mapReady) return;
    const { L, layer, markers } = refs;
    layer.clearLayers();
    markers.clear();

    pinned.forEach((entry) => {
      const icon = L.divIcon({
        className: "atlas-pin-wrapper",
        html: `<div class="atlas-pulse-pin"><span class="atlas-pulse-pin-dot"></span></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      const marker = L.marker([entry.latitude as number, entry.longitude as number], { icon });
      // Hover → rich image-backed card via Leaflet's native tooltip (no React
      // on mousemove). Gated: when another pin overlaps this one on screen
      // (pixel-distance check), the tooltip is suppressed to avoid stacking.
      marker.bindTooltip(buildTooltipHtml(entry), {
        direction: "top",
        offset: L.point(0, -16),
        opacity: 1,
        className: "atlas-tip-wrap",
      });
      marker.on("tooltipopen", () => {
        if (isMarkerOverlapped(refs, entry.id)) marker.closeTooltip();
      });
      // Clicking a pin surfaces the full business card (not a mini popup):
      // select it, show the floating card over the map, and bring the matching
      // sidebar card into view.
      marker.on("click", () => {
        marker.closeTooltip();
        setSelectedId(entry.id);
        setPreview(entry);
        if (typeof document !== "undefined") {
          document
            .getElementById(`atlas-card-${entry.id}`)
            ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
      marker.addTo(layer);
      markers.set(entry.id, marker);
    });

    // Fit bounds if we have pins.
    if (pinned.length > 0) {
      const bounds = L.latLngBounds(
        pinned.map((e) => [e.latitude as number, e.longitude as number]),
      );
      refs.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    }
  }, [pinned, mapReady]);

  // Highlight selected marker.
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs) return;
    refs.markers.forEach((m, id) => {
      const el = m.getElement();
      if (!el) return;
      el.classList.toggle("is-selected", id === selectedId);
    });
  }, [selectedId, pinned]);

  // Card click: pan to marker + open the in-page 3D presentation modal.
  const focusEntry = (entry: AtlasEntry) => {
    setSelectedId(entry.id);
    const refs = refsRef.current;
    if (refs && entry.latitude != null && entry.longitude != null) {
      refs.map.flyTo([entry.latitude, entry.longitude], 13, { duration: 1.2 });
    }
    if (entry.presentation_url) setActive(entry);
  };

  // Map control: pan to the visitor's location.
  const handleNearMe = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Location isn't available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        refsRef.current?.map.flyTo(
          [pos.coords.latitude, pos.coords.longitude],
          11,
          { duration: 1.2 },
        );
      },
      () =>
        toast.error(
          "Couldn't get your location. Check your browser's location permission.",
        ),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  };

  // Map control: re-frame all pins (or recenter when none are mapped).
  const resetView = () => {
    const refs = refsRef.current;
    if (!refs) return;
    if (pinned.length > 0) {
      const bounds = refs.L.latLngBounds(
        pinned.map((e) => [e.latitude as number, e.longitude as number]),
      );
      refs.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    } else {
      refs.map.setView([39.5, -98.35], 4);
    }
  };

  // Esc closes modal.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setActive(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const { isFullscreen, isEnabled: fsEnabled, toggle: toggleFullscreen } = useFullscreen(shellRef);

  return (
    <div className="atlas-shell" ref={shellRef}>
      {/* Header */}
      <header className="atlas-header">
        <Link to="/" className="atlas-brand">
          <span className="atlas-brand-logo">
            <Box className="size-4" />
          </span>
          <div className="atlas-brand-text">
            <h1>
              Frontiers|3D Atlas
              <br />
              <span className="atlas-brand-pill">DISCOVERY MAP</span>
            </h1>
            <p>Immersive 3D spaces, mapped.</p>
          </div>
        </Link>
        <nav className="hidden items-center gap-4 sm:flex">
          <Link to="/agents" className="text-[13px] text-slate-400 transition-colors hover:text-white">For Agents</Link>
          <Link to="/businesses" className="text-[13px] text-slate-400 transition-colors hover:text-white">For Businesses</Link>
        </nav>
        <div className="atlas-header-right">
          <div className="atlas-header-meta">
            <div>
              <p className="atlas-header-kicker">Listings</p>
              <p className="atlas-header-value">
                <span className="atlas-pulse-dot" />
                {entries.length} live now
              </p>
            </div>
            <span className="atlas-header-divider" />
            <div>
              <p className="atlas-header-kicker">Ecosystem</p>
              <p className="atlas-header-value-muted">Hosts → Spaces → Guests</p>
            </div>
          </div>
          {fsEnabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="atlas-fullscreen-btn"
                  aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                  aria-pressed={isFullscreen}
                >
                  {isFullscreen ? <Minimize2 className="size-[18px]" /> : <Maximize2 className="size-[18px]" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="atlas-body">
        {/* Sidebar (drawer on mobile) */}
        <aside className={`atlas-sidebar ${sidebarOpen ? "is-open" : ""}`}>
          <div className="atlas-sidebar-controls">
            <div className="atlas-search">
              <Search className="atlas-search-icon" />
              <input
                type="search"
                placeholder="Search verified 3D spaces…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search listings"
              />
            </div>
            <div className="atlas-chips-head">
              <SlidersHorizontal aria-hidden="true" />
              <span>Filter by type</span>
            </div>
            <div className="atlas-chips" role="group" aria-label="Filter listings by category">
              <button
                type="button"
                onClick={() => setActiveCategory("all")}
                aria-pressed={activeCategory === "all"}
                className={`atlas-chip ${activeCategory === "all" ? "is-active" : ""}`}
              >
                <Layers aria-hidden="true" /> All listings
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setActiveCategory(c)}
                  aria-pressed={activeCategory === c}
                  className={`atlas-chip ${activeCategory === c ? "is-active" : ""}`}
                >
                  <CategoryIcon category={c} /> {categoryLabel(c)}
                </button>
              ))}
            </div>
          </div>

          <div className="atlas-list" role="list">
            {entries.length === 0 ? (
              <EmptyState />
            ) : filtered.length === 0 ? (
              <div className="atlas-empty-mini">
                No listings match your filters.
              </div>
            ) : (
              <>
                {filtered.map((entry, i) => (
                  <ListingCard
                    key={entry.id}
                    entry={entry}
                    selected={selectedId === entry.id}
                    shouldLoad={i < visibleCount}
                    onHover={() => setSelectedId(entry.id)}
                    onFocus={() => focusEntry(entry)}
                    onOpen={() => entry.presentation_url && setActive(entry)}
                  />
                ))}
                {visibleCount < filtered.length && (
                  <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
                )}
              </>
            )}
          </div>

          <div className="atlas-sidebar-footer">
            <ShieldCheck className="size-4 shrink-0" />
            <p>
              Active approved listings appear in Atlas. Inactive listings remain
              hidden until restored by an admin.
            </p>
          </div>
        </aside>

        {/* Map */}
        <main className="atlas-map-pane">
          <div ref={mapElRef} className="atlas-map" />

          {/* Icon-only map controls — labelled + tooltipped for a11y. */}
          <TooltipProvider delayDuration={300}>
            <div className="atlas-map-controls">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="atlas-map-ctrl"
                    onClick={handleNearMe}
                    aria-label="Find listings near me"
                  >
                    <LocateFixed aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">Near me</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="atlas-map-ctrl"
                    onClick={resetView}
                    aria-label="Reset map view"
                  >
                    <House aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">Reset view</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>

          <button
            type="button"
            className="atlas-mobile-toggle"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={sidebarOpen ? "Hide listings, show map" : "Show listings"}
            title={sidebarOpen ? "Map" : "Listings"}
          >
            {sidebarOpen ? (
              <MapIcon className="size-4" aria-hidden="true" />
            ) : (
              <List className="size-4" aria-hidden="true" />
            )}
            {sidebarOpen ? "Map" : "Listings"}
          </button>
          <span className="atlas-map-badge">
            <Compass className="size-3.5" aria-hidden="true" />
            Sample discovery map
          </span>

          {/* Pin click → progressive disclosure: the hover card expands into
              this image-backed detail card over the map (with Step Inside). */}
          {preview && (
            <div className="atlas-map-preview">
              <button
                type="button"
                className="atlas-map-preview-close"
                onClick={() => setPreview(null)}
                aria-label="Close card"
                title="Close"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
              <ExpandedSpaceCard
                entry={preview}
                onStepInside={() => preview.presentation_url && setActive(preview)}
              />
            </div>
          )}
        </main>
      </div>

      {active && active.presentation_url && (
        <PresentationModal entry={active} onClose={() => setActive(null)} />
      )}
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

/**
 * Expanded map card shown when a pin is clicked — the progressive-disclosure
 * step up from the hover tooltip. Retains the hero header + frosted tags and
 * adds the full summary plus a prominent Step Inside CTA. A failed hero image
 * silently falls back to the dark-slate gradient (the gradient underlay is
 * always painted; `onError` just unmounts the broken <img>).
 */
function ExpandedSpaceCard({
  entry,
  onStepInside,
}: {
  entry: AtlasEntry;
  onStepInside: () => void;
}) {
  const [heroFailed, setHeroFailed] = useState(false);
  const [catFailed, setCatFailed] = useState(false);
  // Give the next pin's image a fresh chance after a previous one failed.
  useEffect(() => {
    setHeroFailed(false);
    setCatFailed(false);
  }, [entry.id]);

  const heroSrc = entry.hero_image_url && !heroFailed ? entry.hero_image_url : null;
  const catSrc = !catFailed ? getCategoryImageUrl(entry.category) : null;
  const src = heroSrc ?? catSrc;
  const tags = (entry.tags ?? []).slice(0, MAX_MAP_TAGS);
  const loc = [entry.city, entry.region].filter(Boolean).join(", ");

  return (
    <article
      className="overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900 shadow-2xl"
      aria-label={`${entry.title} details`}
    >
      {/* Hero header — image under a dark overlay, gradient fallback beneath. */}
      <div className="relative h-36 w-full bg-gradient-to-br from-slate-700 via-slate-800 to-slate-950">
        {src && (
          <img
            src={src}
            alt=""
            loading="lazy"
            onError={() =>
              src === entry.hero_image_url ? setHeroFailed(true) : setCatFailed(true)
            }
            className="absolute inset-0 size-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/95 to-slate-900/10" />
        {tags.length > 0 && (
          <div className="absolute left-2.5 top-2.5 flex flex-wrap gap-1">
            {tags.map((t) => (
              <span
                key={t}
                className="rounded-full border border-white/20 bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-slate-50 backdrop-blur-sm"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/15 px-2 py-0.5 text-[10px] font-semibold backdrop-blur-sm">
          {entry.kind === "demo" ? (
            <>
              <Sparkles className="size-3 text-amber-300" aria-hidden="true" />
              <span className="text-amber-200">Sample</span>
            </>
          ) : entry.kind === "curated_showcase" ? (
            <>
              <Star className="size-3 text-indigo-300" aria-hidden="true" />
              <span className="text-indigo-200">Curated</span>
            </>
          ) : (
            <>
              <ShieldCheck className="size-3 text-emerald-300" aria-hidden="true" />
              <span className="text-emerald-200">Verified</span>
            </>
          )}
        </span>
        <div className="absolute inset-x-3 bottom-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
            {categoryLabel(entry.category)}
          </p>
          <h3 className="text-base font-semibold leading-tight text-white">
            {entry.title}
          </h3>
        </div>
      </div>

      {/* Body — full summary + prominent CTA. */}
      <div className="space-y-3 p-3.5">
        {loc && (
          <p className="flex items-center gap-1 text-xs text-slate-400">
            <MapPin className="size-3.5" aria-hidden="true" /> {loc}
          </p>
        )}
        {entry.summary && (
          <p className="max-h-40 overflow-y-auto text-xs leading-relaxed text-slate-300">
            {entry.summary}
          </p>
        )}
        {entry.presentation_url ? (
          <button
            type="button"
            onClick={onStepInside}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-500"
            aria-label={`Step inside ${entry.title}`}
          >
            <Play className="size-4" aria-hidden="true" /> Step Inside
          </button>
        ) : (
          <p className="text-center text-[11px] text-slate-500">
            Presentation coming soon
          </p>
        )}
      </div>
    </article>
  );
}

function ListingCard({
  entry,
  selected,
  shouldLoad,
  onHover,
  onFocus,
  onOpen,
}: {
  entry: AtlasEntry;
  selected: boolean;
  shouldLoad: boolean;
  onHover: () => void;
  onFocus: () => void;
  onOpen: () => void;
}) {
  const loc = [entry.city, entry.region].filter(Boolean).join(", ");
  const hasCoords = entry.latitude != null && entry.longitude != null;
  const [heroFailed, setHeroFailed] = useState(false);
  const [catFailed, setCatFailed] = useState(false);

  const heroSrc =
    entry.hero_image_url && !heroFailed ? entry.hero_image_url : null;
  const catSrc = !catFailed ? getCategoryImageUrl(entry.category) : null;
  const bgUrl = heroSrc ?? (catSrc ? encodeURI(catSrc) : null);
  const showBg = shouldLoad && !!bgUrl;

  return (
    <article
      role="listitem"
      id={`atlas-card-${entry.id}`}
      onMouseEnter={onHover}
      onClick={onFocus}
      className={`atlas-card ${selected ? "is-selected" : ""} ${showBg ? "has-bg" : ""}`}
    >
      {showBg && (
        <>
          <div
            className="atlas-card-bg"
            style={{ backgroundImage: `url("${bgUrl}")` }}
            aria-hidden="true"
          />
          <div className="atlas-card-tint" aria-hidden="true" />
          <img
            src={bgUrl ?? ""}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            onError={() => {
              if (heroSrc) setHeroFailed(true);
              else setCatFailed(true);
            }}
            style={{ display: "none" }}
          />
        </>
      )}
      <div className="atlas-card-inner">
        <div className="atlas-card-row">
          <span className="atlas-card-cat">{categoryLabel(entry.category)}</span>
          {entry.kind === "demo" ? (
            <span className="atlas-card-kind atlas-card-kind--sample">
              <Sparkles className="size-3" /> Sample
            </span>
          ) : entry.kind === "curated_showcase" ? (
            <span className="atlas-card-kind atlas-card-kind--curated">
              <Star className="size-3" /> Curated
            </span>
          ) : (
            <span className="atlas-card-kind atlas-card-kind--verified">
              <ShieldCheck className="size-3" /> Verified
            </span>
          )}
        </div>
        <h3 className="atlas-card-title">{entry.title}</h3>
        {loc ? (
          <p className="atlas-card-loc">
            <MapPin className="size-3.5" aria-hidden="true" /> {loc}
          </p>
        ) : (
          <p className="atlas-card-loc atlas-card-loc--pending">
            <MapPinOff className="size-3.5" aria-hidden="true" /> Location pending
          </p>
        )}
        {entry.summary && <p className="atlas-card-summary">{entry.summary}</p>}
        <div className="atlas-card-footer">
          {hasCoords ? (
            <span className="atlas-card-meta">On the map</span>
          ) : (
            <span className="atlas-card-meta atlas-card-meta--muted">List only</span>
          )}
          {entry.presentation_url ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
              className="atlas-card-cta"
              aria-label={`Step inside ${entry.title}`}
            >
              <Play className="size-3.5" aria-hidden="true" /> Step Inside
            </button>
          ) : (
            <span className="atlas-card-meta atlas-card-meta--muted">
              Presentation coming soon
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function EmptyState() {
  return (
    <div className="atlas-empty">
      <Compass className="atlas-empty-icon" />
      <h2>Sample listings are on the way</h2>
      <p>
        The Frontiers|3D Atlas demo is being curated. Check back shortly to step
        inside sample spaces.
      </p>
    </div>
  );
}

function PresentationModal({ entry, onClose }: { entry: AtlasEntry; onClose: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const shareUrl = useMemo(() => buildAtlasSpotUrl(entry.id), [entry.id]);

  // Bridge: the embedded showcase's .f3d-bar Share button asks the parent
  // for the canonical Atlas URL via postMessage so it can share /atlas?spot=…
  // instead of its own standalone netlify URL. Harmless if the showcase
  // hasn't shipped its half of the protocol yet.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const win = iframeRef.current?.contentWindow;
      if (!win || event.source !== win) return;
      const data = event.data as { type?: string } | null;
      if (!data || data.type !== "f3d:request-share-url") return;
      win.postMessage(
        { type: "f3d:share-url", url: shareUrl, title: entry.title },
        "*",
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [shareUrl, entry.title]);

  const handleShare = async () => {
    const shareData = { title: entry.title, url: shareUrl };
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share(shareData);
        return;
      }
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Atlas link copied to clipboard");
        return;
      }
      window.prompt("Copy this Atlas link:", shareUrl);
    } catch (err) {
      // AbortError from navigator.share is benign (user dismissed the sheet).
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error("Couldn't copy link. Please copy from the address bar.");
    }
  };

  return (
    <div
      className="atlas-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${entry.title} — immersive presentation`}
      onClick={onClose}
    >
      {/* The embedded curated showcase brings its own header (.f3d-bar with
          Explore Together / About / Share), so the outer modal is a clean
          viewer shell: just a compact floating Share + Open-in-new-tab + Close
          group above the frame — no duplicated title/category/footer chrome.
          The Open / Share controls emit the canonical Atlas deep-link URL
          (/atlas?spot=<id>) so recipients land back on Atlas, not the raw
          standalone showcase. */}
      <div className="atlas-modal-controls" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={handleShare}
          className="atlas-modal-ctrl"
          title="Share Atlas link"
          aria-label="Share Atlas link"
        >
          <Share2 className="size-4" />
        </button>
        <a
          href={shareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="atlas-modal-ctrl"
          title="Open Atlas link in new tab"
          aria-label="Open Atlas link in new tab"
        >
          <ExternalLink className="size-4" />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="atlas-modal-ctrl"
          title="Close"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="atlas-modal" onClick={(e) => e.stopPropagation()}>
        <div className="atlas-modal-frame">
          {!loaded && (
            <div className="atlas-modal-loading" aria-hidden="true">
              Loading immersive showcase…
            </div>
          )}
          {entry.presentation_url && (
            <iframe
              ref={iframeRef}
              key={entry.id}
              src={entry.presentation_url}
              title={`${entry.title} — immersive presentation`}
              onLoad={() => setLoaded(true)}
              // Explore Together (live voice + synced views) runs inside the
              // embedded curated showcase, so the modal iframe must delegate
              // the Permissions-Policy features the showcase (and the nested
              // Matterport iframe) need: microphone for getUserMedia voice,
              // clipboard-read/write for Matterport's "Copy to clipboard" →
              // parent sync flow, plus the existing motion/display features.
              allow="microphone; clipboard-read; clipboard-write; autoplay; fullscreen; accelerometer; gyroscope; xr-spatial-tracking"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
              referrerPolicy="no-referrer-when-downgrade"
            />
          )}
        </div>
      </div>
    </div>
  );
}

