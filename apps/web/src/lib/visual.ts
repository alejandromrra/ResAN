import type { Allergen, Tag } from "@resan/shared";

/** Pictogramas para identificar alérgenos de un vistazo (el texto oficial va siempre al lado). */
export const ALLERGEN_ICON: Record<Allergen, string> = {
  gluten: "🌾", crustaceans: "🦐", eggs: "🥚", fish: "🐟", peanuts: "🥜", soy: "🫘", milk: "🥛",
  nuts: "🌰", celery: "🥬", mustard: "🟡", sesame: "⚪", sulphites: "🍷", lupin: "🌼", molluscs: "🦪",
};

export const TAG_STYLE: Record<Tag, { icon: string; cls: string }> = {
  vegan: { icon: "🌱", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  vegetarian: { icon: "🥕", cls: "bg-lime-50 text-lime-800 ring-lime-200" },
  gluten_free: { icon: "🚫🌾", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  spicy: { icon: "🌶️", cls: "bg-red-50 text-red-700 ring-red-200" },
  new: { icon: "✨", cls: "bg-violet-50 text-violet-700 ring-violet-200" },
  recommended: { icon: "★", cls: "bg-brand-50 text-brand-700 ring-brand-200" },
};
