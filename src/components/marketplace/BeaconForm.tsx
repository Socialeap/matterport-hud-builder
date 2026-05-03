import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const ZIP_RE = /^\d{5}(-\d{4})?$/;
const STATE_RE = /^[A-Z]{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The exact text the agent sees and consents to. We send this string
// to the server so the consent record is evidenced (not just a boolean).
const CONSENT_TEXT =
  "I agree to be contacted by email when a 3D Presentation Studio Pro Partner becomes active in my area. I understand my contact info may be shared with that local Pro Partner.";

interface BeaconFormProps {
  /** Pre-fill the city field (e.g. when triggered from a search). */
  defaultCity?: string;
  /** Pre-fill the state field. */
  defaultRegion?: string;
  /** Pre-fill the zip field (e.g. when triggered from a zip search). */
  defaultZip?: string;
  /** Visual variant. "dark" matches the /agents page and /opportunities. */
  variant?: "dark" | "light";
  /** Called once the beacon submission has succeeded. */
  onSuccess?: () => void;
}

export function BeaconForm({
  defaultCity = "",
  defaultRegion = "",
  defaultZip = "",
  variant = "dark",
  onSuccess,
}: BeaconFormProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [brokerage, setBrokerage] = useState("");
  const [city, setCity] = useState(defaultCity);
  const [region, setRegion] = useState(defaultRegion);
  const [zip, setZip] = useState(defaultZip);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const inputClass =
    variant === "dark"
      ? "border-white/10 bg-white/5 text-white placeholder:text-white/40"
      : "";

  const labelClass =
    variant === "dark" ? "text-white/80" : "text-foreground";

  const helperClass =
    variant === "dark" ? "text-white/50" : "text-muted-foreground";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!EMAIL_RE.test(email.trim())) {
      toast.error("Please enter a valid email");
      return;
    }
    if (city.trim().length < 2) {
      toast.error("Please enter your city");
      return;
    }
    if (!STATE_RE.test(region.trim().toUpperCase())) {
      toast.error("Please enter a 2-letter state code (e.g. GA)");
      return;
    }
    const zipTrim = zip.trim();
    if (zipTrim && !ZIP_RE.test(zipTrim)) {
      toast.error("ZIP must be 5 digits (or 5+4)");
      return;
    }
    if (!consent) {
      toast.error("Please confirm consent to be contacted");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.functions.invoke("capture-beacon", {
      body: {
        email: email.trim(),
        name: name.trim() || undefined,
        brokerage: brokerage.trim() || undefined,
        city: city.trim(),
        region: region.trim().toUpperCase(),
        zip: zipTrim || undefined,
        consent_given: true,
        consent_text: CONSENT_TEXT,
      },
    });
    setSubmitting(false);

    if (error) {
      toast.error("Could not submit. Please try again shortly.");
      return;
    }

    setSubmitted(true);
    toast.success("You're on the list");
    onSuccess?.();
  };

  if (submitted) {
    return (
      <div
        className={
          variant === "dark"
            ? "rounded-lg border border-emerald-300/30 bg-emerald-300/5 p-6 text-center"
            : "rounded-lg border border-emerald-500/30 bg-emerald-50 p-6 text-center"
        }
      >
        <p
          className={`text-sm font-semibold ${variant === "dark" ? "text-emerald-200" : "text-emerald-800"}`}
        >
          You're on the list.
        </p>
        <p className={`mt-1 text-xs ${helperClass}`}>
          We'll email you the moment a Pro Partner activates in your area.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="beacon_email" className={labelClass}>
            Email <span className="text-red-400">*</span>
          </Label>
          <Input
            id="beacon_email"
            type="email"
            required
            placeholder="you@brokerage.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="beacon_name" className={labelClass}>
            Your Name
          </Label>
          <Input
            id="beacon_name"
            placeholder="Optional"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="beacon_brokerage" className={labelClass}>
          Brokerage
        </Label>
        <Input
          id="beacon_brokerage"
          placeholder="Optional"
          value={brokerage}
          onChange={(e) => setBrokerage(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_100px_140px]">
        <div className="space-y-1.5">
          <Label htmlFor="beacon_city" className={labelClass}>
            City <span className="text-red-400">*</span>
          </Label>
          <Input
            id="beacon_city"
            required
            placeholder="Atlanta"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="beacon_region" className={labelClass}>
            State <span className="text-red-400">*</span>
          </Label>
          <Input
            id="beacon_region"
            required
            maxLength={2}
            placeholder="GA"
            value={region}
            onChange={(e) =>
              setRegion(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))
            }
            className={inputClass}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="beacon_zip" className={labelClass}>
            ZIP
          </Label>
          <Input
            id="beacon_zip"
            placeholder="30303"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <label
        className={`flex items-start gap-2.5 rounded-md border p-3 text-xs leading-relaxed ${
          variant === "dark"
            ? "border-white/10 bg-white/5 text-white/70"
            : "border-border bg-muted/30 text-muted-foreground"
        }`}
      >
        <Checkbox
          checked={consent}
          onCheckedChange={(v) => setConsent(v === true)}
          className={
            variant === "dark"
              ? "mt-0.5 border-white/30 data-[state=checked]:bg-cyan-400 data-[state=checked]:text-[#0a0e27]"
              : "mt-0.5"
          }
        />
        <span>{CONSENT_TEXT}</span>
      </label>

      <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
        {submitting ? "Submitting…" : "Notify me when a Pro Partner is local"}
      </Button>
    </form>
  );
}
