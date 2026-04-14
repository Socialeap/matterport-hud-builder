import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  Layers,
  Palette,
  Globe,
  ShieldCheck,
  Zap,
  Users,
  ChevronRight,
  Sparkles,
  Lock,
  Play,
  Clock,
  DollarSign,
  PackageX,
} from "lucide-react";
import heroShowcase from "@/assets/hero-showcase.png";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Matterport HUD Builder — Branded 3D Property Presentations" },
      {
        name: "description",
        content:
          "Build professional, whitelabeled 3D property tour presentations. No subscriptions. One-time purchase. Host anywhere.",
      },
    ],
  }),
  component: Index,
});

/* ------------------------------------------------------------------ */
/*  Feature data                                                       */
/* ------------------------------------------------------------------ */

const features = [
  {
    icon: Palette,
    title: "100% White-Label Authority",
    description:
      "Invite clients to your HUD Station with your logo, colors, and domain name, reinforcing your brand equity, not ours.",
  },
  {
    icon: Layers,
    title: "Multi-Model HUD",
    description:
      "Allow clients to bundle multiple Matterport tours into a single branded presentation with dropdown navigation.",
  },
  {
    icon: Globe,
    title: "Total Hosting Sovereignty",
    description:
      "Once downloaded, Tour Presentations are 100% self-contained files. Clients can host them anywhere they like, including cost-free platforms like Netflify.",
  },
  {
    icon: Users,
    title: "Self-Serve Branding Station",
    description:
      "Allow clients to configure their own Tour Presentations with logo/profile image, music track, contact options, branded HUD, and Google Analytics.",
  },
  {
    icon: ShieldCheck,
    title: "Protected Intellectual Property",
    description:
      "Tour IDs and config settings are Base64-scrambled. Your intellectual property stays protected.",
  },
  {
    icon: Zap,
    title: "20+ Tour Behaviors",
    description:
      "MLS mode, auto-play, scroll-wheel lock, guided tours, language forcing, custom transitions — granular control.",
  },
];

const starterFeatures = [
  'Co-branded output ("Powered by TM")',
  "Full HUD builder access",
  "Client portal at /p/your-slug",
  "Music & tour behavior config",
  "Unlimited Matterport models",
];

const proFeatures = [
  "100% ghost-labeled — zero co-branding",
  "Custom domain mapping",
  "Full HUD builder access",
  "Client portal on your domain",
  "Priority support",
  "All Starter features included",
];

/* ------------------------------------------------------------------ */
/*  Admin Demo Panel                                                   */
/* ------------------------------------------------------------------ */

function AdminDemoPanel() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [activating, setActivating] = useState<string | null>(null);

  if (!isAuthenticated || !user) {
    return (
      <Card className="border-dashed border-primary/40 bg-primary/5">
        <CardContent className="py-8 text-center">
          <Lock className="mx-auto size-8 text-muted-foreground/60" />
          <h3 className="mt-3 text-lg font-semibold text-foreground">
            Admin Demo — Sign In Required
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to activate a test tier and explore the dashboard without purchasing.
          </p>
          <Button className="mt-4" onClick={() => navigate({ to: "/login" })}>
            Sign In to Test
          </Button>
        </CardContent>
      </Card>
    );
  }

  const activateTier = async (tier: "starter" | "pro") => {
    setActivating(tier);
    try {
      // 1. Ensure user has provider role
      const { data: existingRole } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user.id)
        .eq("role", "provider")
        .maybeSingle();

      if (!existingRole) {
        await supabase
          .from("user_roles")
          .insert({ user_id: user.id, role: "provider" });
      }

      // 2. Insert a sandbox purchase for the selected tier
      const productId = tier === "pro" ? "pro_tier" : "starter_tier";
      const amount = tier === "pro" ? 29900 : 14900;

      // Remove any existing sandbox tier purchases
      // (we use upsert-like logic by deleting first)
      const { data: existingPurchases } = await supabase
        .from("purchases")
        .select("id")
        .eq("user_id", user.id)
        .eq("environment", "sandbox")
        .in("product_id", ["starter_tier", "pro_tier", "pro_upgrade"]);

      if (existingPurchases && existingPurchases.length > 0) {
        // Can't delete via client (no policy), so we'll just insert
        // The get_user_tier function checks for pro first, so adding pro overrides starter
      }

      await supabase.from("purchases").insert({
        user_id: user.id,
        stripe_session_id: `demo_${tier}_${Date.now()}`,
        product_id: productId,
        price_id: `${tier}_onetime`,
        amount_cents: amount,
        currency: "usd",
        status: "completed",
        environment: "sandbox",
      });

      // 3. Upsert branding_settings with the tier
      const { data: existingBranding } = await supabase
        .from("branding_settings")
        .select("id")
        .eq("provider_id", user.id)
        .maybeSingle();

      if (!existingBranding) {
        await supabase.from("branding_settings").insert({
          provider_id: user.id,
          tier: tier,
          brand_name: "",
          accent_color: "#3B82F6",
          hud_bg_color: "#1a1a2e",
          gate_label: "Enter",
        });
      } else {
        await supabase
          .from("branding_settings")
          .update({ tier: tier })
          .eq("provider_id", user.id);
      }

      toast.success(
        `${tier === "pro" ? "Pro" : "Starter"} tier activated! Redirecting to dashboard…`
      );
      setTimeout(() => navigate({ to: "/dashboard" }), 1200);
    } catch (err) {
      console.error(err);
      toast.error("Failed to activate tier. Please try again.");
    }
    setActivating(null);
  };

  return (
    <Card className="border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
          <Play className="size-6 text-primary" />
        </div>
        <CardTitle className="mt-2 text-xl">Admin Demo Mode</CardTitle>
        <p className="text-sm text-muted-foreground">
          Activate a test tier instantly — no Stripe purchase required. Explore the full
          dashboard, branding settings, client portal, and orders workflow.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <button
            onClick={() => activateTier("starter")}
            disabled={!!activating}
            className="group relative flex flex-col items-center rounded-xl border-2 border-border bg-card p-6 text-center transition-all hover:border-primary/50 hover:shadow-md disabled:opacity-50"
          >
            <Badge variant="secondary" className="mb-3">
              Starter
            </Badge>
            <span className="text-3xl font-bold text-foreground">$149</span>
            <span className="text-xs text-muted-foreground">one-time (simulated)</span>
            <ul className="mt-4 space-y-1.5 text-left text-xs text-muted-foreground">
              {starterFeatures.slice(0, 3).map((f) => (
                <li key={f} className="flex items-start gap-1.5">
                  <Check className="mt-0.5 size-3 shrink-0 text-primary" />
                  {f}
                </li>
              ))}
            </ul>
            <span className="mt-4 inline-flex items-center text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
              Activate Starter
              <ChevronRight className="ml-1 size-4" />
            </span>
            {activating === "starter" && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/80">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}
          </button>

          <button
            onClick={() => activateTier("pro")}
            disabled={!!activating}
            className="group relative flex flex-col items-center rounded-xl border-2 border-primary bg-card p-6 text-center shadow-sm transition-all hover:shadow-lg disabled:opacity-50"
          >
            <Badge className="mb-3">Pro — Recommended</Badge>
            <span className="text-3xl font-bold text-foreground">$299</span>
            <span className="text-xs text-muted-foreground">one-time (simulated)</span>
            <ul className="mt-4 space-y-1.5 text-left text-xs text-muted-foreground">
              {proFeatures.slice(0, 3).map((f) => (
                <li key={f} className="flex items-start gap-1.5">
                  <Check className="mt-0.5 size-3 shrink-0 text-primary" />
                  {f}
                </li>
              ))}
            </ul>
            <span className="mt-4 inline-flex items-center text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
              Activate Pro
              <ChevronRight className="ml-1 size-4" />
            </span>
            {activating === "pro" && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/80">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Demo purchases are recorded in sandbox mode and don't affect billing.
          You can switch tiers any time by returning here.
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

function Index() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="dark relative min-h-screen bg-[#0a0e27] text-foreground">
      {/* ---- Notebook grid overlay ---- */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)
          `,
          backgroundSize: '70px 70px',
        }}
      />

      {/* ---- Organic translucent orbs ---- */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -left-32 -top-20 h-[500px] w-[500px] rounded-full bg-blue-600/15 blur-[160px]" />
        <div className="absolute right-0 top-[30%] h-[400px] w-[450px] rounded-full bg-indigo-500/12 blur-[140px]" />
        <div className="absolute bottom-[10%] left-[20%] h-[350px] w-[400px] rounded-full bg-teal-500/10 blur-[180px]" />
        <div className="absolute -right-20 bottom-[40%] h-[300px] w-[350px] rounded-full bg-purple-600/8 blur-[150px]" />
        <div className="absolute left-[50%] top-[60%] h-[400px] w-[400px] rounded-full bg-cyan-500/8 blur-[200px]" />
      </div>

      {/* ---- Hero ---- */}
      <section className="relative z-10 overflow-hidden px-4 pb-16 pt-20 sm:pb-24 sm:pt-28">
        {/* Hero background image */}
        <div className="absolute inset-0 z-0">
          <img
            src={heroShowcase}
            alt="3D property tour showcase"
            className="h-full w-full object-cover"
          />
          {/* Dark gradient overlay for text readability */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#0a0e27]/80 via-[#0a0e27]/60 to-[#0a0e27]/90" />
          {/* Subtle vignette */}
          <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 150px 60px rgba(10,14,39,0.7)' }} />
        </div>

        <div className="relative z-10 mx-auto max-w-3xl text-center">
          <Badge variant="secondary" className="mb-6 gap-1.5 px-3 py-1 text-xs">
            <Sparkles className="size-3" />
            No subscriptions. Ever.
          </Badge>

          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white drop-shadow-lg sm:text-5xl lg:text-6xl">
            Launch your own HUD Station where Clients can{" "}
            <br />
            <span className="text-primary drop-shadow-md">Customize their 3D Tour Presentations</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg text-white/80 drop-shadow">
            Stop paying 3rd party services to hold your tours hostage on their servers. Instead of manually configuring tours on external platforms, host your own space where clients can EASILY build their own tour presentations—downloaded as independent assets they own and EASILY host wherever they choose.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {isAuthenticated ? (
              <Button size="lg" onClick={() => navigate({ to: "/dashboard" })}>
                Go to Dashboard
                <ChevronRight className="ml-1 size-4" />
              </Button>
            ) : (
              <>
                <Button size="lg" onClick={() => navigate({ to: "/signup", search: { token: "", email: "" } })}>
                  Get Started Free
                  <ChevronRight className="ml-1 size-4" />
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" onClick={() => navigate({ to: "/login" })}>
                  Sign In
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ---- Problem section ---- */}
      <section className="relative z-10 px-4 py-16 sm:py-24" style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            The &ldquo;Service Trap&rdquo; of Traditional 3D Presentation Platforms
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Most platforms require you to do the manual labor on their servers, charging you a monthly subscription just to keep your assets online.
          </p>

          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            <Card className="border-red-500/20 bg-white/5 backdrop-blur">
              <CardContent className="pt-6">
                <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10">
                  <DollarSign className="size-5 text-destructive" />
                </div>
                <h3 className="mt-4 font-semibold text-foreground">You Do the Work, They Get Paid</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Monthly subscriptions to keep your assets online — while you&#39;re the one doing all the manual labor on their servers.
                </p>
              </CardContent>
            </Card>

            <Card className="border-red-500/20 bg-white/5 backdrop-blur">
              <CardContent className="pt-6">
                <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10">
                  <Clock className="size-5 text-destructive" />
                </div>
                <h3 className="mt-4 font-semibold text-foreground">Every Change Goes Through You</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  When a client needs an MLS-compliant version or a simple music change, you have to log in and do the work every time.
                </p>
              </CardContent>
            </Card>

            <Card className="border-red-500/20 bg-white/5 backdrop-blur">
              <CardContent className="pt-6">
                <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10">
                  <Lock className="size-5 text-destructive" />
                </div>
                <h3 className="mt-4 font-semibold text-foreground">A Bottleneck You Don&#39;t Own</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  You aren&#39;t just paying for software — you&#39;re paying for the privilege of being an unpaid administrator for a company you don&#39;t own. It drains your time and limits your growth.
                </p>
              </CardContent>
            </Card>

            <Card className="border-red-500/20 bg-white/5 backdrop-blur">
              <CardContent className="pt-6">
                <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10">
                  <PackageX className="size-5 text-destructive" />
                </div>
                <h3 className="mt-4 font-semibold text-foreground">Paying for Tools You Never Use</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Complex &ldquo;bloatware&rdquo; like IoT data integrations and rarely used features like graphical overlays and sectional audio — bundled into every plan whether you need them or not.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ---- Features grid ---- */}
      <section className="relative z-10 border-t border-white/5 px-4 py-16 sm:py-24" style={{ backgroundColor: 'rgba(255,255,255,0.015)' }}>
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            A Branded HUD Station for Clients to Build Their Own Presentations
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            One platform to configure, preview, and deliver professional Matterport HUD
            presentations — fully branded to you.
          </p>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <Card key={f.title} className="bg-white/5 backdrop-blur">
                <CardContent className="pt-6">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <f.icon className="size-5 text-primary" />
                  </div>
                  <h3 className="mt-4 font-semibold text-foreground">{f.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Pricing comparison ---- */}
      <section className="relative z-10 px-4 py-16 sm:py-24">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Simple, One-Time Pricing
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-center text-muted-foreground">
            Pay once. Own it forever. No monthly fees, no per-tour charges, no surprises.
          </p>

          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {/* Starter */}
            <Card className="flex flex-col">
              <CardHeader className="text-center">
                <Badge variant="secondary" className="mx-auto mb-2 w-fit">
                  Starter
                </Badge>
                <span className="text-4xl font-bold text-foreground">$149</span>
                <span className="text-sm text-muted-foreground">one-time payment</span>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-6">
                <ul className="space-y-2.5">
                  {starterFeatures.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      {f}
                    </li>
                  ))}
                </ul>
                {!isAuthenticated && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => navigate({ to: "/signup", search: { token: "", email: "" } })}
                  >
                    Get Starter
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Pro */}
            <Card className="relative flex flex-col border-primary shadow-lg">
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                Most Popular
              </Badge>
              <CardHeader className="text-center">
                <Badge className="mx-auto mb-2 w-fit">Pro</Badge>
                <span className="text-4xl font-bold text-foreground">$299</span>
                <span className="text-sm text-muted-foreground">one-time payment</span>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-6">
                <ul className="space-y-2.5">
                  {proFeatures.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      {f}
                    </li>
                  ))}
                </ul>
                {!isAuthenticated && (
                  <Button
                    className="w-full"
                    onClick={() => navigate({ to: "/signup", search: { token: "", email: "" } })}
                  >
                    Get Pro
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ---- Admin Demo ---- */}
      <section className="relative z-10 border-t border-white/5 px-4 py-16 sm:py-24" style={{ backgroundColor: 'rgba(255,255,255,0.015)' }}>
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-6 text-center text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Try It Now — Admin Demo
          </h2>
          <p className="mb-8 text-center text-muted-foreground">
            Activate a test tier instantly to explore the full dashboard, branding
            configurator, client portal, and order management — without spending a dime.
          </p>
          <AdminDemoPanel />
        </div>
      </section>

      {/* ---- How it works ---- */}
      <section className="relative z-10 px-4 py-16 sm:py-24">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            How It Works
          </h2>
          <div className="mt-12 space-y-8">
            {[
              {
                step: "1",
                title: "Sign Up & Choose Your Tier",
                desc: "Create your account and pick Starter or Pro. One-time payment, lifetime access.",
              },
              {
                step: "2",
                title: "Configure Your Brand",
                desc: "Upload your logo, set accent colors, and customize the HUD header. Set a portal slug for your client-facing page.",
              },
              {
                step: "3",
                title: "Share Your Portal",
                desc: "Send agents and property managers to your branded portal. They add Matterport models, configure tour behaviors, and preview in real-time.",
              },
              {
                step: "4",
                title: "Fulfill & Deliver",
                desc: "When a client confirms, you receive a notification. Mark as paid, generate the self-contained HTML file, and release it to your client.",
              },
            ].map((item) => (
              <div key={item.step} className="flex gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {item.step}
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">{item.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer className="relative z-10 border-t border-white/5 px-4 py-8">
        <div className="mx-auto max-w-5xl text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Transcendence Media. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
