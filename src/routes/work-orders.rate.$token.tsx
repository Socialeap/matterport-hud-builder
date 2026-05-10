import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/work-orders/rate/$token")({
  head: () => ({
    meta: [
      { title: "Rate this MSP — 3DPS Marketplace" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RatePage,
});

interface RatingMeta {
  msp_brand_name: string;
  completion_at: string | null;
  already_submitted: boolean;
}

function RatePage() {
  const { token } = Route.useParams();
  const [meta, setMeta] = useState<RatingMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [stars, setStars] = useState<number>(0);
  const [hoverStars, setHoverStars] = useState<number>(0);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("lookup_work_order_rating_by_token", {
        p_rating_token: token,
      });
      if (cancelled) return;
      setLoading(false);
      const row = Array.isArray(data) ? data[0] : null;
      if (error || !row) {
        setMeta(null);
        return;
      }
      setMeta(row as RatingMeta);
      if (row.already_submitted) setSubmitted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async () => {
    if (stars < 1 || stars > 5) {
      toast.error("Pick a rating from 1 to 5 stars.");
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("submit_work_order_rating", {
      p_rating_token: token,
      p_stars: stars,
      p_feedback: feedback.trim() || undefined,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message || "Could not submit your rating.");
      return;
    }
    if (data === false) {
      toast.error("Rating link is invalid or expired.");
      return;
    }
    setSubmitted(true);
    toast.success("Thanks for your feedback!");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" /> Loading…
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="mx-auto max-w-md p-12 text-center">
        <h1 className="text-xl font-semibold">Rating link invalid</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This rating link is invalid or has expired.
        </p>
        <Link to="/" className="mt-4 inline-block">
          <Button variant="outline" size="sm">Back to homepage</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card>
        <CardContent className="space-y-5 p-6 sm:p-8">
          <header className="text-center">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Rate your MSP
            </p>
            <h1 className="mt-1 text-2xl font-semibold">{meta.msp_brand_name}</h1>
            {meta.completion_at && (
              <p className="mt-1 text-xs text-muted-foreground">
                Job marked complete{" "}
                {new Date(meta.completion_at).toLocaleDateString(undefined, {
                  dateStyle: "medium",
                })}
              </p>
            )}
          </header>

          {submitted ? (
            <div className="rounded-md border border-emerald-300/30 bg-emerald-300/5 p-5 text-center">
              <p className="text-base font-semibold text-emerald-700 dark:text-emerald-300">
                Thanks for rating!
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Your feedback helps future agents pick the right partner.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-center gap-2">
                {[1, 2, 3, 4, 5].map((n) => {
                  const filled = (hoverStars || stars) >= n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onMouseEnter={() => setHoverStars(n)}
                      onMouseLeave={() => setHoverStars(0)}
                      onClick={() => setStars(n)}
                      aria-label={`${n} star${n === 1 ? "" : "s"}`}
                      className="rounded p-1 transition-colors"
                    >
                      <Star
                        className={`size-9 ${
                          filled
                            ? "fill-amber-400 text-amber-500"
                            : "text-muted-foreground/40"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
              {stars > 0 && (
                <p className="text-center text-sm text-muted-foreground">
                  {stars} star{stars === 1 ? "" : "s"} —{" "}
                  {stars >= 4
                    ? "Great experience"
                    : stars === 3
                      ? "OK"
                      : "Could be better"}
                </p>
              )}

              <div className="space-y-1.5">
                <label htmlFor="rating-feedback" className="text-xs uppercase tracking-wider text-muted-foreground">
                  Feedback (optional)
                </label>
                <Textarea
                  id="rating-feedback"
                  rows={4}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  maxLength={2000}
                  placeholder="What stood out? Anything that could've been better?"
                />
              </div>

              <Button
                onClick={handleSubmit}
                disabled={submitting || stars === 0}
                className="w-full"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-1 size-4 animate-spin" /> Submitting…
                  </>
                ) : (
                  "Submit rating"
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Powered by 3DPS Marketplace
      </p>
    </div>
  );
}
