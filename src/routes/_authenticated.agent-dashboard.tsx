import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, Trash2, Download, BarChart3, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { uploadBrandAsset } from "@/lib/storage";
import {
  optimizeBrandImage,
  describeOptimization,
  BRAND_ASSET_LIMITS,
} from "@/lib/portal/image-optimizer";
import {
  getMyAgentProfile,
  updateMyAgentProfile,
  getMyAgentHistory,
} from "@/lib/agent-profile.functions";

export const Route = createFileRoute("/_authenticated/agent-dashboard")({
  head: () => ({
    meta: [
      { title: "Agent Dashboard — My Profile & Presentations" },
      {
        name: "description",
        content:
          "Your reusable agent profile and a history of every 3D presentation you've downloaded across MSP studios.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AgentDashboardPage,
});

const SOCIAL_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: "linkedin", label: "LinkedIn", placeholder: "https://linkedin.com/in/..." },
  { key: "twitter", label: "X (Twitter)", placeholder: "https://x.com/..." },
  { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/..." },
  { key: "facebook", label: "Facebook", placeholder: "https://facebook.com/..." },
  { key: "tiktok", label: "TikTok", placeholder: "https://tiktok.com/@..." },
  { key: "other", label: "Other", placeholder: "https://..." },
  { key: "website", label: "Website", placeholder: "https://yourwebsite.com" },
];

interface FormState {
  display_name: string;
  title_role: string;
  company: string;
  phone: string;
  welcome_note: string;
  ga_tracking_id: string;
  avatar_url: string;
  social_links: Record<string, string>;
}

const EMPTY_FORM: FormState = {
  display_name: "",
  title_role: "",
  company: "",
  phone: "",
  welcome_note: "",
  ga_tracking_id: "",
  avatar_url: "",
  social_links: {},
};

function AgentDashboardPage() {
  const { user, hasRole, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const fetchProfile = useServerFn(getMyAgentProfile);
  const fetchHistory = useServerFn(getMyAgentHistory);
  const saveProfile = useServerFn(updateMyAgentProfile);

  const profileQuery = useQuery({
    queryKey: ["agent-profile"],
    queryFn: () => fetchProfile(),
  });
  const historyQuery = useQuery({
    queryKey: ["agent-history"],
    queryFn: () => fetchHistory(),
  });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const seededRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // Seed form from server data once.
  useEffect(() => {
    if (seededRef.current) return;
    const p = profileQuery.data?.profile;
    if (!p) return;
    seededRef.current = true;
    setForm({
      display_name: p.display_name ?? "",
      title_role: p.title_role ?? "",
      company: p.company ?? "",
      phone: p.phone ?? "",
      welcome_note: p.welcome_note ?? "",
      ga_tracking_id: p.ga_tracking_id ?? "",
      avatar_url: p.avatar_url ?? "",
      social_links: (p.social_links as Record<string, string>) ?? {},
    });
  }, [profileQuery.data]);

  const saveMut = useMutation({
    mutationFn: (data: FormState) => saveProfile({ data }),
    onSuccess: () => {
      toast.success("Profile saved");
      queryClient.invalidateQueries({ queryKey: ["agent-profile"] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Could not save profile");
    },
  });

  const handleField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSocial = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, social_links: { ...prev.social_links, [key]: value } }));
  };

  const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      e.target.value = "";
      return;
    }
    if (!user?.id) {
      toast.error("You must be signed in to upload a photo");
      return;
    }

    setAvatarUploading(true);
    try {
      // Optimize → WebP, mirror builder/logo flow.
      const result = await optimizeBrandImage(file, {
        ...BRAND_ASSET_LIMITS.avatar,
        kind: "avatar",
      });
      const url = await uploadBrandAsset(user.id, result.file, "avatar");
      if (!url) {
        toast.error("Upload failed — please try again");
        return;
      }
      setForm((prev) => ({ ...prev, avatar_url: url }));
      const savings = describeOptimization(result);
      toast.success(savings ? `Photo uploaded (${savings})` : "Photo uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not process image");
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveAvatar = () => {
    setForm((prev) => ({ ...prev, avatar_url: "" }));
  };

  const handleSave = () => {
    saveMut.mutate(form);
  };

  const initials = (form.display_name || user?.email || "?")
    .split(/[\s@]+/)
    .slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase())
    .join("");

  const isMspOnly = hasRole("provider") && !hasRole("client") && !hasRole("admin");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-semibold">Agent Dashboard</h1>
            <p className="text-xs text-muted-foreground">
              Your profile autofills every MSP studio you sign into.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate({ to: "/agent-dashboard/work-orders" })}
            >
              Work Orders
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/agents" })}>
              ← Back to /agents
            </Button>
            <Button variant="ghost" size="sm" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        {isMspOnly && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
            <CardContent className="flex items-center justify-between py-4">
              <p className="text-sm">
                You're signed in as a Studio (MSP). The Agent Dashboard is for clients who use MSP studios.
              </p>
              <Button size="sm" onClick={() => navigate({ to: "/dashboard" })}>
                Go to MSP Dashboard
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Profile */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">My Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {profileQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading profile…
              </div>
            ) : (
              <>
                {/* Avatar */}
                <div className="flex items-center gap-4">
                  <Avatar className="h-20 w-20 border">
                    {form.avatar_url ? <AvatarImage src={form.avatar_url} alt={form.display_name || "You"} /> : null}
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
                        disabled={avatarUploading}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={avatarUploading}
                      >
                        {avatarUploading ? (
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        ) : (
                          <Upload className="mr-1.5 size-3.5" />
                        )}
                        {avatarUploading ? "Optimizing…" : "Upload"}
                      </Button>
                      {form.avatar_url && (
                        <Button type="button" size="sm" variant="ghost" onClick={handleRemoveAvatar}>
                          <Trash2 className="mr-1.5 size-3.5" />
                          Remove
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      PNG/JPG, square recommended. Up to 10 MB — auto-optimized to WebP.
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Full Name</Label>
                    <Input
                      value={form.display_name}
                      onChange={(e) => handleField("display_name", e.target.value)}
                      placeholder="Your name"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Title / Role</Label>
                    <Input
                      value={form.title_role}
                      onChange={(e) => handleField("title_role", e.target.value)}
                      placeholder="e.g. Real Estate Agent"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Company / Brokerage</Label>
                    <Input
                      value={form.company}
                      onChange={(e) => handleField("company", e.target.value)}
                      placeholder="e.g. Acme Realty"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Phone</Label>
                    <Input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => handleField("phone", e.target.value)}
                      placeholder="+1 (555) 123-4567"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">Email</Label>
                    <Input value={user?.email ?? ""} readOnly disabled className="bg-muted/40" />
                    <p className="text-xs text-muted-foreground">Managed by your sign-in account.</p>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Default Welcome Note</Label>
                  <Textarea
                    rows={3}
                    value={form.welcome_note}
                    onChange={(e) => handleField("welcome_note", e.target.value)}
                    placeholder="Welcome to your interactive property tour..."
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-medium">Social Links</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {SOCIAL_FIELDS.map((sf) => (
                      <div key={sf.key} className="space-y-1">
                        <Label className="text-xs text-muted-foreground">{sf.label}</Label>
                        <Input
                          value={form.social_links[sf.key] ?? ""}
                          onChange={(e) => handleSocial(sf.key, e.target.value)}
                          placeholder={sf.placeholder}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-1 border-t pt-4">
                  <Label className="text-xs font-medium flex items-center gap-1.5">
                    <BarChart3 className="size-3.5 text-primary" />
                    Google Analytics Measurement ID
                  </Label>
                  <Input
                    value={form.ga_tracking_id}
                    onChange={(e) => handleField("ga_tracking_id", e.target.value)}
                    placeholder="G-XXXXXXXXXX"
                  />
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={saveMut.isPending}>
                    {saveMut.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                    Save Profile
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="size-4" />
              My Presentations
            </CardTitle>
          </CardHeader>
          <CardContent>
            {historyQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading history…
              </div>
            ) : (historyQuery.data?.rows ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You haven't downloaded any 3D presentations yet. When you do, they'll appear here.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Primary Property</TableHead>
                      <TableHead>MSP Studio</TableHead>
                      <TableHead>Cost</TableHead>
                      <TableHead>Downloaded</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyQuery.data!.rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.primaryProperty}</TableCell>
                        <TableCell>{row.brandName}</TableCell>
                        <TableCell>
                          {row.isFree ? (
                            <Badge variant="secondary">Free</Badge>
                          ) : (
                            <Badge>${(row.amountCents / 100).toFixed(2)}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(row.downloadedAt).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </TableCell>
                        <TableCell>
                          {row.brandSlug && (
                            <Link
                              to="/p/$slug/builder"
                              params={{ slug: row.brandSlug }}
                              className="inline-flex items-center text-xs text-primary hover:underline"
                            >
                              <ExternalLink className="size-3.5" />
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
