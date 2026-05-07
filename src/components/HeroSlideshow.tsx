import { useEffect, useState } from "react";
import slide1 from "@/assets/hero-slide-1.png";
import slide2 from "@/assets/hero-slide-2.png";
import slide3 from "@/assets/hero-slide-3.png";
import slide4 from "@/assets/hero-slide-4.png";

const slides = [
  { src: slide1, caption: "From your studio, clients easily customize their 3D tour presentations 😉" },
  { src: slide2, caption: "Each presentation is a multi-property showcase ready to download, host & distribute 😃" },
  { src: slide3, caption: "Visitors can chat for automated answers based on property info uploaded by client 😇" },
  { src: slide4, caption: "Visitor interest can be direct or auto-detected to capture high quality leads 🤩" },
];

const INTERVAL_MS = 4000;

export function HeroSlideshow() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (mq.matches) return;
    }
    const id = setInterval(() => {
      setActive((i) => (i + 1) % slides.length);
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative w-full" style={{ aspectRatio: "1250 / 690" }}>
      {slides.map((s, i) => (
        <div
          key={i}
          className={`absolute inset-0 transition-opacity duration-500 ease-in-out ${
            i === active ? "opacity-100" : "opacity-0"
          }`}
          aria-hidden={i !== active}
        >
          <img
            src={s.src}
            alt={s.caption}
            className="h-full w-full object-cover"
            loading={i === 0 ? "eager" : "lazy"}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <p
              className="mx-4 max-w-lg text-center text-lg font-medium text-white/95 sm:text-xl lg:text-2xl"
              style={{ textShadow: "0 2px 12px rgba(0,0,0,0.85)" }}
            >
              {s.caption}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
