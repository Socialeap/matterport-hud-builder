import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Palette,
  DollarSign,
  Banknote,
  Archive,
  Users,
  ShoppingCart,
  Check,
  Lock,
  Sparkles,
  Eye,
  Bot,
  HelpCircle,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard/")({
  component: DashboardOverview,
});

type Branding = {
  brand_name: string | null;
  logo_url: string | null;
  base_price_cents: number | null;
  stripe_onboarding_complete: boolean | null;
  accent_color: string | null;
  slug: string | null;
  tier: "starter" | "pro";
};

type Status = {
  branding: Branding | null;
  invitedCount: number;
  orderCount: number;
};

function DashboardOverview() {
  const { user, roles } = useAuth();
  const isClient = roles.includes("client") && !roles.includes("provider") && !roles.includes("admin");

  if (isClient) {
    return <ClientOverview />;
  }

  return <ProviderOverview user={user} />;
}

function ProviderOverview({ user }: { user: ReturnType<typeof useAuth>["user"] }) {
  const [status, setStatus] = useState<Status>({
    branding: null,
    invitedCount: 0,
    orderCount: 0,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [b, inv, ord] = await Promise.all([
        supabase
          .from("branding_settings")
          .select(
            "brand_name, logo_url, base_price_cents, stripe_onboarding_complete, accent_color, slug, tier"
          )
          .eq("provider_id", user.id)
          .maybeSingle(),
        supabase
          .from("invitations")
          .select("id", { count: "exact", head: true })
          .eq("provider_id", user.id),
        supabase
          .from("order_notifications")
          .select("id", { count: "exact", head: true })
          .eq("provider_id", user.id),
      ]);
      if (cancelled) return;
      setStatus({
        branding: (b.data as Branding | null) ?? null,
        invitedCount: inv.count ?? 0,
        orderCount: ord.count ?? 0,
      });
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const accent = status.branding?.accent_color || "#3B82F6";
  const brandName = status.branding?.brand_name || "Your Studio";
  const slug = status.branding?.slug;
  const tier = status.branding?.tier || "starter";
  const isPro = tier === "pro";

  const steps: StepDef[] = [
    {
      n: 1,
      icon: Palette,
      title: "Brand Your Studio",
      blurb: "Make the platform look and feel like yours.",
      bullets: [
        "Upload your logo",
        "Pick an accent color",
        "Choose a Portal background",
      ],
      cta: { label: "Open Branding", to: "/dashboard/branding" },
      done: !!status.branding?.logo_url,
      howTo: {
        title: "How to brand your studio",
        steps: [
          "Upload your logo — square works best.",
          "Pick an accent color that pops on dark and light.",
          "Choose a Portal background — dark colors look most premium.",
          "Save. Your portal updates instantly.",
        ],
      },
    },
    {
      n: 2,
      icon: DollarSign,
      title: "Set Your Pricing",
      blurb: "Decide what you charge clients per presentation.",
      bullets: [
        "Set your base price",
        "Add a per-extra-model fee (optional)",
        "Choose when extra fees kick in",
      ],
      cta: { label: "Set Pricing", to: "/dashboard/pricing" },
      done: (status.branding?.base_price_cents ?? 0) > 0,
      howTo: {
        title: "How pricing works",
        steps: [
          "Set the base price each client pays per saved presentation.",
          "Optionally add a fee for extra 3D models in the same presentation.",
          "Pick the threshold where the extra fee starts (e.g. after 1 model).",
          "Clients see the total at checkout — you keep the margin.",
        ],
      },
    },
    {
      n: 3,
      icon: Banknote,
      title: "Connect Payouts",
      blurb: "Link a payout account so client payments reach your bank.",
      bullets: [
        "Verify your business details",
        "Add a bank account",
        "Choose standard or instant payouts",
      ],
      cta: { label: "Connect Payouts", to: "/dashboard/payouts" },
      done: !!status.branding?.stripe_onboarding_complete,
      howTo: {
        title: "Connecting payouts",
        steps: [
          "Click Connect Payouts and follow the secure setup.",
          "Add your business info and a bank account.",
          "Choose standard payouts (free) or instant (small fee).",
          "Once verified, every client purchase pays you automatically.",
        ],
      },
    },
    {
      n: 4,
      icon: Archive,
      title: "Stock Your Vault",
      blurb:
        "Add reusable assets — audio, widgets, icons, docs — that your clients can drop into tours.",
      bullets: [
        "Upload spatial audio, icons, widgets",
        "Add property doc samples to teach the AI what fields to extract",
        "Reuse across every client tour",
      ],
      cta: { label: "Open Vault", to: "/dashboard/vault" },
      done: false,
      locked: !isPro,
      lockedNote: "Pro feature — upgrade to unlock",
      howTo: {
        title: "Using the Vault",
        steps: [
          "Pick a category (audio, widget, icon, document, link).",
          "Upload the file or paste a link, give it a label.",
          "Reusable assets (audio, widgets, icons) — your clients drop them into any tour they build.",
          "Property doc samples — the AI studies the sample to learn the field structure (price, beds, year built, etc.) so it knows what to extract from your clients' future property uploads. The sample itself isn't shown to buyers.",
        ],
      },
    },
    {
      n: 5,
      icon: Users,
      title: "Invite Your Clients",
      blurb: "Send invites so clients can build tours under your brand.",
      bullets: [
        "Enter their email",
        "We send a branded invitation",
        "They sign up and start building",
      ],
      cta: { label: "Invite Clients", to: "/dashboard/clients" },
      done: status.invitedCount > 0,
      progress:
        status.invitedCount > 0
          ? `${status.invitedCount} invited`
          : undefined,
      howTo: {
        title: "Inviting clients",
        steps: [
          "Click Invite Client and enter their email address.",
          "They get an email branded with your studio name and colors.",
          "When they accept, they land in your Builder under your brand.",
          "You can resend or revoke invites anytime.",
        ],
      },
    },
    {
      n: 6,
      icon: ShoppingCart,
      title: "Track Orders & Get Paid",
      blurb: "Watch orders come in and payouts land in your bank.",
      bullets: [
        "See every client purchase",
        "Mark orders as fulfilled",
        "Review payout history",
      ],
      cta: { label: "View Orders", to: "/dashboard/orders" },
      done: status.orderCount > 0,
      progress:
        status.orderCount > 0
          ? `${status.orderCount} orders`
          : undefined,
      howTo: {
        title: "Tracking orders & payouts",
        steps: [
          "Every paid presentation shows up in Orders.",
          "Mark each as fulfilled when you've delivered the tour.",
          "Open Payouts to see what's been transferred to your bank.",
          "Standard payouts arrive in 2 business days.",
        ],
      },
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      {/* Welcome strip */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Welcome,{" "}
            <span style={{ color: accent }}>{brandName}</span>
          </h1>
          <p className="mt-1 text-muted-foreground">
            A quick guide to launch your branded studio in minutes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="capitalize"
            style={{ borderColor: accent, color: accent }}
          >
            {tier} plan
          </Badge>
          {slug ? (
            <a
              href={`/p/${slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
            >
              <Eye className="size-3" /> View your portal
            </a>
          ) : null}
        </div>
      </header>

      {/* Quick Start */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="size-5" style={{ color: accent }} />
          <h2 className="text-xl font-semibold tracking-tight">
            Quick Start — 6 steps to launch
          </h2>
        </div>

        <div className="relative space-y-4">
          {/* Vertical connector */}
          <div
            aria-hidden
            className="absolute left-[27px] top-2 bottom-2 hidden w-px sm:block"
            style={{ backgroundColor: `${accent}33` }}
          />
          {steps.map((step) => (
            <StepCard key={step.n} step={step} accent={accent} loaded={loaded} />
          ))}
        </div>
      </section>

      {/* Pro Tips */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="size-5 text-amber-500" />
          <h2 className="text-xl font-semibold tracking-tight">Pro tips</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <TipCard
            icon={Eye}
            title="Preview before you publish"
            body="Use Demo Mode to see exactly what your clients will see — with sample tours and your branding."
          />
          <TipCard
            icon={Palette}
            title="Your accent color is everywhere"
            body="It tints buttons, links, and the View Demo CTA across your portal — pick something that pops."
          />
          <TipCard
            icon={Bot}
            title="Pro adds AI lead capture"
            body="Upgrade to let your clients capture buyer info automatically while they tour."
          />
        </div>
      </section>

      {/* FAQ */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <HelpCircle className="size-5" style={{ color: accent }} />
          <h2 className="text-xl font-semibold tracking-tight">
            Frequently asked questions
          </h2>
        </div>
        <Card>
          <CardContent className="p-2 sm:p-4">
            <Accordion type="single" collapsible className="w-full">
              <FaqItem
                value="q1"
                q="What's the difference between Starter and Pro?"
                a={
                  <>
                    Starter gives you branding, client invites, pricing, and
                    payouts. Pro adds the Vault (reusable audio, widgets,
                    icons, and property docs) plus AI-powered lead capture.{" "}
                    <Link
                      to="/dashboard/upgrade"
                      className="text-primary underline"
                    >
                      Compare plans
                    </Link>
                    .
                  </>
                }
              />
              <FaqItem
                value="q2"
                q="Can I change my brand colors after my clients start building?"
                a="Yes. Update colors anytime in Branding — your portal and your clients' tours pick up the new look immediately."
              />
              <FaqItem
                value="q3"
                q="How do my clients pay me?"
                a="Clients pay through your portal at checkout. Once you've connected Payouts, the money goes straight to your bank — no invoicing, no chasing."
              />
              <FaqItem
                value="q4"
                q="What is the Vault and do I need it?"
                a="The Vault is a Pro library of reusable assets — spatial audio, custom icons, interactive widgets, and property docs. Your clients drop them into any tour. It's optional but saves a lot of setup time."
              />
              <FaqItem
                value="q5"
                q="How do invitations work?"
                a={
                  <>
                    Enter a client's email in{" "}
                    <Link
                      to="/dashboard/clients"
                      className="text-primary underline"
                    >
                      Clients
                    </Link>
                    . They get a branded email, sign up, and land in your
                    Builder. Invites expire in 7 days and can be resent.
                  </>
                }
              />
              <FaqItem
                value="q6"
                q='What does "Demo Mode" do?'
                a={
                  <>
                    <Link
                      to="/dashboard/demo"
                      className="text-primary underline"
                    >
                      Demo Mode
                    </Link>{" "}
                    publishes a sample tour to your portal so prospects can
                    experience your studio without you needing real client
                    work yet.
                  </>
                }
              />
              <FaqItem
                value="q7"
                q="Can I use my own domain?"
                a="Yes. Pro plans support a custom domain (e.g. tours.yourstudio.com). Add it in Branding and we'll guide you through DNS."
              />
              <FaqItem
                value="q8"
                q="How do I get help?"
                a={
                  <>
                    Email us at{" "}
                    <a
                      href="mailto:support@matterport-hud-builder.lovable.app"
                      className="text-primary underline"
                    >
                      support
                    </a>{" "}
                    or open Demo Mode to see how everything fits together.
                  </>
                }
              />
            </Accordion>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

type StepDef = {
  n: number;
  icon: typeof Palette;
  title: string;
  blurb: string;
  bullets: string[];
  cta: { label: string; to: string };
  done: boolean;
  locked?: boolean;
  lockedNote?: string;
  progress?: string;
  howTo: { title: string; steps: string[] };
};

function StepCard({
  step,
  accent,
  loaded,
}: {
  step: StepDef;
  accent: string;
  loaded: boolean;
}) {
  const Icon = step.icon;
  const dimmed = step.locked;
  return (
    <Card
      className={`relative overflow-hidden border-l-4 transition-shadow hover:shadow-md ${
        dimmed ? "opacity-70" : ""
      }`}
      style={{ borderLeftColor: accent }}
    >
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        {/* Numbered badge */}
        <div
          className="relative z-10 flex size-12 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white shadow-sm"
          style={{ backgroundColor: accent }}
        >
          {step.n}
        </div>

        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Icon className="size-4 text-muted-foreground" />
            <h3 className="text-base font-semibold text-foreground">
              {step.title}
            </h3>
            {loaded && step.done && (
              <Badge className="gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300">
                <Check className="size-3" /> Done
              </Badge>
            )}
            {!step.done && step.progress && (
              <Badge variant="secondary" className="text-xs">
                {step.progress}
              </Badge>
            )}
            {step.locked && (
              <Badge variant="outline" className="gap-1 text-xs">
                <Lock className="size-3" /> {step.lockedNote ?? "Locked"}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{step.blurb}</p>
          <ul className="space-y-1 text-sm text-foreground/80">
            {step.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2">
                <span
                  className="mt-1.5 size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: accent }}
                />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            {step.locked ? (
              <Button asChild size="sm" variant="outline">
                <Link to="/dashboard/upgrade">
                  Upgrade to Pro <ArrowRight className="size-3" />
                </Link>
              </Button>
            ) : (
              <Button
                asChild
                size="sm"
                style={{ backgroundColor: accent, color: "#fff" }}
                className="hover:opacity-90"
              >
                <Link to={step.cta.to}>
                  {step.cta.label} <ArrowRight className="size-3" />
                </Link>
              </Button>
            )}

            <ShowMeHowDialog
              title={step.howTo.title}
              steps={step.howTo.steps}
              ctaTo={step.locked ? "/dashboard/upgrade" : step.cta.to}
              ctaLabel={
                step.locked ? "See pricing" : `Go to ${step.title}`
              }
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ShowMeHowDialog({
  title,
  steps,
  ctaTo,
  ctaLabel,
}: {
  title: string;
  steps: string[];
  ctaTo: string;
  ctaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1">
          <HelpCircle className="size-3" /> Show me how
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            A quick walkthrough — no jargon, just the steps.
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-3 py-2">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <span className="pt-0.5 text-foreground/90">{s}</span>
            </li>
          ))}
        </ol>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button asChild onClick={() => setOpen(false)}>
            <Link to={ctaTo}>
              {ctaLabel} <ArrowRight className="size-3" />
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TipCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Palette;
  title: string;
  body: string;
}) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}

function FaqItem({
  value,
  q,
  a,
}: {
  value: string;
  q: string;
  a: React.ReactNode;
}) {
  return (
    <AccordionItem value={value}>
      <AccordionTrigger className="text-left text-sm font-medium">
        {q}
      </AccordionTrigger>
      <AccordionContent className="text-sm text-muted-foreground">
        {a}
      </AccordionContent>
    </AccordionItem>
  );
}
