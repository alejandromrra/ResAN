"use client";
import { API_URL } from "@/lib/api";

/** Las rutas relativas (/demo/x.svg) las sirve la web; las absolutas se usan tal cual. */
export function MenuImage({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  if (!src) return <div className={`${className ?? ""} flex items-center justify-center bg-stone-100 text-3xl`} aria-hidden>🍽️</div>;
  void API_URL;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" className={`${className ?? ""} object-cover`} />;
}
