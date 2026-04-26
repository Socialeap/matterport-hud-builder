import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { PROFILE_CATEGORIES, type CategoryKey } from "../profiles";

interface Props {
  selected: CategoryKey | null;
  onSelect: (key: CategoryKey) => void;
  onContinue: () => void;
  propertyName: string;
}

/**
 * Step 1 — visual card grid where the user picks the kind of property
 * the AI should learn about. Each card maps to a curated or starter
 * vault_template internally (resolution happens later in profiles.ts).
 */
export function ProfileStep({
  selected,
  onSelect,
  onContinue,
  propertyName,
}: Props) {
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">
          What kind of space should the AI learn about?
        </h3>
        <p className="text-xs leading-snug text-muted-foreground">
          Pick the closest match for{" "}
          <strong className="text-foreground">{propertyName}</strong>. We'll
          load the right set of facts to extract from your document.
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PROFILE_CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const isActive = cat.key === selected;
          return (
            <li key={cat.key}>
              <button
                type="button"
                onClick={() => onSelect(cat.key)}
                className={cn(
                  "group flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-all",
                  "hover:border-primary/60 hover:bg-primary/5",
                  isActive
                    ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                    : "border-border bg-card",
                )}
                aria-pressed={isActive}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-md transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground group-hover:bg-primary/20 group-hover:text-primary",
                  )}
                >
                  <Icon className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block text-sm font-medium text-foreground">
                    {cat.label}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {cat.tagline}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-2 text-[11px] leading-snug text-foreground/80">
        <Sparkles className="mt-0.5 size-3 shrink-0 text-primary" />
        <span>
          Don't see a perfect match? Pick the closest one — the AI will
          also auto-detect extra facts unique to your document.
        </span>
      </p>

      <div className="flex justify-end">
        <Button onClick={onContinue} disabled={!selected}>
          Continue
        </Button>
      </div>
    </div>
  );
}
