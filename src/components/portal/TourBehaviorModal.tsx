import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { TourBehavior } from "./types";
import { buildMatterportUrl } from "./types";

interface TourBehaviorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  behavior: TourBehavior;
  onChange: (field: keyof TourBehavior, value: string | boolean) => void;
  modelId: string;
  modelName: string;
}

export function TourBehaviorModal({
  open,
  onOpenChange,
  behavior,
  onChange,
  modelId,
  modelName,
}: TourBehaviorModalProps) {
  const previewUrl = buildMatterportUrl(modelId, behavior);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tour Behavior Settings</DialogTitle>
          <DialogDescription>
            Configure Matterport behavior for: {modelName || "Untitled Property"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Custom / Deep-Link Parameters */}
          <div className="space-y-2">
            <Label className="text-xs">Custom / Deep-Link Parameters</Label>
            <Input
              value={behavior.customParams}
              onChange={(e) => onChange("customParams", e.target.value)}
              placeholder="Paste Matterport URL or custom params"
            />
            {previewUrl && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Live Preview URL</Label>
                <p className="break-all rounded bg-muted p-2 font-mono text-xs text-foreground">
                  {previewUrl}
                </p>
              </div>
            )}
          </div>

          <Separator />

          {/* Brand Control & Professionalism */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground">Brand Control & Professionalism</h4>
            <ToggleRow label="Hide Matterport Branding" hint="brand=0" checked={behavior.hideBranding} onChange={(v) => onChange("hideBranding", v)} />
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-foreground">MLS Compliance Mode</span>
                <p className="text-xs text-muted-foreground">mls=1|2</p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={behavior.mlsModeEnabled} onCheckedChange={(v) => onChange("mlsModeEnabled", v)} />
                {behavior.mlsModeEnabled && (
                  <Select value={behavior.mlsModeValue} onValueChange={(v) => onChange("mlsModeValue", v)}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1</SelectItem>
                      <SelectItem value="2">2</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            <ToggleRow label="Hide Space Title" hint="title=0" checked={behavior.hideTitle} onChange={(v) => onChange("hideTitle", v)} />
          </div>

          <Separator />

          {/* Guided Experience & Automatic Motion */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground">Guided Experience & Automatic Motion</h4>
            <ToggleRow label="Auto-Play" hint="play=1" checked={behavior.autoPlay} onChange={(v) => onChange("autoPlay", v)} />
            <ToggleRow label="Quickstart" hint="qs=1" checked={behavior.quickstart} onChange={(v) => onChange("quickstart", v)} />
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-foreground">Auto-Start Guided Tour</span>
                <p className="text-xs text-muted-foreground">ts=N (delay in seconds)</p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={behavior.autoStartTour} onCheckedChange={(v) => onChange("autoStartTour", v)} />
                {behavior.autoStartTour && (
                  <Input
                    type="number"
                    value={behavior.autoStartTourDelay}
                    onChange={(e) => onChange("autoStartTourDelay", e.target.value)}
                    className="w-20"
                    min="0"
                  />
                )}
              </div>
            </div>
            <ToggleRow label="Loop Guided Tour" hint="lp=1" checked={behavior.loopGuidedTour} onChange={(v) => onChange("loopGuidedTour", v)} />
          </div>

          <Separator />

          {/* Interface & Navigation */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground">Interface & Navigation</h4>
            <ToggleRow label="Hide Dollhouse" hint="dh=0" checked={behavior.hideDollhouse} onChange={(v) => onChange("hideDollhouse", v)} />
            <ToggleRow label="Hide Highlight Reel" hint="hr=0" checked={behavior.hideHighlightReel} onChange={(v) => onChange("hideHighlightReel", v)} />
            <ToggleRow label="Single Floor Focus" hint="f=0" checked={behavior.singleFloorFocus} onChange={(v) => onChange("singleFloorFocus", v)} />
            <ToggleRow label="Hide Mattertags" hint="mt=0" checked={behavior.hideMattertags} onChange={(v) => onChange("hideMattertags", v)} />
            <ToggleRow label="Hide Search" hint="search=0" checked={behavior.hideSearch} onChange={(v) => onChange("hideSearch", v)} />
          </div>

          <Separator />

          {/* UX & Embedding */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground">UX & Embedding</h4>
            <ToggleRow label="Disable Scroll Wheel Zoom" hint="wh=0" checked={behavior.disableScrollWheelZoom} onChange={(v) => onChange("disableScrollWheelZoom", v)} />
            <ToggleRow label="Disable Zoom" hint="nozoom=1" checked={behavior.disableZoom} onChange={(v) => onChange("disableZoom", v)} />
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-foreground">Force UI Language</span>
                <p className="text-xs text-muted-foreground">lang=code</p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={behavior.forceLanguage} onCheckedChange={(v) => onChange("forceLanguage", v)} />
                {behavior.forceLanguage && (
                  <Input
                    value={behavior.languageCode}
                    onChange={(e) => onChange("languageCode", e.target.value)}
                    className="w-20"
                    placeholder="en"
                  />
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* Hidden & Advanced */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground">Hidden & Advanced</h4>
            <ToggleRow label="Hide Guided Path" hint="guidedpath=0" checked={behavior.hideGuidedPath} onChange={(v) => onChange("hideGuidedPath", v)} />
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-foreground">Transition Style</span>
                <p className="text-xs text-muted-foreground">transition=1|2</p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={behavior.transitionEnabled} onCheckedChange={(v) => onChange("transitionEnabled", v)} />
                {behavior.transitionEnabled && (
                  <Select value={behavior.transitionValue} onValueChange={(v) => onChange("transitionValue", v)}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1</SelectItem>
                      <SelectItem value="2">2</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-sm text-foreground">{label}</span>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
