import { useState } from "react";
import { Info } from "lucide-react";

export interface CallingCardData {
  brandName: string;
  studioName: string;
  /** @deprecated kept for back-compat; no longer rendered. */
  headline?: string;
  /** @deprecated kept for back-compat; no longer rendered. */
  ctaLabel?: string;
  /** @deprecated kept for back-compat; no longer rendered (front art has its own logo placeholder). */
  logoUrl?: string | null;
  /** @deprecated kept for back-compat. */
  accentColor?: string;
  studioUrl: string;
}

interface CallingCardProps {
  data: CallingCardData;
  /** Force a specific face (for editor preview controls). If undefined, click toggles. */
  forcedFace?: "front" | "back";
  className?: string;
}

const FRONT_SRC = "/card-assets/calling-card-front.png";
const BACK_SRC = "/card-assets/calling-card-back.png";

/**
 * Flippable Calling Card. The front and back faces are pre-designed
 * artwork (PNG); this component only:
 *   1. composes the flip container,
 *   2. overlays the editable studio name on the front,
 *   3. wires the back-button, Smart-Chat info tooltip, and Start CTA on the back.
 *
 * The card uses the front image's native aspect ratio (1920:1065) so the
 * artwork is never distorted. The back image (1920:1049) is letterboxed to
 * the same aspect via object-contain — visually indistinguishable.
 */
export function CallingCard({ data, forcedFace, className }: CallingCardProps) {
  const [flipped, setFlipped] = useState(false);
  const isFlipped = forcedFace ? forcedFace === "back" : flipped;

  const flipToBack = () => {
    if (!forcedFace) setFlipped(true);
  };
  const flipToFront = () => {
    if (!forcedFace) setFlipped(false);
  };

  return (
    <div
      className={`relative w-full ${className ?? ""}`}
      style={{
        aspectRatio: "1920 / 1065",
        perspective: "2000px",
        containerType: "inline-size",
      }}
    >
      <div
        className="relative h-full w-full transition-transform duration-700"
        style={{
          transformStyle: "preserve-3d",
          transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* FRONT */}
        <div
          className="absolute inset-0 overflow-hidden rounded-2xl bg-white"
          style={{ backfaceVisibility: "hidden" }}
        >
          <CardFront data={data} onFlip={flipToBack} interactive={!forcedFace} />
        </div>

        {/* BACK */}
        <div
          className="absolute inset-0 overflow-hidden rounded-2xl bg-white"
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          <CardBack data={data} onBack={flipToFront} interactive={!forcedFace} />
        </div>
      </div>
    </div>
  );
}

function CardFront({
  data,
  onFlip,
  interactive,
}: {
  data: CallingCardData;
  onFlip: () => void;
  interactive: boolean;
}) {
  return (
    <div
      className="relative h-full w-full"
      onClick={interactive ? onFlip : undefined}
      role={interactive ? "button" : undefined}
      aria-label={interactive ? "Flip card" : undefined}
      style={{ cursor: interactive ? "pointer" : "default" }}
    >
      <img
        src={FRONT_SRC}
        alt="Calling card front"
        className="absolute inset-0 h-full w-full object-contain select-none"
        draggable={false}
      />

      {/* Editable studio name — sits inside the empty light-green pill at lower-left */}
      <div
        className="absolute flex items-center text-left"
        style={{
          left: "12%",
          top: "80.5%",
          width: "28%",
          height: "9.5%",
        }}
      >
        <span
          className="font-normal leading-none text-slate-700"
          style={{
            fontSize: "2.05cqw",
            textShadow: "0 1px 2px rgba(255,255,255,0.6)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "100%",
          }}
        >
          {(data.studioName || "Your Studio Name").slice(0, 20)}
        </span>
      </div>
    </div>
  );
}

function CardBack({
  data,
  onBack,
  interactive,
}: {
  data: CallingCardData;
  onBack: () => void;
  interactive: boolean;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);

  return (
    <div className="relative h-full w-full">
      <img
        src={BACK_SRC}
        alt="Calling card back"
        className="absolute inset-0 h-full w-full object-contain select-none"
        draggable={false}
      />

      {/* Back button overlay — invisible click target sized to match the green circle in the art */}
      {interactive && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onBack();
          }}
          aria-label="Return to front of card"
          className="absolute rounded-full focus:outline-none focus:ring-2 focus:ring-white/80"
          style={{
            left: "3.6%",
            top: "3%",
            width: "5%",
            height: "9%",
            background: "transparent",
            cursor: "pointer",
          }}
        />
      )}

      {/* Smart Chat info icon — invisible hotspot over the (i) glyph in the art */}
      <div
        className="absolute"
        style={{
          left: "44.2%",
          top: "46.5%",
          width: "3.2%",
          height: "5.5%",
        }}
        onMouseEnter={() => setTooltipOpen(true)}
        onMouseLeave={() => setTooltipOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          setTooltipOpen((o) => !o);
        }}
      >
        <button
          type="button"
          aria-label="Smart Chat info"
          className="h-full w-full rounded-full focus:outline-none focus:ring-2 focus:ring-emerald-500"
          style={{ background: "transparent", cursor: "pointer" }}
        />
        {tooltipOpen && (
          <div
            role="tooltip"
            className="absolute left-1/2 z-10 -translate-x-1/2 rounded-md bg-slate-900 px-3 py-2 text-white shadow-xl"
            style={{
              top: "115%",
              width: "max-content",
              maxWidth: "60cqw",
              fontSize: "2cqw",
              lineHeight: 1.3,
            }}
          >
            <div className="flex items-start gap-2">
              <Info className="mt-[0.15em] h-[1em] w-[1em] flex-none" style={{ fontSize: "2cqw" }} />
              <span>Requires API key. We'll help you get one that's virtually free!</span>
            </div>
            {/* Caret */}
            <div
              className="absolute left-1/2 -translate-x-1/2"
              style={{
                top: "-0.4em",
                width: 0,
                height: 0,
                borderLeft: "0.5em solid transparent",
                borderRight: "0.5em solid transparent",
                borderBottom: "0.5em solid rgb(15 23 42)",
              }}
            />
          </div>
        )}
      </div>

      {/* Start button — anchor over the green "Start" circle in the art */}
      <a
        href={data.studioUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        aria-label="Start — visit studio"
        className="absolute rounded-full focus:outline-none focus:ring-2 focus:ring-emerald-500"
        style={{
          left: "88.5%",
          top: "82%",
          width: "8%",
          height: "14%",
          background: "transparent",
          cursor: "pointer",
        }}
      />
    </div>
  );
}
