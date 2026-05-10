import { useState, type FormEvent } from "react";
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
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

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
  "Commercial",
  "Industrial",
  "New Construction",
  "Multi-Family",
  "Vacation Rental",
  "Other",
] as const;

interface WorkOrderFormProps {
  matchToken: string;
  beaconId: string;
  selectedProviderIds: string[];
  selectedBrandSummary: string;
  city: string;
  region?: string | null;
  zip?: string | null;
  essentialServices: MarketplaceSpecialty[];
  preferableServices: MarketplaceSpecialty[];
  onSuccess: (workOrderId: string) => void;
  onCancel?: () => void;
}

function formatLocalIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
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
}: WorkOrderFormProps) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const tomorrowEnd = new Date(Date.now() + 32 * 60 * 60 * 1000);

  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [propertyType, setPropertyType] = useState<string>(PROPERTY_TYPES[0]);
  const [sizeBand, setSizeBand] = useState<string>("unknown");
  const [availableFrom, setAvailableFrom] = useState(formatLocalIso(tomorrow));
  const [availableTo, setAvailableTo] = useState(formatLocalIso(tomorrowEnd));
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (selectedProviderIds.length === 0) {
      toast.error("Select at least one MSP from the directory.");
      return;
    }
    if (addressLine1.trim().length < 4) {
      toast.error("Property address is required.");
      return;
    }
    const fromDate = new Date(availableFrom);
    const toDate = new Date(availableTo);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      toast.error("Pick valid available-from and available-to times.");
      return;
    }
    if (toDate <= fromDate) {
      toast.error("Available-to must be after available-from.");
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
        toast.error("Please sign in to submit a work order.");
      } else {
        toast.error(error.message || "Could not submit the work order.");
      }
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.work_order_id) {
      toast.error("Could not submit the work order.");
      return;
    }

    const inviteCount = row.invite_count ?? 0;
    if (inviteCount === 0) {
      toast.warning(
        "No MSPs were eligible to be invited. Try expanding your shortlist.",
      );
    } else {
      toast.success(
        `Work order sent to ${inviteCount} MSP${inviteCount === 1 ? "" : "s"}. ` +
        `They have 3 hours to respond.`,
      );
    }

    onSuccess(row.work_order_id);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-md border border-cyan-300/30 bg-cyan-300/5 p-3 text-sm text-cyan-100">
        <p className="font-medium">
          Sending Work Order to {selectedProviderIds.length}{" "}
          {selectedProviderIds.length === 1 ? "MSP" : "MSPs"}
        </p>
        <p className="mt-1 text-cyan-100/70">{selectedBrandSummary}</p>
        <p className="mt-2 text-xs text-cyan-100/60">
          Each invited MSP has 3 hours to respond <strong>Available</strong> or{" "}
          <strong>Not Available</strong>. Your contact info and full address are
          NOT shared until you confirm one MSP.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2 space-y-1.5">
          <Label htmlFor="wo-addr1">Property address</Label>
          <Input
            id="wo-addr1"
            placeholder="Street address"
            value={addressLine1}
            onChange={(e) => setAddressLine1(e.target.value)}
            maxLength={200}
            required
          />
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
          <Label htmlFor="wo-from">Available from</Label>
          <Input
            id="wo-from"
            type="datetime-local"
            value={availableFrom}
            onChange={(e) => setAvailableFrom(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wo-to">Available to</Label>
          <Input
            id="wo-to"
            type="datetime-local"
            value={availableTo}
            onChange={(e) => setAvailableTo(e.target.value)}
            required
          />
        </div>

        <div className="sm:col-span-2 space-y-1.5">
          <Label htmlFor="wo-notes" className="text-xs text-muted-foreground">
            Notes for the MSP (optional, no contact info)
          </Label>
          <Textarea
            id="wo-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            rows={3}
          />
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
              <Loader2 className="size-4 animate-spin" /> Submitting…
            </>
          ) : (
            <>Send Work Order</>
          )}
        </Button>
      </div>
    </form>
  );
}
