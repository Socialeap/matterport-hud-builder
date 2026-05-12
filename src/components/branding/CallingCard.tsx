import { useState } from "react";

export interface CallingCardData {
  brandName: string;
  studioName: string;
  headline: string;
  ctaLabel: string;
  logoUrl: string | null;
  accentColor: string;
  studioUrl: string;
}

interface CallingCardProps {
  data: CallingCardData;
  /** Force a specific face (for editor preview controls). If undefined, click toggles. */
  forcedFace?: "front" | "back";
  className?: string;
}

const MATTERPORT_BADGE = "/card-assets/matterport-service-partner.png";

/**
 * Flippable Calling Card. Pure presentational + a single local flipped state.
 * Designed at a 16:9 aspect (960x540 reference) and scales fluidly via the
 * outer aspect-ratio wrapper.
 */
export function CallingCard({ data, forcedFace, className }: CallingCardProps) {
  const [flipped, setFlipped] = useState(false);
  const isFlipped = forcedFace ? forcedFace === "back" : flipped;

  const handleFlip = () => {
    if (!forcedFace) setFlipped((f) => !f);
  };

  // Derive a soft tint family from the MSP accent color for the
  // bubble fills. We expose the accent as CSS vars and let the
  // component apply alpha via color-mix in browsers that support it.
  const styleVars = {
    ["--cc-accent" as string]: data.accentColor,
  } as React.CSSProperties;

  return (
    <div
      className={`relative w-full ${className ?? ""}`}
      style={{ aspectRatio: "16 / 9", perspective: "1600px", ...styleVars }}
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
          className="absolute inset-0 overflow-hidden rounded-2xl bg-white shadow-xl"
          style={{ backfaceVisibility: "hidden" }}
          onClick={handleFlip}
          role={forcedFace ? undefined : "button"}
          aria-label={forcedFace ? undefined : "Flip card"}
        >
          <CardFront data={data} />
        </div>

        {/* BACK */}
        <div
          className="absolute inset-0 overflow-hidden rounded-2xl bg-white shadow-xl"
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          <CardBack data={data} onBack={handleFlip} forcedFace={forcedFace} />
        </div>
      </div>
    </div>
  );
}

function CardFront({ data }: { data: CallingCardData }) {
  const accent = data.accentColor;
  return (
    <div className="relative h-full w-full">
      {/* Matterport badge top-right */}
      <img
        src={MATTERPORT_BADGE}
        alt="Matterport Service Partner"
        className="absolute right-[3%] top-[4%] h-[22%] w-auto object-contain"
      />

      {/* Learn More pill top-center-right */}
      <div
        className="absolute top-[6%] right-[18%] rounded-full px-[2.2%] py-[1.2%] text-[2.4cqw] font-medium text-slate-800"
        style={{
          backgroundColor: `color-mix(in srgb, ${accent} 35%, white)`,
        }}
      >
        Learn More…
      </div>

      {/* Speech bubble — main message (left ~60%) */}
      <div className="absolute left-[3%] top-[14%] w-[60%]">
        <div
          className="relative rounded-3xl px-[5%] py-[6%] text-white"
          style={{
            backgroundColor: `color-mix(in srgb, ${accent} 70%, #2d5a4a)`,
          }}
        >
          {/* Decorative quote mark */}
          <span
            className="absolute -left-[2%] -top-[10%] text-[8cqw] leading-none"
            style={{ color: `color-mix(in srgb, ${accent} 45%, white)` }}
          >
            “
          </span>

          {/* Headline (top portion) — green text */}
          <div
            className="text-[3.2cqw] font-bold leading-tight"
            style={{ color: `color-mix(in srgb, ${accent} 80%, #84cc16)` }}
          >
            {data.headline.split(/\s+/).slice(0, Math.ceil(data.headline.split(/\s+/).length / 2)).join(" ")}
          </div>

          {/* Highlight pill */}
          <div className="my-[3%]">
            <span
              className="inline-block rounded-2xl px-[3%] py-[1.5%] text-[3.6cqw] font-extrabold text-white shadow-md"
              style={{
                backgroundColor: `color-mix(in srgb, ${accent} 60%, #84cc16)`,
                textShadow: "0 1px 2px rgba(0,0,0,0.25)",
              }}
            >
              Presentation
            </span>
          </div>

          {/* Tail of headline (bottom) */}
          <div className="text-[3.2cqw] font-extrabold leading-tight text-white" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.25)" }}>
            {data.headline.split(/\s+/).slice(Math.ceil(data.headline.split(/\s+/).length / 2)).join(" ") || "Starts Here…"}
          </div>

          {/* Bubble tail */}
          <div
            className="absolute -bottom-[8%] left-[14%] h-0 w-0"
            style={{
              borderLeft: "1.4cqw solid transparent",
              borderRight: "2.4cqw solid transparent",
              borderTop: `3cqw solid color-mix(in srgb, ${accent} 70%, #2d5a4a)`,
            }}
          />
        </div>

        {/* CTA pill below */}
        <a
          href={data.studioUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="mt-[5%] inline-block rounded-full px-[5%] py-[2%] text-[2.4cqw] font-medium text-slate-800 transition-opacity hover:opacity-90"
          style={{
            backgroundColor: `color-mix(in srgb, ${accent} 35%, white)`,
          }}
        >
          {data.ctaLabel.replace(/\{studio\}/i, data.studioName)}
        </a>
      </div>

      {/* Right side — circular logo + accent shapes */}
      <div className="absolute right-[4%] top-[30%] h-[60%] w-[34%]">
        {/* Background green block (decorative) */}
        <div
          className="absolute right-[10%] top-0 h-[55%] w-[70%] rounded-tl-3xl rounded-br-3xl"
          style={{ backgroundColor: `color-mix(in srgb, ${accent} 30%, white)` }}
        />
        {/* Asterisk decoration */}
        <div
          className="absolute right-[2%] top-[40%] text-[10cqw] font-bold leading-none"
          style={{ color: `color-mix(in srgb, ${accent} 35%, white)` }}
        >
          ✻
        </div>

        {/* Logo circle */}
        <div className="absolute bottom-0 left-[8%] h-[80%] w-[80%]">
          <div
            className="h-full w-full overflow-hidden rounded-full border-[0.6cqw] border-white bg-white shadow-lg"
            style={{ boxShadow: "0 10px 25px rgba(0,0,0,0.15)" }}
          >
            {data.logoUrl ? (
              <img
                src={data.logoUrl}
                alt={data.brandName}
                className="h-full w-full object-contain p-[8%]"
              />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center text-[3cqw] font-bold text-slate-500"
                style={{
                  backgroundColor: `color-mix(in srgb, ${accent} 20%, white)`,
                }}
              >
                {data.brandName?.slice(0, 2).toUpperCase() || "LOGO"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CardBack({
  data,
  onBack,
  forcedFace,
}: {
  data: CallingCardData;
  onBack: () => void;
  forcedFace?: "front" | "back";
}) {
  const accent = data.accentColor;
  const features: Array<{ title: string; body: string; icon: string }> = [
    {
      title: "100% White Label",
      body:
        "Other than the inherent Matterport logo, your 3D presentations appear with your branding and personalization (or unbranded if MLS required).",
      icon: "🗺",
    },
    {
      title: "Smart Chat",
      body:
        "With \"Ask about this Property\" feature, visitor questions are answered based on AI training from your uploaded property specs.",
      icon: "🔍",
    },
    {
      title: "End Digital 'Rent'",
      body:
        "Presentations generated from our studio are yours to keep with a 1-time payment; no recurring fees or subscriptions.",
      icon: "📞",
    },
    {
      title: "Live Guided Tours",
      body:
        "Use the Custom Preferences as directed by your Designer to select preferred images, graphics, sounds, design styles, etc.",
      icon: "💻",
    },
  ];

  return (
    <div className="relative flex h-full w-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-[2%] px-[3%] pt-[3%] pb-[2%]">
        {!forcedFace && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onBack();
            }}
            className="flex h-[8cqw] w-[8cqw] flex-none items-center justify-center rounded-full text-white"
            style={{ backgroundColor: `color-mix(in srgb, ${accent} 60%, #f59e0b)` }}
            aria-label="Flip back"
          >
            ↺
          </button>
        )}
        <h2 className="flex-1 text-[3.2cqw] font-extrabold leading-tight text-slate-800">
          Need interactive overlays with{" "}
          <span
            className="rounded px-[1%]"
            style={{ backgroundColor: `color-mix(in srgb, ${accent} 35%, #fde68a)` }}
          >
            your
          </span>{" "}
          branding & control?
        </h2>
        <div
          className="flex h-[6cqw] w-[6cqw] flex-none flex-col items-center justify-center gap-[0.6cqw]"
          aria-hidden
        >
          <span className="block h-[0.4cqw] w-[5cqw] rounded" style={{ backgroundColor: accent }} />
          <span className="block h-[0.4cqw] w-[5cqw] rounded" style={{ backgroundColor: accent }} />
          <span className="block h-[0.4cqw] w-[5cqw] rounded" style={{ backgroundColor: accent }} />
        </div>
      </div>

      <div className="px-[5%] pb-[1%]">
        <div
          className="h-[0.4cqw] w-full"
          style={{ backgroundColor: `color-mix(in srgb, ${accent} 60%, #84cc16)` }}
        />
      </div>

      <p className="px-[5%] pt-[1.5%] text-center text-[2.2cqw] leading-snug text-slate-700">
        Stop sending borrowed links you don't own. Transform your existing scans into custom,
        portable presentations that you can host or embed anywhere.
      </p>

      {/* Feature columns */}
      <div className="flex flex-1 items-stretch gap-[1.5%] px-[3%] pb-[3%] pt-[2%]">
        {features.map((f, i) => {
          // Cycle through 4 tints from light to mid
          const tints = [22, 32, 42, 52];
          const bg = `color-mix(in srgb, ${accent} ${tints[i]}%, white)`;
          return (
            <div
              key={f.title}
              className="relative flex flex-1 flex-col items-center rounded-2xl px-[2%] pb-[10%] pt-[12%] text-center"
              style={{ backgroundColor: bg }}
            >
              {/* Icon circle */}
              <div
                className="absolute -top-[10%] flex h-[18%] w-[28%] items-center justify-center rounded-full bg-white text-[4cqw] shadow-md"
                style={{ color: accent }}
              >
                {f.icon}
              </div>
              <h3 className="text-[2.4cqw] font-extrabold text-slate-800">{f.title}</h3>
              <p className="mt-[6%] text-[1.85cqw] leading-snug text-slate-700">{f.body}</p>
            </div>
          );
        })}
      </div>

      {/* Start button */}
      <a
        href={data.studioUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-[5%] right-[4%] flex h-[14cqw] w-[14cqw] items-center justify-center rounded-full text-[3cqw] font-bold text-white shadow-lg transition-transform hover:scale-105"
        style={{ backgroundColor: `color-mix(in srgb, ${accent} 80%, #84cc16)` }}
      >
        Start
      </a>
    </div>
  );
}
