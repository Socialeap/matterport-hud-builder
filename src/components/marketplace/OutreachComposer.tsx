/**
 * Modal composer for the in-dashboard outreach send flow.
 *
 * The Pro sees a pre-filled, 3DPS-vetted template that they can edit
 * before sending. Submitting calls send_marketplace_outreach which:
 *   - validates the caller currently holds the exclusive
 *   - inserts the marketplace_outreach row (one per beacon/provider)
 *   - stamps agent_beacons.contacted_at = now()
 *   - bumps responsiveness score +0.10
 *   - enqueues the marketplace-outreach email
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface OutreachComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beaconId: string;
  agentName: string | null;
  agentCity: string;
  agentRegion: string | null;
  /** Called after a successful send so the parent can refetch / move
   * the lead into the Awaiting bucket. */
  onSent: () => void;
}

const DEFAULT_SUBJECT = (city: string) =>
  `A custom 3D presentation studio for your ${city} listings`;

const DEFAULT_BODY = (agentName: string | null) =>
  `Hi ${agentName ? agentName : "there"},

Thanks for joining the 3DPS Marketplace. I'm a local Pro Partner — I deliver Matterport scans plus a branded interactive presentation studio (custom portal, AI Concierge, lead capture) for the listings you take to market.

A few quick examples of what I can do:
  - Same-day scan turnaround when you need a fast comp on a hot listing
  - Branded interactive tour that lives at a permanent URL you can share with buyers
  - Embedded lead-capture so the seller sees who walked through the property

Happy to chat. If a quick walkthrough of a recent property sounds useful, just reply with a time that works.`;

export function OutreachComposer({
  open,
  onOpenChange,
  beaconId,
  agentName,
  agentCity,
  agentRegion,
  onSent,
}: OutreachComposerProps) {
  const cityLabel = agentRegion ? `${agentCity}, ${agentRegion}` : agentCity;

  const [subject, setSubject] = useState(() => DEFAULT_SUBJECT(cityLabel));
  const [body, setBody] = useState(() => DEFAULT_BODY(agentName));
  const [sending, setSending] = useState(false);

  // Reset to fresh defaults each time we re-open the dialog for a
  // different lead. (The parent re-mounts the component per
  // beaconId in practice, but be defensive.)
  useEffect(() => {
    if (open) {
      setSubject(DEFAULT_SUBJECT(cityLabel));
      setBody(DEFAULT_BODY(agentName));
    }
  }, [open, agentName, cityLabel]);

  const send = async () => {
    if (subject.trim().length < 3) {
      toast.error("Subject is too short");
      return;
    }
    if (body.trim().length < 20) {
      toast.error("Message is too short");
      return;
    }
    setSending(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc(
      "send_marketplace_outreach",
      {
        p_beacon_id: beaconId,
        p_subject: subject,
        p_body: body,
      },
    );
    setSending(false);
    if (error) {
      toast.error(
        error.message?.includes("already")
          ? "You've already sent outreach for this lead."
          : "Could not send outreach. Please try again.",
      );
      return;
    }
    toast.success("Outreach sent — moved to Awaiting Response");
    onOpenChange(false);
    onSent();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compose Marketplace Outreach</DialogTitle>
          <DialogDescription>
            We send this email through 3DPS so the agent can flag
            inappropriate outreach with one click. You can edit the
            template — be specific about your local market.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="outreach-subject">Subject</Label>
            <Input
              id="outreach-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="outreach-body">Message</Label>
            <Textarea
              id="outreach-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              maxLength={10000}
            />
            <p className="text-xs text-muted-foreground">
              Plain text. Paragraphs render with blank-line separation.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={send} disabled={sending}>
            {sending ? "Sending…" : "Send via 3DPS"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OutreachComposer;
