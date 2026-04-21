import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  getInvitationByToken,
  acceptInvitationForUser,
  declineInvitationByToken,
} from "@/lib/portal.functions";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Boxes,
  Building2,
  CheckCircle2,
  Mail,
  ShieldCheck,
  Sparkles,
  XCircle,
  Loader2,
  ArrowRight,
  Users,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/invite/$token")({
  component: InviteAcceptancePage,
  head: () => ({
    meta: [
      { title: "You've been invited — 3D Presentation Studio" },
      { name: "description", content: "Accept your invitation to a 3D Presentation Studio." },
      { name: "robots", content: "noindex" },
    ],
  }),
});

interface InvitationBrand {
  brandName: string;
  accentColor: string;
  hudBgColor: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  slug: string | null;
}

interface InvitationData {
  email: string;
  status: "pending" | "accepted" | "expired" | "declined";
  isFree: boolean;
  expiresAt: string;
  providerId: string;
  brand: InvitationBrand | null;
}

function InviteAcceptancePage() {
  const { token } = Route.useParams();
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const lookupFn = useServerFn(getInvitationByToken);
  const acceptFn = useServerFn(acceptInvitationForUser);
  const declineFn = useServerFn(declineInvitationByToken);

  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState<"accept" | "decline" | null>(null);
  const [localStatus, setLocalStatus] = useState<InvitationData["status"] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    lookupFn({ data: { token } })
      .then((res) => {
        if (cancelled) return;
        if (!res.found || !res.invitation) {
          setNotFound(true);
        } else {
          setInvitation(res.invitation as InvitationData);
          setLocalStatus(res.invitation.status as InvitationData["status"]);
        }
      })
      .catch(() => !cancelled && setNotFound(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [token, lookupFn]);

  // Post-auth auto-finalize: if the invitee returns here already signed in
  // (e.g. after Google OAuth or email verification), automatically accept the
  // invitation and route them into the MSP's Studio. This avoids dumping
  // newly-signed-up clients on the platform landing page.
  useEffect(() => {
    if (authLoading || loading || !user || !invitation) return;
    if (submitting !== null) return;
    if (
      !user.email ||
      user.email.toLowerCase() !== invitation.email.toLowerCase()
    )
      return;

    const status = localStatus ?? invitation.status;

    if (status === "accepted") {
      if (invitation.brand?.slug) {
        navigate({
          to: "/p/$slug",
          params: { slug: invitation.brand.slug },
          replace: true,
        });
      } else {
        navigate({ to: "/dashboard", replace: true });
      }
      return;
    }

    if (
      status === "pending" &&
      new Date(invitation.expiresAt).getTime() > Date.now()
    ) {
      setSubmitting("accept");
      acceptFn({ data: { token } })
        .then((res) => {
          setLocalStatus("accepted");
          if (res.slug) {
            navigate({
              to: "/p/$slug",
              params: { slug: res.slug },
              replace: true,
            });
          } else {
            navigate({ to: "/dashboard", replace: true });
          }
        })
        .catch((err) => {
          toast.error(
            err instanceof Error ? err.message : "Failed to accept invitation",
          );
          setSubmitting(null);
        });
    }
  }, [
    authLoading,
    loading,
    user,
    invitation,
    localStatus,
    submitting,
    token,
    acceptFn,
    navigate,
  ]);

  const brand = invitation?.brand;
  const accent = brand?.accentColor || "#3B82F6";
  const bg = brand?.hudBgColor || "#0f172a";
  const brandName = brand?.brandName?.trim() || "this 3D Presentation Studio";

  const expired = useMemo(() => {
    if (!invitation) return false;
    return new Date(invitation.expiresAt).getTime() <= Date.now();
  }, [invitation]);

  const effectiveStatus: InvitationData["status"] = useMemo(() => {
    if (localStatus && localStatus !== "pending") return localStatus;
    if (expired && localStatus === "pending") return "expired";
    return localStatus ?? "pending";
  }, [localStatus, expired]);

  const handleAccept = async () => {
    if (!invitation) return;

    if (!user) {
      // Send to signup with token + email prefilled. handle_new_user trigger
      // will link them to the MSP and mark invitation accepted.
      navigate({
        to: "/signup",
        search: { token, email: invitation.email },
      });
      return;
    }

    if (user.email && user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      toast.error(
        `This invitation is for ${invitation.email}. You're signed in as ${user.email}.`,
      );
      return;
    }

    setSubmitting("accept");
    try {
      const res = await acceptFn({ data: { token } });
      toast.success(`Welcome to ${brandName}!`);
      if (res.slug) {
        navigate({ to: "/p/$slug", params: { slug: res.slug } });
      } else {
        navigate({ to: "/dashboard" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to accept invitation");
      setSubmitting(null);
    }
  };

  const handleDecline = async () => {
    setSubmitting("decline");
    try {
      const res = await declineFn({ data: { token } });
      if (res.success) {
        setLocalStatus("declined");
        toast.success("Invitation declined");
      } else {
        toast.error("Could not decline — invitation may have already been actioned");
        // Re-fetch to refresh state
        const fresh = await lookupFn({ data: { token } });
        if (fresh.found && fresh.invitation) {
          setInvitation(fresh.invitation as InvitationData);
          setLocalStatus(fresh.invitation.status as InvitationData["status"]);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to decline invitation");
    } finally {
      setSubmitting(null);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !invitation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md space-y-4 p-8 text-center">
          <XCircle className="mx-auto h-12 w-12 text-muted-foreground" />
          <h1 className="text-xl font-bold">Invitation not found</h1>
          <p className="text-sm text-muted-foreground">
            This invitation link is invalid or no longer active. Please request a new one from your provider.
          </p>
          <Button variant="outline" onClick={() => navigate({ to: "/" })}>
            Go home
          </Button>
        </Card>
      </div>
    );
  }

  const isPending = effectiveStatus === "pending";
  const isAccepted = effectiveStatus === "accepted";
  const isDeclined = effectiveStatus === "declined";
  const isExpired = effectiveStatus === "expired";

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background: `linear-gradient(135deg, ${bg} 0%, ${bg}cc 100%)`,
      }}
    >
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
        {/* Hero */}
        <header className="mb-8 flex flex-col items-center text-center">
          {brand?.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt={brand.brandName || "Studio logo"}
              className="mb-4 h-16 w-auto max-w-[220px] object-contain"
              loading="eager"
            />
          ) : (
            <div
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{ background: accent }}
            >
              <Boxes className="h-8 w-8 text-white" />
            </div>
          )}
          <p className="text-sm font-medium uppercase tracking-wider text-white/60">
            You've been invited
          </p>
          <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
            Welcome to {brandName}'s
            <br />
            3D Presentation Studio
          </h1>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs text-white/90 backdrop-blur">
              <Mail className="h-3.5 w-3.5" />
              {invitation.email}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                invitation.isFree
                  ? "bg-emerald-500 text-white"
                  : "bg-white/15 text-white backdrop-blur"
              }`}
            >
              {invitation.isFree ? (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Free — no charge for your Presentation
                </>
              ) : (
                <>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Pay on download
                </>
              )}
            </span>
          </div>
        </header>

        {/* What this is */}
        <Card className="mb-6 overflow-hidden border-0 bg-white/95 p-0 shadow-2xl backdrop-blur">
          <div className="space-y-6 p-6 sm:p-8">
            <div>
              <h2 className="text-lg font-bold text-foreground">
                What is a 3D Presentation Studio?
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                A modern way to turn your Matterport tours into beautifully branded,
                shareable 3D presentations. Build them once, share them anywhere — on
                listings, in social posts, in email signatures, or as a polished link
                you hand to clients.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FeatureRow
                icon={<Building2 className="h-5 w-5" />}
                title="Branded for you"
                description="Your colors, logo, and styling carry across every Presentation."
                accent={accent}
              />
              <FeatureRow
                icon={<Users className="h-5 w-5" />}
                title="Built-in lead capture"
                description="Convert tour viewers into qualified prospects, automatically."
                accent={accent}
              />
              <FeatureRow
                icon={<Sparkles className="h-5 w-5" />}
                title="Interactive widgets"
                description="Music, cinematic intros, neighborhood maps, document Q&A — all included."
                accent={accent}
              />
              <FeatureRow
                icon={<ShieldCheck className="h-5 w-5" />}
                title="Yours to keep"
                description="Each Presentation is a self-contained file you can host anywhere."
                accent={accent}
              />
            </div>
          </div>

          {/* Action area */}
          <div className="border-t bg-muted/40 p-6 sm:p-8">
            {isPending && (
              <PendingActions
                accent={accent}
                expiresAt={invitation.expiresAt}
                isFree={invitation.isFree}
                isSignedIn={!!user}
                signedInEmail={user?.email ?? null}
                invitedEmail={invitation.email}
                submitting={submitting}
                onAccept={handleAccept}
                onDecline={handleDecline}
              />
            )}

            {isAccepted && (
              <ResultPanel
                tone="success"
                title="You've already accepted this invitation"
                description={`You're all set. Head to the ${brandName} Studio to start building your Presentation.`}
                action={
                  brand?.slug ? (
                    <Button
                      style={{ background: accent, color: "white" }}
                      onClick={() => navigate({ to: "/p/$slug", params: { slug: brand.slug! } })}
                    >
                      Open the Studio <ArrowRight className="ml-1 h-4 w-4" />
                    </Button>
                  ) : null
                }
              />
            )}

            {isDeclined && (
              <ResultPanel
                tone="neutral"
                title="Invitation declined"
                description="No problem — if you change your mind, just contact your provider for a new invite."
              />
            )}

            {isExpired && (
              <ResultPanel
                tone="warning"
                title="This invitation has expired"
                description={`Please contact ${brandName} for a fresh invitation link.`}
              />
            )}
          </div>
        </Card>

        <p className="text-center text-xs text-white/50">
          Powered by 3D Presentation Studio
          {brand?.slug ? ` · ${brand.slug}` : ""}
        </p>
      </div>
    </div>
  );

  // Stop unused-var lint on router/supabase imports kept for future hooks.
  void router;
  void supabase;
}

function FeatureRow({
  icon,
  title,
  description,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  accent: string;
}) {
  return (
    <div className="flex gap-3">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
        style={{ background: accent }}
      >
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function PendingActions({
  accent,
  expiresAt,
  isFree,
  isSignedIn,
  signedInEmail,
  invitedEmail,
  submitting,
  onAccept,
  onDecline,
}: {
  accent: string;
  expiresAt: string;
  isFree: boolean;
  isSignedIn: boolean;
  signedInEmail: string | null;
  invitedEmail: string;
  submitting: "accept" | "decline" | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const wrongAccount =
    isSignedIn && signedInEmail && signedInEmail.toLowerCase() !== invitedEmail.toLowerCase();
  const expiresHuman = new Date(expiresAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-sm text-foreground">
          Ready to get started? {isFree ? "There's no charge to you." : "You'll be billed at download."}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          This invitation expires on {expiresHuman}
        </p>
      </div>

      {wrongAccount && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          You're signed in as <strong>{signedInEmail}</strong>, but this invitation is for{" "}
          <strong>{invitedEmail}</strong>. Please sign out and accept while signed in as the invited email — or while signed out.
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button
          size="lg"
          onClick={onAccept}
          disabled={submitting !== null || !!wrongAccount}
          style={{ background: accent, color: "white" }}
          className="min-w-[180px]"
        >
          {submitting === "accept" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4" />
              Accept invitation
            </>
          )}
        </Button>
        <Button
          size="lg"
          variant="outline"
          onClick={onDecline}
          disabled={submitting !== null}
          className="min-w-[140px]"
        >
          {submitting === "decline" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Decline"
          )}
        </Button>
      </div>
    </div>
  );
}

function ResultPanel({
  tone,
  title,
  description,
  action,
}: {
  tone: "success" | "neutral" | "warning";
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "warning" ? XCircle : Mail;
  const iconClass =
    tone === "success"
      ? "text-emerald-500"
      : tone === "warning"
        ? "text-amber-500"
        : "text-muted-foreground";
  return (
    <div className="space-y-3 text-center">
      <Icon className={`mx-auto h-10 w-10 ${iconClass}`} />
      <h3 className="text-base font-bold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
