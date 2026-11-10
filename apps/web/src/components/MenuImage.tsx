"use client";
import { useState } from "react";
import { UtensilsCrossed } from "lucide-react";
import { cx } from "./ui";

/** Imagen de plato con aparición suave y respaldo si no hay foto o falla la carga. */
export function MenuImage({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={cx(className, "flex items-center justify-center bg-gradient-to-br from-brand-50 to-stone-100 text-brand-300")} aria-hidden>
        <UtensilsCrossed className="size-1/3 max-h-10 max-w-10" />
      </div>
    );
  }
  return (
    <div className={cx(className, "relative overflow-hidden bg-stone-100")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={cx("size-full object-cover transition duration-700", loaded ? "scale-100 opacity-100" : "scale-105 opacity-0")}
      />
    </div>
  );
}
