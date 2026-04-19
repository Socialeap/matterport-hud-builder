import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Play } from "lucide-react";
import type { MediaAsset } from "./types";

interface MediaCarouselModalProps {
  open: boolean;
  onClose: () => void;
  assets: MediaAsset[];
  initialIndex?: number;
}

export function MediaCarouselModal({
  open,
  onClose,
  assets,
  initialIndex = 0,
}: MediaCarouselModalProps) {
  const [index, setIndex] = useState(initialIndex);

  const total = assets.length;

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + total) % total);
  }, [total]);

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % total);
  }, [total]);

  useEffect(() => {
    if (open) setIndex(initialIndex);
  }, [open, initialIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, goPrev, goNext]);

  if (!open || total === 0) return null;
  if (typeof document === "undefined") return null;

  const current = assets[index];
  const isVideo = current.kind === "video";

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Property media carousel"
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 px-4 py-8"
      style={{
        backdropFilter: "blur(12px) brightness(0.5)",
        WebkitBackdropFilter: "blur(12px) brightness(0.5)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-6xl"
      >
        {/* Close */}
        <button
          onClick={onClose}
          aria-label="Close media carousel"
          className="absolute -top-12 right-0 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Counter */}
        <div className="absolute -top-11 left-0 text-sm font-medium text-white/90">
          {index + 1} / {total}
          <span className="ml-3 text-xs uppercase tracking-wider text-white/60">
            {current.kind}
          </span>
          {current.label && (
            <span className="ml-3 text-xs text-white/70">{current.label}</span>
          )}
        </div>

        {/* Media stage */}
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-[0_25px_80px_-15px_rgba(0,0,0,0.7)]">
          {isVideo && current.embedUrl && (
            <iframe
              key={current.id}
              src={current.embedUrl}
              title={current.label || "Matterport clip"}
              className="h-full w-full border-0"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
            />
          )}

          {!isVideo && current.proxyUrl && (
            <img
              key={current.id}
              src={current.proxyUrl}
              alt={current.label || `Property ${current.kind}`}
              className="h-full w-full object-contain"
            />
          )}

          {/* Arrows */}
          {total > 1 && (
            <>
              <button
                onClick={goPrev}
                aria-label="Previous media"
                className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-colors hover:bg-black/70"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                onClick={goNext}
                aria-label="Next media"
                className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-colors hover:bg-black/70"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
        </div>

        {/* Thumbnail strip */}
        {total > 1 && (
          <div className="mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
            {assets.map((a, i) => {
              const thumbSrc = a.proxyUrl;
              return (
                <button
                  key={a.id}
                  onClick={() => setIndex(i)}
                  className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-md border-2 transition-all ${
                    i === index
                      ? "border-white opacity-100"
                      : "border-transparent opacity-60 hover:opacity-90"
                  }`}
                  aria-label={`Go to media ${i + 1}`}
                >
                  {thumbSrc ? (
                    <img
                      src={thumbSrc}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-zinc-800">
                      <Play className="h-4 w-4 text-white" fill="currentColor" />
                    </div>
                  )}
                  {a.kind === "video" && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <Play className="h-4 w-4 text-white" fill="currentColor" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
