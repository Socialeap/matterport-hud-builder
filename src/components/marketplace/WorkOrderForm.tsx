import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Info, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  calculateBusinessResponseDeadline,
  formatRespondByLabel,
} from "@/lib/marketplace/business-window";

type MarketplaceSpecialty = Database["public"]["Enums"]["marketplace_specialty"];

const SIZE_BANDS = [
  { value: "under_1500", label: "Under 1,500 sqft" },
  { value: "1500_3000", label: "1,500 – 3,000 sqft" },
  { value: "3000_5000", label: "3,000 – 5,000 sqft" },
  { value: "over_5000", label: "Over 5,000 sqft" },
  { value: "unknown", label: "Not sure" },
] as const;

const PROPERTY_TYPES = [
  "Residential",
  "Luxury Residential",
  "Condo / Apartment",
  "Multi-Family",
  "Commercial",
  "Retail",
  "Office",
  "Industrial",
  "New Construction",
  "Vacation Rental / Short-Term Rental",
  "Other",
] as const;

const MIN_LEAD_DAYS = 7;
const WINDOW_LENGTH_DAYS = 7;

interface WorkOrderFormProps {
  matchToken?: string;
  beaconId?: string;
  selectedProviderIds: string[];
  selectedBrandSummary: string;
  city: string;
  region?: string | null;
  zip?: string | null;
  essentialServices: MarketplaceSpecialty[];
  preferableServices: MarketplaceSpecialty[];
  onSuccess: (workOrderId: string) => void;
  onCancel?: () => void;
  /**
   * "direct"   — request availability from a single MSP profile/card.
   * "shortlist" — request availability from a multi-select on /agents/match.
   * Defaults to "shortlist" to preserve existing call-sites.
   */
  variant?: "direct" | "shortlist";
}

function isoDateOnly(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function WorkOrderForm({
  beaconId,
  selectedProviderIds,
  selectedBrandSummary,
  city,
  region,
  zip,
  essentialServices,
  preferableServices,
  onSuccess,
  onCancel,
  variant = "shortlist",
}: WorkOrderFormProps) {
  const today = new Date();
  const minFromDate = addDays(today, MIN_LEAD_DAYS);
  const minFromIso = isoDateOnly(minFromDate);
  const defaultToIso = isoDateOnly(addDays(minFromDate, WINDOW_LENGTH_DAYS));

  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [propertyType, setPropertyType] = useState<string>(PROPERTY_TYPES[0]);
  const [sizeBand, setSizeBand] = useState<string>("unknown");
  const [availableFromDate, setAvailableFromDate] = useState(minFromIso);
  const [availableToDate, setAvailableToDate] = useState(defaultToIso);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const deadlinePreview = useMemo(
    () => formatRespondByLabel(calculateBusinessResponseDeadline()),
    [],
  );

  // Clamp closing date to within WINDOW_LENGTH_DAYS of opening date and never
  // before the opening date.
  const onChangeFromDate = (next: string) => {
    setAvailableFromDate(next);
    const fromDate = new Date(`${next}T00:00:00`);
    if (Number.isNaN(fromDate.getTime())) return;
    const toDate = new Date(`${availableToDate}T00:00:00`);
    const maxTo = addDays(fromDate, WINDOW_LENGTH_DAYS);
    if (
      Number.isNaN(toDate.getTime()) ||
      toDate < fromDate ||
      toDate > maxTo
    ) {
      setAvailableToDate(isoDateOnly(maxTo));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (selectedProviderIds.length === 0) {
      toast.error(
        variant === "direct"
          ? "This studio is unavailable to receive requests right now."
          : "Pick one or more qualified studios to request availability from.",
      );
      return;
    }
    if (addressLine1.trim().length < 4) {
      toast.error("A property address is required to verify the listing.");
      return;
    }
    const fromDate = new Date(`${availableFromDate}T08:00:00`);
    const toDate = new Date(`${availableToDate}T20:00:00`);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      toast.error("Pick a valid scheduling window.");
      return;
    }
    if (toDate <= fromDate) {
      toast.error("Closing date must be after the opening date.");
      return;
    }
    const minLead = addDays(new Date(), MIN_LEAD_DAYS);
    minLead.setHours(0, 0, 0, 0);
    const fromAtMidnight = new Date(`${availableFromDate}T00:00:00`);
    if (fromAtMidnight < minLead) {
      toast.error(`Opening date must be at least ${MIN_LEAD_DAYS} days from today.`);
      return;
    }
    const maxRange = addDays(fromAtMidnight, WINDOW_LENGTH_DAYS);
    const toAtMidnight = new Date(`${availableToDate}T00:00:00`);
    if (toAtMidnight > maxRange) {
      toast.error(`Closing date must be within ${WINDOW_LENGTH_DAYS} days of the opening date.`);
      return;
    }

    setSubmitting(true);
    const { data, error } = await supabase.rpc("submit_work_order", {
      p_selected_provider_ids: selectedProviderIds,
      p_property_type: propertyType,
      p_size_band: sizeBand,
      p_available_from: fromDate.toISOString(),
      p_available_to: toDate.toISOString(),
      p_essential_services: essentialServices,
      p_preferable_services: preferableServices,
      p_address_line1: addressLine1.trim(),
      p_address_line2: addressLine2.trim(),
      p_city: city,
      p_region: region ?? "",
      p_zip: zip ?? "",
      p_lat: undefined,
      p_lng: undefined,
      p_notes: notes.trim() || undefined,
      p_source_beacon_id: beaconId,
    });
    setSubmitting(false);

    if (error) {
      const message = (error.message ?? "").toLowerCase();
      if (message.includes("authentication required")) {
        toast.error("Please sign in to request availability.");
      } else {
        toast.error(error.message || "Could not send your availability request.");
      }
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.work_order_id) {
      toast.error("Could not send your availability request.");
      return;
    }

    const inviteCount = row.invite_count ?? 0;
    if (inviteCount === 0) {
      toast.warning(
        variant === "direct"
          ? "This studio is not currently accepting availability requests through 3DPS."
          : "No qualified studios were eligible to be invited. Try widening your filters.",
      );
    } else {
      toast.success(
        `Availability request sent to ${inviteCount} qualified ${
          inviteCount === 1 ? "studio" : "studios"
        }. We'll alert you when responses come in.`,
      );
    }

    onSuccess(row.work_order_id);
  };

  const headerLabel = variant === "direct"
    ? `Requesting availability from ${selectedBrandSummary || "this MSP"}`
    : `Requesting availability from ${selectedProviderIds.length} qualified ${
        selectedProviderIds.length === 1 ? "studio" : "studios"
      }`;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-md border border-cyan-300/30 bg-cyan-300/5 p-3 text-sm text-cyan-100">
        <p className="font-medium">{headerLabel}</p>
        {variant !== "direct" && selectedBrandSummary && (
          <p className="mt-1 text-cyan-100/70">{selectedBrandSummary}</p>
        )}
        <p className="mt-2 flex items-start gap-1.5 text-xs text-cyan-100/70">
          <Lock className="mt-0.5 size-3 shrink-0" />
          <span>
            Each invited studio is asked to mark <strong>Available</strong> or{" "}
            <strong>Not Available</strong> by the next business window
            ({deadlinePreview}). Your contact info and full property address
            are shared only after you confirm one MSP. Pricing and final
            scheduling are arranged directly with the studio you select.
          </span>
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2 space-y-1.5">
          <Label htmlFor="wo-addr1">Property address</Label>
          <Input
            id="wo-addr1"
            placeholder="Street address (only released after you confirm an MSP)"
            value={addressLine1}
            onChange={(e) => setAddressLine1(e.target.value)}
            maxLength={200}
            required
          />
          <p className="text-[11px] text-muted-foreground">
            We collect the address to verify the listing, but invited MSPs only
            see the city / state / ZIP until you confirm one.
          </p>
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <Label htmlFor="wo-addr2" className="text-xs text-muted-foreground">
            Apt / Suite (optional)
          </Label>
          <Input
            id="wo-addr2"
            value={addressLine2}
            onChange={(e) => setAddressLine2(e.target.value)}
            maxLength={120}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Property type</Label>
          <Select value={propertyType} onValueChange={setPropertyType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROPERTY_TYPES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Approximate size</Label>
          <Select value={sizeBand} onValueChange={setSizeBand}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIZE_BANDS.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="wo-from">Scheduling window opens</Label>
          <Input
            id="wo-from"
            type="date"
            min={minFromIso}
            value={availableFromDate}
            onChange={(e) => onChangeFromDate(e.target.value)}
            required
          />
          <p className="text-[11px] text-muted-foreground">
            At least {MIN_LEAD_DAYS} days from today.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wo-to">Scheduling window closes</Label>
          <Input
            id="wo-to"
            type="date"
            min={availableFromDate}
            max={isoDateOnly(addDays(new Date(`${availableFromDate}T00:00:00`), WINDOW_LENGTH_DAYS))}
            value={availableToDate}
            onChange={(e) => setAvailableToDate(e.target.value)}
            required
          />
          <p className="text-[11px] text-muted-foreground">
            Auto-set to a {WINDOW_LENGTH_DAYS}-day window. Final shoot time is
            arranged with the confirmed MSP.
          </p>
        </div>

        <div className="sm:col-span-2 space-y-1.5">
          <Label htmlFor="wo-notes" className="text-xs text-muted-foreground">
            Notes for the MSP (optional)
          </Label>
          <Textarea
            id="wo-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="e.g. listing comes furnished; basement access via side entry."
          />
          <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" />
            Do not include contact info or private access details yet. Those
            are shared only after you confirm an MSP.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={submitting} className="gap-2">
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Sending…
            </>
          ) : (
            <>Request Availability</>
          )}
        </Button>
      </div>
    </form>
  );
}
