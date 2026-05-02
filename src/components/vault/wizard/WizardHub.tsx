/**
 * Decision Hub — 3 result-oriented entry cards for creating a Property Map.
 *
 * Empty-state mode (rich): each card is a 3D flip-card. Front shows the
 * pitch + a "Start →" CTA. The info button at the bottom-right flips the
 * card to reveal a "How it works" + "The Scenario" explainer for MSPs
 * deciding between paths.
 *
 * Compact mode: the dashboard CTA strip stays a fast-pick row — no flip
 * affordance, just title + Start.
 */

import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Code2,
  Info,
  Library,
  Lock,
  Wand2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { WizardPath } from "./types";

interface PathCard {
  path: WizardPath;
  icon: typeof Wand2;
  title: string;
  blurb: string;
  howItWorks: string;
  scenario: string;
  badge?: string;
  recommended?: boolean;
}

const CARDS: PathCard[] = [
  {
    path: "ai",
    icon: Wand2,
    title: "Smart AI Blueprint",
    blurb:
      "Describe a property type — Offices, Hotels, Apartments, Galleries, Luxury Rentals — and AI suggests the facts worth pulling. You tick what matters.",
    howItWorks:
      "Type a few words describing the property class (e.g., \"Luxury Beachfront Condo\"). Our AI generates a checklist of fields most important for that property type, which your clients use to help the AI scan and convert their uploaded property data into real-world answers in the \"Ask AI\" chat.",
    scenario:
      "Best for standard properties and impatient users. If an MSP is listing a typical 3-bedroom house and doesn't want to think about data structures, they click this. The AI does the heavy lifting of figuring out what matters.",
    badge: "AI-assisted",
    recommended: true,
  },
  {
    path: "library",
    icon: Library,
    title: "Use a Pre-Built Template",
    blurb:
      "Pick a ready-made map for your industry. Auto-fills 30+ fields — fastest way to start.",
    howItWorks:
      "The user bypasses the AI generation entirely and selects from a library of proven, hardcoded checklists (e.g., \"Standard Coworking Space\", \"Hospitality/Hotel\") or cloned copies of their own previously saved maps.",
    scenario:
      "Best for agencies operating at scale. If an MSP is producing 10 identical 3D tours for a 10-unit apartment building, they don't want to rely on the AI generating slightly different maps every time. They use a template to guarantee absolute consistency across all 10 presentations.",
    badge: "1-click",
  },
  {
    path: "manual",
    icon: Code2,
    title: "Pro Developer Setup",
    blurb:
      "Hand-author the Field Blueprint as JSON Schema. For power users only.",
    howItWorks:
      "Strips away the friendly UI and exposes the raw JSON editor, specific data extractors, and backend system tags. Total manual control.",
    scenario:
      "Best for power users, massive enterprise clients with proprietary data needs, or your internal support team. If the AI completely fumbles a weird PDF, a developer can use this path to forcefully hand-craft the schema and fix the bug without being restricted by the wizard UI.",
  },
];

interface Props {
  onPick: (path: WizardPath) => void;
  disabled?: boolean;
  /** When true, render in the compact horizontal strip mode used above the
   *  template grid. Defaults to the rich empty-state mode (flip-cards). */
  compact?: boolean;
}

export function WizardHub({ onPick, disabled, compact }: Props) {
  return (
    <div
      className={
        compact
          ? "grid gap-2 sm:grid-cols-3"
          : "grid gap-4 sm:grid-cols-3"
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
  const [flipped, setFlipped] = useState(false);

  if (compact) {
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
        <div className="text-sm font-semibold leading-tight">{card.title}</div>
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

  // ── Rich empty-state mode: 3D flip-card ────────────────────────────
  return (
    <div className="group relative h-[300px] [perspective:1200px]">
      <div
        className={`relative h-full w-full transition-transform duration-500 ease-out [transform-style:preserve-3d] ${
          flipped ? "[transform:rotateY(180deg)]" : ""
        }`}
      >
        {/* FRONT FACE */}
        <button
          type="button"
          onClick={onPick}
          disabled={disabled}
          aria-hidden={flipped}
          tabIndex={flipped ? -1 : 0}
          className={`absolute inset-0 flex flex-col items-start gap-3 overflow-hidden rounded-lg border p-5 text-left transition disabled:cursor-not-allowed disabled:opacity-50 [backface-visibility:hidden] ${
            recommended
              ? "border-2 border-primary/40 bg-gradient-to-br from-primary/5 to-primary/10 hover:border-primary"
              : "border-border bg-background hover:border-foreground/30 hover:bg-accent/40"
          } ${flipped ? "pointer-events-none" : ""}`}
        >
          <div className="flex w-full items-start justify-between">
            <div
              className={`flex size-10 items-center justify-center rounded-md ${
                recommended
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {disabled ? <Lock className="size-5" /> : <Icon className="size-5" />}
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
          <div className="space-y-1.5">
            <div className="text-base font-semibold leading-tight">
              {card.title}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {card.blurb}
            </p>
          </div>
          <span
            className={`mt-auto inline-flex items-center gap-1 text-xs font-medium ${
              recommended ? "text-primary" : "text-foreground/70"
            }`}
          >
            Start{" "}
            <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
          </span>
        </button>

        {/* INFO BUTTON — bottom-right of FRONT, flips to back */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setFlipped(true);
          }}
          aria-label="Show how it works"
          aria-pressed={flipped}
          tabIndex={flipped ? -1 : 0}
          className={`absolute bottom-3 right-3 z-10 flex size-7 items-center justify-center rounded-full border border-border bg-background/80 text-muted-foreground backdrop-blur transition hover:border-foreground/40 hover:text-foreground [backface-visibility:hidden] ${
            flipped ? "pointer-events-none opacity-0" : ""
          }`}
        >
          <Info className="size-3.5" />
        </button>

        {/* BACK FACE */}
        <div
          aria-hidden={!flipped}
          className={`absolute inset-0 flex flex-col gap-3 overflow-hidden rounded-lg border border-border bg-background p-5 text-left [backface-visibility:hidden] [transform:rotateY(180deg)] ${
            !flipped ? "pointer-events-none" : ""
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm font-semibold leading-tight">
              {card.title}
            </div>
            <button
              type="button"
              onClick={() => setFlipped(false)}
              aria-label="Back to summary"
              tabIndex={flipped ? 0 : -1}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition hover:border-foreground/40 hover:text-foreground"
            >
              <ArrowLeft className="size-3" /> Back
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto pr-1 text-[11px] leading-relaxed text-muted-foreground">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground/80">
                How it works
              </p>
              <p className="mt-1">{card.howItWorks}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground/80">
                The Scenario
              </p>
              <p className="mt-1">{card.scenario}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
