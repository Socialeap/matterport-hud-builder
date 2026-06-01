import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  MapPin,
  Compass,
  ExternalLink,
  X,
  Menu,
  ShieldCheck,
  Sparkles,
  Box,
  ArrowRight,
} from "lucide-react";
import { listActiveAtlasEntries } from "@/lib/atlas.functions";
import { categoryLabel, type AtlasEntry } from "@/lib/atlas-demo-data";

export const Route = createFileRoute("/atlas")({
  head: () => ({
    meta: [
      { title: "Frontiers3D Atlas — Step inside real places from the map" },
      {
        name: "description",
        content:
          "Frontiers3D Atlas is a discovery layer for immersive 3D spaces. Explore verified sample listings and step inside before you visit, book, or inquire.",
      },
      { property: "og:title", content: "Frontiers3D Atlas — Immersive discovery layer" },
      {
        property: "og:description",
        content: "Discover verified immersive 3D spaces on a dark interactive map.",
      },
    ],
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
      const loc = [entry.city, entry.region].filter(Boolean).join(", ");
      const kindLabel =
        entry.kind === "demo"
          ? `<span class="atlas-pop-pill atlas-pop-pill--sample">Sample</span>`
          : `<span class="atlas-pop-pill atlas-pop-pill--verified">Verified</span>`;
      marker.bindPopup(
        `
        <div class="atlas-popup">
          <div class="atlas-popup-row">
            <span class="atlas-popup-cat">${escapeHtml(categoryLabel(entry.category))}</span>
            ${kindLabel}
          </div>
          <h4 class="atlas-popup-title">${escapeHtml(entry.title)}</h4>
          ${loc ? `<p class="atlas-popup-loc">📍 ${escapeHtml(loc)}</p>` : ""}
          <button class="atlas-popup-cta" data-atlas-open="${entry.id}">
            Step Inside 3D Showcase →
          </button>
        </div>
      `,
        { closeButton: false, maxWidth: 260 },
      );
      marker.on("click", () => setSelectedId(entry.id));
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

  // Delegate clicks on popup CTA → open modal.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest?.("[data-atlas-open]") as HTMLElement | null;
      if (!btn) return;
      const id = btn.getAttribute("data-atlas-open");
      const entry = entries.find((x) => x.id === id);
      if (entry) setActive(entry);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [entries]);

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

  // Card click: pan to marker + open popup.
  const focusEntry = (entry: AtlasEntry) => {
    setSelectedId(entry.id);
    const refs = refsRef.current;
    if (refs && entry.latitude != null && entry.longitude != null) {
      refs.map.flyTo([entry.latitude, entry.longitude], 13, { duration: 1.2 });
      const m = refs.markers.get(entry.id);
      if (m) m.openPopup();
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
              FRONTIERS3D ATLAS
              <span className="atlas-brand-pill">Discovery Layer</span>
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
              {entries.length} approved live
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
            <div className="atlas-chips">
              <button
                onClick={() => setActiveCategory("all")}
                className={`atlas-chip ${activeCategory === "all" ? "is-active" : ""}`}
              >
                All listings
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setActiveCategory(c)}
                  className={`atlas-chip ${activeCategory === c ? "is-active" : ""}`}
                >
                  {categoryLabel(c)}
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
          <button
            type="button"
            className="atlas-mobile-toggle"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle listings panel"
          >
            <Menu className="size-4" />
            {sidebarOpen ? "Hide listings" : "Show listings"}
          </button>
          <span className="atlas-map-badge">
            <Compass className="size-3.5" />
            Sample discovery map
          </span>
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
        ) : (
          <span className="atlas-card-kind atlas-card-kind--verified">
            <ShieldCheck className="size-3" /> Verified
          </span>
        )}
      </div>
      <h3 className="atlas-card-title">{entry.title}</h3>
      {loc ? (
        <p className="atlas-card-loc">
          <MapPin className="size-3.5" /> {loc}
        </p>
      ) : (
        <p className="atlas-card-loc atlas-card-loc--pending">
          <MapPin className="size-3.5" /> Location pending
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
          >
            Step Inside <ArrowRight className="size-3.5" />
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
        The Frontiers3D Atlas demo is being curated. Check back shortly to step
        inside sample spaces.
      </p>
    </div>
  );
}

function PresentationModal({ entry, onClose }: { entry: AtlasEntry; onClose: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      if (!loaded) setFailed(true);
    }, 6000);
    return () => clearTimeout(t);
  }, [loaded]);
  const loc = [entry.city, entry.region].filter(Boolean).join(", ") || "Sample location";

  return (
    <div className="atlas-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="atlas-modal" onClick={(e) => e.stopPropagation()}>
        <div className="atlas-modal-header">
          <div className="atlas-modal-titlebox">
            <span className="atlas-modal-dot" />
            <div className="min-w-0">
              <h3>{entry.title}</h3>
              <p>
                {categoryLabel(entry.category)} · {loc}
              </p>
            </div>
          </div>
          <div className="atlas-modal-actions">
            <a
              href={entry.presentation_url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="atlas-modal-open"
            >
              Open in new tab <ExternalLink className="size-3.5" />
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="atlas-modal-close"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {failed && !loaded && (
          <div className="atlas-modal-warn">
            This space refused to embed. Use <strong>Open in new tab</strong> to view it.
          </div>
        )}

        <div className="atlas-modal-frame">
          {entry.presentation_url && (
            <iframe
              key={entry.id}
              src={entry.presentation_url}
              title={`${entry.title} — immersive presentation`}
              onLoad={() => setLoaded(true)}
              allow="accelerometer; autoplay; fullscreen; gyroscope; xr-spatial-tracking"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
              referrerPolicy="no-referrer-when-downgrade"
            />
          )}
        </div>

        <div className="atlas-modal-footer">
          <span>
            {entry.kind === "demo"
              ? "Sample Frontiers3D Atlas listing — for demonstration."
              : "Verified Frontiers3D Atlas listing."}
          </span>
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
