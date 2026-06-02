import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import {
  Building2, MapPin, Eye, MessageSquareText, Camera, CheckCircle2,
  Compass, Sparkles, ArrowRight, Store, ChevronRight,
} from "lucide-react";

const SITE_URL = "https://www.frontiers3d.com";

export const Route = createFileRoute("/businesses")({
  head: () => ({
    meta: [
      { title: "Frontiers3D for Businesses — Help customers experience your space before they visit" },
      {
        name: "description",
        content:
          "Restaurants, cafés, hotels, venues, galleries, wellness studios, retail showrooms and coworking spaces: get your space represented in the Frontiers3D Atlas, an immersive discovery map.",
      },
      { property: "og:title", content: "Frontiers3D for Businesses — Your space in the immersive Atlas" },
      {
        property: "og:description",
        content: "Help customers experience your space before they visit. See sample Atlas listings.",
      },
      { property: "og:url", content: `${SITE_URL}/businesses` },
    ],
  }),
  component: BusinessesPage,
});

const VALUE = [
  { icon: Eye, title: "Show the experience, not just photos", body: "Let people see the layout, atmosphere, rooms, patios, and signature spaces before they ever walk in." },
  { icon: MessageSquareText, title: "Answer questions up front", body: "Reduce repetitive “what does it look like / how big is it” questions by showing the space clearly." },
  { icon: Compass, title: "Help people choose with confidence", body: "Make it easier to decide to book, reserve, visit, or inquire — because they already understand the space." },
  { icon: Store, title: "One reusable asset", body: "Use the same immersive presentation on your website, Google presence, social links, and sales conversations." },
];

const STEPS = [
  { icon: Camera, title: "Get your space captured", body: "Work with a local 3D capture provider to turn your storefront, venue, or public space into an Atlas-ready Frontiers3D presentation." },
  { icon: CheckCircle2, title: "Publish & submit", body: "After your Frontiers3D presentation is published, submit the live URL for Atlas verification." },
  { icon: Compass, title: "Customers discover & step inside", body: "Once verified, your eligible listing can appear in the public Atlas discovery map, where people explore before they visit." },
];

function BusinessesPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#0a0e27] text-white">
      {/* Header */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#0a0e27]/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-sm font-extrabold tracking-[0.2em] text-white" aria-label="Frontiers3D — home">
              FRONTIERS3D
            </Link>
            <span className="hidden text-sm font-semibold text-white/80 sm:inline">for Businesses</span>
          </div>
          <nav className="flex items-center gap-4 sm:gap-6">
            <Link to="/atlas" className="text-sm text-white/70 transition-colors hover:text-white">Atlas</Link>
            <Link to="/agents" className="hidden text-sm text-white/70 transition-colors hover:text-white sm:inline">For Agents</Link>
            {isAuthenticated ? (
              <Button size="sm" onClick={() => navigate({ to: "/dashboard" })}>Dashboard</Button>
            ) : (
              <Button size="sm" variant="ghost" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={() => navigate({ to: "/login" })}>Sign In</Button>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="px-4 pt-28 pb-12 sm:pt-36 sm:pb-16">
        <div className="mx-auto max-w-4xl text-center">
          <span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
            <Building2 className="size-3.5" /> Restaurants · Cafés · Hotels · Venues · Galleries · Wellness · Retail · Coworking
          </span>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight lg:text-6xl sm:text-5xl">
            Help customers experience your space{" "}
            <span className="bg-gradient-to-r from-cyan-300 to-indigo-400 bg-clip-text text-transparent">before they visit</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg">
            Get your storefront, venue, or public space represented in the Frontiers3D Atlas — an immersive
            discovery map where guests, buyers, and customers can step inside before they book, visit, or inquire.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to="/atlas">
              <Button size="lg" className="gap-2">
                See Sample Atlas Listings <ChevronRight className="size-4" />
              </Button>
            </Link>
            <a href="/agents#directory">
              <Button size="lg" variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10">
                Request a Local 3D Provider
              </Button>
            </a>
          </div>
          <p className="mx-auto mt-4 max-w-xl text-xs text-white/40">
            The Atlas shows <strong className="text-white/60">sample / demo</strong> listings today. As Atlas
            verification rolls out, you’ll publish your Frontiers3D presentation and submit its live URL — your
            space appears only after it’s verified, and we never claim a listing exists before it does.
          </p>
        </div>
      </section>

      {/* Value */}
      <section className="px-4 py-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">Why put your space on the map</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {VALUE.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-xl border border-white/10 bg-white/5 p-5">
                <Icon className="size-6 text-cyan-300" />
                <h3 className="mt-3 text-base font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-white/60">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-4 py-12">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">How it works</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-white/55">
            Publish and submit your Atlas-ready presentation. After your Frontiers3D presentation is published, you
            submit the live URL for Atlas verification — once verified, your eligible listing can appear in the
            discovery map.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <div key={title} className="rounded-xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-center gap-2">
                  <span className="inline-flex size-7 items-center justify-center rounded-full bg-indigo-500/20 text-sm font-bold text-indigo-300">{i + 1}</span>
                  <Icon className="size-5 text-white/70" />
                </div>
                <h3 className="mt-3 text-base font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-white/60">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section className="px-4 py-14">
        <div className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-600/20 to-cyan-500/10 p-8 text-center">
          <Sparkles className="mx-auto size-7 text-cyan-300" />
          <h2 className="mt-3 text-2xl font-bold sm:text-3xl">See what an Atlas listing looks like</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-white/60">
            Explore the public discovery map and step inside sample spaces — then talk to a local provider about capturing yours.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to="/atlas">
              <Button size="lg" className="gap-2">See Sample Atlas Listings <ArrowRight className="size-4" /></Button>
            </Link>
            <a href="/agents#directory">
              <Button size="lg" variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10">
                Request a Local 3D Provider
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-[#070b1f] px-4 py-10">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-extrabold tracking-[0.2em] text-white">FRONTIERS3D</span>
            <nav className="flex flex-wrap items-center gap-4 text-sm text-white/60">
              <Link to="/atlas" className="hover:text-white">Atlas</Link>
              <Link to="/agents" className="hover:text-white">For Agents</Link>
              <a href="mailto:info@transcendencemedia.com" className="hover:text-white">Contact</a>
            </nav>
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-xs text-white/40">
            <MapPin className="size-3.5" />
            © {new Date().getFullYear()} Transcendence Media · Frontiers3D. Atlas listings appear only after a published Frontiers3D presentation is verified.
          </p>
        </div>
      </footer>
    </div>
  );
}
