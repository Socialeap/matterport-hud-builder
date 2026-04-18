import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { parseCinematicVideo } from "@/lib/video-embed";

interface CinemaModalProps {
  open: boolean;
  onClose: () => void;
  videoUrl: string;
}

export function CinemaModal({ open, onClose, videoUrl }: CinemaModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Lock body scroll while modal is open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const parsed = parseCinematicVideo(videoUrl);
  if (parsed.kind === "invalid") return null;

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cinematic video player"
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 px-4 py-8"
      style={{
        backdropFilter: "blur(12px) brightness(0.5)",
        WebkitBackdropFilter: "blur(12px) brightness(0.5)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-5xl"
      >
        <button
          onClick={onClose}
          aria-label="Close cinematic player"
          className="absolute -top-12 right-0 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-[0_25px_80px_-15px_rgba(0,0,0,0.7)]">
          {parsed.kind === "mp4" ? (
            <video
              src={parsed.embedUrl}
              controls
              autoPlay
              className="h-full w-full rounded-2xl"
            />
          ) : (
            <iframe
              src={parsed.embedUrl}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              title="Cinematic property video"
            />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
