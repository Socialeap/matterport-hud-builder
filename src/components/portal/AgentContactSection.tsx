import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserCircle, BarChart3 } from "lucide-react";
import type { AgentContact } from "./types";

interface AgentContactSectionProps {
  agent: AgentContact;
  onChange: (field: keyof AgentContact, value: string) => void;
}

const socialFields: { key: keyof AgentContact; label: string; placeholder: string }[] = [
  { key: "linkedin", label: "LinkedIn", placeholder: "https://linkedin.com/in/..." },
  { key: "twitter", label: "X (Twitter)", placeholder: "https://x.com/..." },
  { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/..." },
  { key: "facebook", label: "Facebook", placeholder: "https://facebook.com/..." },
  { key: "tiktok", label: "TikTok", placeholder: "https://tiktok.com/@..." },
  { key: "other", label: "Other", placeholder: "https://..." },
  { key: "website", label: "Website", placeholder: "https://yourwebsite.com" },
];

export function AgentContactSection({ agent, onChange }: AgentContactSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCircle className="size-5 text-primary" />
          Agent Contact
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Agent Name</Label>
            <Input
              value={agent.name}
              onChange={(e) => onChange("name", e.target.value)}
              placeholder="Full Name"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Title / Role</Label>
            <Input
              value={agent.titleRole}
              onChange={(e) => onChange("titleRole", e.target.value)}
              placeholder="e.g. Real Estate Agent, Broker"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Email Address</Label>
            <Input
              type="email"
              value={agent.email}
              onChange={(e) => onChange("email", e.target.value)}
              placeholder="agent@company.com"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Phone Number</Label>
            <Input
              type="tel"
              value={agent.phone}
              onChange={(e) => onChange("phone", e.target.value)}
              placeholder="+1 (555) 123-4567"
            />
            <p className="text-xs text-muted-foreground">Used for click-to-call and click-to-text</p>
          </div>
        </div>

        <div className="space-y-1">

        <div className="space-y-1">
          <Label className="text-xs">Default Welcome Note</Label>
          <Textarea
            value={agent.welcomeNote}
            onChange={(e) => onChange("welcomeNote", e.target.value)}
            placeholder="Welcome to your interactive property tour..."
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-medium">Social Links</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {socialFields.map((sf) => (
              <div key={sf.key} className="space-y-1">
                <Label className="text-xs text-muted-foreground">{sf.label}</Label>
                <Input
                  value={agent[sf.key]}
                  onChange={(e) => onChange(sf.key, e.target.value)}
                  placeholder={sf.placeholder}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2 border-t pt-4">
          <Label className="text-xs font-medium flex items-center gap-1.5">
            <BarChart3 className="size-3.5 text-primary" />
            Analytics & Tracking
          </Label>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Google Analytics Measurement ID</Label>
            <Input
              value={agent.gaTrackingId}
              onChange={(e) => onChange("gaTrackingId", e.target.value)}
              placeholder="G-XXXXXXXXXX"
            />
            <p className="text-xs text-muted-foreground">
              Enter your GA4 Measurement ID. This will be injected into the generated presentation's header for traffic monitoring.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
