/**
 * Decision Hub — 3 result-oriented entry cards for creating a Property Map.
 * Renders inline on the Templates dashboard (both as primary CTA and as the
 * empty-state).
 */

import {
  Wand2,
  Library,
  Code2,
  Lock,
  ArrowRight,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { WizardPath } from "./types";

interface PathCard {
  path: WizardPath;
  icon: typeof Wand2;
  title: string;
  blurb: string;
  badge?: string;
  recommended?: boolean;
}

const CARDS: PathCard[] = [
  {
    path: "ai",
    icon: Wand2,
    title: "Smart AI Blueprint",
    blurb:
      "Describe what you sell — AI suggests the facts worth pulling, you tick what matters.",
    badge: "AI-assisted",
    recommended: true,
  },
  {
    path: "library",
    icon: Library,
    title: "Use a Pre-Built Template",
    blurb:
      "Pick a ready-made map for your industry. Auto-fills 30+ fields — fastest way to start.",
    badge: "1-click",
  },
  {
    path: "manual",
    icon: Code2,
    title: "Pro Developer Setup",
    blurb:
      "Hand-author the Field Blueprint as JSON Schema. For power users only.",
  },
];

interface Props {
  onPick: (path: WizardPath) => void;
  disabled?: boolean;
  /** When true, render in the compact horizontal strip mode used above the
   *  template grid. Defaults to the rich empty-state mode. */
  compact?: boolean;
}

export function WizardHub({ onPick, disabled, compact }: Props) {
  return (
    <div
      className={
        compact
          ? "grid gap-2 sm:grid-cols-3"
          : "grid gap-3 sm:grid-cols-3"
      }
    >
      {CARDS.map((card) => (
        <HubCard
          key={card.path}
          card={card}
          onPick={() => onPick(card.path)}
          disabled={disabled}
          compact={compact}
        />
      ))}
    </div>
  );
}

function HubCard({
  card,
  onPick,
  disabled,
  compact,
}: {
  card: PathCard;
  onPick: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const Icon = card.icon;
  const recommended = !!card.recommended;
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className={`group relative flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
        recommended
          ? "border-2 border-primary/40 bg-gradient-to-br from-primary/5 to-primary/10 hover:border-primary"
          : "border-border bg-background hover:border-foreground/30 hover:bg-accent/40"
      }`}
    >
      <div className="flex w-full items-start justify-between">
        <div
          className={`flex size-8 items-center justify-center rounded-md ${
            recommended
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {disabled ? <Lock className="size-4" /> : <Icon className="size-4" />}
        </div>
        <div className="flex flex-col items-end gap-1">
          {recommended && (
            <Badge variant="secondary" className="text-[10px]">
              Recommended
            </Badge>
          )}
          {card.badge && !recommended && (
            <Badge variant="outline" className="text-[10px]">
              {card.badge}
            </Badge>
          )}
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-sm font-semibold leading-tight">{card.title}</div>
        {!compact && (
          <p className="text-[11px] text-muted-foreground leading-snug">
            {card.blurb}
          </p>
        )}
      </div>
      <span
        className={`mt-auto inline-flex items-center gap-1 text-[11px] font-medium ${
          recommended ? "text-primary" : "text-foreground/70"
        }`}
      >
        Start <ArrowRight className="size-3 transition group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}
