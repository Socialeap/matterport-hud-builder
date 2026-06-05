import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { categoryLabel, type AtlasEntry } from "@/lib/atlas-demo-data";

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

function AtlasPage() {
  const { entries } = Route.useLoaderData() as {
    entries: AtlasEntry[];
    error: string | null;
  };

  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [active, setActive] = useState<AtlasEntry | null>(null);
  // Business card shown over the map when a pin is clicked (replaces the old
  // Leaflet mini-popup). Cleared by its close button or a background map click.
  const [preview, setPreview] = useState<AtlasEntry | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
      // Clicking a pin surfaces the full business card (not a mini popup):
      // select it, show the floating card over the map, and bring the matching
      // sidebar card into view.
      marker.on("click", () => {
        setSelectedId(entry.id);
        setPreview(entry);
        if (typeof document !== "undefined") {
          document
            .getElementById(`atlas-card-${entry.id}`)
            ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
      // Smart hover tooltip — only when pin is not clustered with neighbors
      // at the current zoom level. Uses Leaflet's native tooltip API to avoid
      // React re-renders. Overlap is recomputed at hover time in screen px.
      marker.on("mouseover", () => {
        const map = refs.map;
        const currentPoint = map.latLngToContainerPoint(marker.getLatLng());
        for (const [id, otherMarker] of refs.markers.entries()) {
          if (id === entry.id) continue;
          const otherPoint = map.latLngToContainerPoint(otherMarker.getLatLng());
          if (currentPoint.distanceTo(otherPoint) < 30) return;
        }
        const safeTitle = escapeHtml(entry.title);
        const safeCategory = escapeHtml(categoryLabel(entry.category));
        marker
          .bindTooltip(
            `<div class="atlas-tooltip-content"><strong class="atlas-tooltip-title">${safeTitle}</strong><span class="atlas-tooltip-cat">${safeCategory}</span></div>`,
            {
              className: "atlas-pin-tooltip",
              direction: "top",
              offset: [0, -12],
              opacity: 1,
            },
          )
          .openTooltip();
      });
      marker.on("mouseout", () => {
        marker.unbindTooltip();
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

  return (
    <div className="atlas-shell">
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
              filtered.map((entry) => (
                <ListingCard
                  key={entry.id}
                  entry={entry}
                  selected={selectedId === entry.id}
                  onHover={() => setSelectedId(entry.id)}
                  onFocus={() => focusEntry(entry)}
                  onOpen={() => entry.presentation_url && setActive(entry)}
                />
              ))
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

          {/* Pin click → the full business card over the map (with Step Inside). */}
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
              <ListingCard
                entry={preview}
                selected
                onHover={() => setSelectedId(preview.id)}
                onFocus={() => focusEntry(preview)}
                onOpen={() => preview.presentation_url && setActive(preview)}
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

function ListingCard({
  entry,
  selected,
  onHover,
  onFocus,
  onOpen,
}: {
  entry: AtlasEntry;
  selected: boolean;
  onHover: () => void;
  onFocus: () => void;
  onOpen: () => void;
}) {
  const loc = [entry.city, entry.region].filter(Boolean).join(", ");
  const hasCoords = entry.latitude != null && entry.longitude != null;
  return (
    <article
      role="listitem"
      id={`atlas-card-${entry.id}`}
      onMouseEnter={onHover}
      onClick={onFocus}
      className={`atlas-card ${selected ? "is-selected" : ""}`}
    >
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
          viewer shell: just a compact floating Open-in-new-tab + Close group
          above the frame — no duplicated title/category/footer chrome. */}
      <div className="atlas-modal-controls" onClick={(e) => e.stopPropagation()}>
        <a
          href={entry.presentation_url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="atlas-modal-ctrl"
          title="Open in new tab"
          aria-label="Open in new tab"
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
