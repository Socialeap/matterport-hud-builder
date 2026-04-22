import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserCircle, BarChart3, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { AgentContact } from "./types";

interface AgentContactSectionProps {
  agent: AgentContact;
  onChange: (field: keyof AgentContact, value: string) => void;
  onAvatarFileChange?: (file: File | null) => void;
  /** When true, render only the inner form (no Card/Header wrapper) — used inside Accordion. */
  headless?: boolean;
}

const MAX_AVATAR_BYTES = 500 * 1024; // 500 KB

const socialFields: { key: keyof AgentContact; label: string; placeholder: string }[] = [
  { key: "linkedin", label: "LinkedIn", placeholder: "https://linkedin.com/in/..." },
  { key: "twitter", label: "X (Twitter)", placeholder: "https://x.com/..." },
  { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/..." },
  { key: "facebook", label: "Facebook", placeholder: "https://facebook.com/..." },
  { key: "tiktok", label: "TikTok", placeholder: "https://tiktok.com/@..." },
  { key: "other", label: "Other", placeholder: "https://..." },
  { key: "website", label: "Website", placeholder: "https://yourwebsite.com" },
];

export function AgentContactSection({ agent, onChange, onAvatarFileChange, headless }: AgentContactSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error("Avatar must be 500 KB or smaller");
      e.target.value = "";
      return;
    }
    onAvatarFileChange?.(file);
  };

  const handleRemoveAvatar = () => {
    onAvatarFileChange?.(null);
    onChange("avatarUrl", "");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const initials = (agent.name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase())
    .join("");

  const body = (
    <div className="space-y-4">
      {/* Avatar */}
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 border border-border">
            {agent.avatarUrl ? <AvatarImage src={agent.avatarUrl} alt={agent.name || "Avatar"} /> : null}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="space-y-2">
            <Label className="text-xs">Profile Photo</Label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarSelect}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-1.5 size-3.5" />
                Upload
              </Button>
              {agent.avatarUrl && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleRemoveAvatar}
                >
                  <Trash2 className="mr-1.5 size-3.5" />
                  Remove
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">PNG/JPG, square recommended, max 500 KB.</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Agent/Manager Name</Label>
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
              placeholder="e.g. Real Estate Agent, Property Manager, Owner"
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
    </div>
  );

  if (headless) return body;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCircle className="size-5 text-primary" />
          Agent/Manager Contact
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
