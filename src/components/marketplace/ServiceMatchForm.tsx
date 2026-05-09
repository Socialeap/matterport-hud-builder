import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type MarketplaceSpecialty = Database["public"]["Enums"]["marketplace_specialty"];

const ZIP_RE = /^\d{5}(-\d{4})?$/;
const STATE_RE = /^[A-Z]{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CONSENT_TEXT =
  "I'm requesting an MSP Service Match. I agree to receive my match results by email and understand that, only if I explicitly notify a matched studio, my contact details will be shared with that studio.";

interface Props {
  defaultCity?: string;
  defaultRegion?: string;
  defaultZip?: string;
  essentialServices: MarketplaceSpecialty[];
  preferableServices: MarketplaceSpecialty[];
  onSuccess?: (matchToken?: string) => void;
}

export function ServiceMatchForm({
  defaultCity = "",
  defaultRegion = "",
  defaultZip = "",
  essentialServices,
  preferableServices,
  onSuccess,
}: Props) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [brokerage, setBrokerage] = useState("");
  const [city, setCity] = useState(defaultCity);
  const [region, setRegion] = useState(defaultRegion);
  const [zip, setZip] = useState(defaultZip);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ matchToken?: string } | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return toast.error("Please enter a valid email");
    if (city.trim().length < 2) return toast.error("Please enter your city");
    if (region && !STATE_RE.test(region.trim().toUpperCase())) return toast.error("State must be 2 letters");
    const zipTrim = zip.trim();
    if (zipTrim && !ZIP_RE.test(zipTrim)) return toast.error("ZIP must be 5 digits (or 5+4)");
    if (essentialServices.length === 0 && preferableServices.length === 0) {
      return toast.error("Mark at least one service Essential or Preferable");
    }
    if (!consent) return toast.error("Please confirm consent");

    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("capture-service-match", {
      body: {
        email: email.trim(),
        name: name.trim() || undefined,
        brokerage: brokerage.trim() || undefined,
        city: city.trim(),
        region: region.trim().toUpperCase() || undefined,
        zip: zipTrim || undefined,
        consent_given: true,
        consent_text: CONSENT_TEXT,
        essential_services: essentialServices,
        preferable_services: preferableServices,
      },
    });
    setSubmitting(false);

    if (error) return toast.error("Could not submit. Please try again shortly.");
    const matchToken = (data as { match_token?: string })?.match_token;
    setSubmitted({ matchToken });
    toast.success("Your MSP Service Match is on its way");
    onSuccess?.(matchToken);
  };

  if (submitted) {
    const url = submitted.matchToken
      ? `${window.location.origin}/agents/match/${submitted.matchToken}`
      : null;
    return (
      <div className="rounded-lg border border-emerald-300/30 bg-emerald-300/5 p-6 text-center">
        <p className="text-sm font-semibold text-emerald-200">Match request received.</p>
        <p className="mt-1 text-xs text-white/60">
          We've emailed your match link. {url && "You can also open it directly:"}
        </p>
        {url && (
          <a href={url} className="mt-3 inline-block break-all text-xs text-cyan-300 underline">
            {url}
          </a>
        )}
      </div>
    );
  }

  const inputClass = "border-white/10 bg-white/5 text-white placeholder:text-white/40";
  const labelClass = "text-white/80";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-md border border-cyan-300/20 bg-cyan-300/5 p-3 text-xs text-white/70">
        <p className="mb-1 font-semibold text-white/90">Your service preferences</p>
        {essentialServices.length > 0 && (
          <p><span className="text-amber-200">Essential:</span> {essentialServices.length}</p>
        )}
        {preferableServices.length > 0 && (
          <p><span className="text-cyan-200">Preferable:</span> {preferableServices.length}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="sm_email" className={labelClass}>Email <span className="text-red-400">*</span></Label>
          <Input id="sm_email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="you@brokerage.com" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sm_name" className={labelClass}>Your Name</Label>
          <Input id="sm_name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Optional" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sm_brokerage" className={labelClass}>Brokerage</Label>
        <Input id="sm_brokerage" value={brokerage} onChange={(e) => setBrokerage(e.target.value)} className={inputClass} placeholder="Optional" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_100px_140px]">
        <div className="space-y-1.5">
          <Label htmlFor="sm_city" className={labelClass}>City <span className="text-red-400">*</span></Label>
          <Input id="sm_city" required value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} placeholder="Atlanta" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sm_region" className={labelClass}>State</Label>
          <Input id="sm_region" maxLength={2} value={region} onChange={(e) => setRegion(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} className={inputClass} placeholder="GA" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sm_zip" className={labelClass}>ZIP</Label>
          <Input id="sm_zip" value={zip} onChange={(e) => setZip(e.target.value)} className={inputClass} placeholder="30303" />
        </div>
      </div>

      <label className="flex items-start gap-2.5 rounded-md border border-white/10 bg-white/5 p-3 text-xs leading-relaxed text-white/70">
        <Checkbox
          checked={consent}
          onCheckedChange={(v) => setConsent(v === true)}
          className="mt-0.5 border-white/30 data-[state=checked]:bg-cyan-400 data-[state=checked]:text-[#0a0e27]"
        />
        <span>{CONSENT_TEXT}</span>
      </label>

      <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
        {submitting ? "Creating match…" : "Create MSP Service Match"}
      </Button>
    </form>
  );
}
