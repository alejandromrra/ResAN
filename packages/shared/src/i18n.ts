export const LANGUAGES = ["es", "ca", "en", "fr", "it", "de"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<Language, string> = {
  es: "Español",
  ca: "Català",
  en: "English",
  fr: "Français",
  it: "Italiano",
  de: "Deutsch",
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Elige el idioma a mostrar: el pedido si el local lo ofrece, si no el idioma
 * por defecto del local.
 */
export function pickLanguage(
  requested: string | undefined | null,
  available: readonly Language[],
  fallback: Language,
): Language {
  if (requested) {
    const base = requested.toLowerCase().split("-")[0];
    if (isLanguage(base) && available.includes(base)) return base;
  }
  return fallback;
}

/** Los 14 alérgenos de declaración obligatoria (Reglamento UE 1169/2011). */
export const ALLERGENS = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soy",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export function isAllergen(value: unknown): value is Allergen {
  return typeof value === "string" && (ALLERGENS as readonly string[]).includes(value);
}

/** Terminología fija por idioma. No se traduce de forma automática. */
export const ALLERGEN_LABELS: Record<Language, Record<Allergen, string>> = {
  es: {
    gluten: "Gluten", crustaceans: "Crustáceos", eggs: "Huevos", fish: "Pescado",
    peanuts: "Cacahuetes", soy: "Soja", milk: "Lácteos", nuts: "Frutos de cáscara",
    celery: "Apio", mustard: "Mostaza", sesame: "Sésamo", sulphites: "Sulfitos",
    lupin: "Altramuces", molluscs: "Moluscos",
  },
  ca: {
    gluten: "Gluten", crustaceans: "Crustacis", eggs: "Ous", fish: "Peix",
    peanuts: "Cacauets", soy: "Soja", milk: "Làctics", nuts: "Fruits de closca",
    celery: "Api", mustard: "Mostassa", sesame: "Sèsam", sulphites: "Sulfits",
    lupin: "Tramussos", molluscs: "Mol·luscs",
  },
  en: {
    gluten: "Gluten", crustaceans: "Crustaceans", eggs: "Eggs", fish: "Fish",
    peanuts: "Peanuts", soy: "Soy", milk: "Milk", nuts: "Tree nuts",
    celery: "Celery", mustard: "Mustard", sesame: "Sesame", sulphites: "Sulphites",
    lupin: "Lupin", molluscs: "Molluscs",
  },
  fr: {
    gluten: "Gluten", crustaceans: "Crustacés", eggs: "Œufs", fish: "Poisson",
    peanuts: "Arachides", soy: "Soja", milk: "Lait", nuts: "Fruits à coque",
    celery: "Céleri", mustard: "Moutarde", sesame: "Sésame", sulphites: "Sulfites",
    lupin: "Lupin", molluscs: "Mollusques",
  },
  it: {
    gluten: "Glutine", crustaceans: "Crostacei", eggs: "Uova", fish: "Pesce",
    peanuts: "Arachidi", soy: "Soia", milk: "Latte", nuts: "Frutta a guscio",
    celery: "Sedano", mustard: "Senape", sesame: "Sesamo", sulphites: "Solfiti",
    lupin: "Lupini", molluscs: "Molluschi",
  },
  de: {
    gluten: "Gluten", crustaceans: "Krebstiere", eggs: "Eier", fish: "Fisch",
    peanuts: "Erdnüsse", soy: "Soja", milk: "Milch", nuts: "Schalenfrüchte",
    celery: "Sellerie", mustard: "Senf", sesame: "Sesam", sulphites: "Sulfite",
    lupin: "Lupinen", molluscs: "Weichtiere",
  },
};

export const TAGS = ["vegan", "vegetarian", "gluten_free", "spicy", "new", "recommended"] as const;
export type Tag = (typeof TAGS)[number];

export function isTag(value: unknown): value is Tag {
  return typeof value === "string" && (TAGS as readonly string[]).includes(value);
}

export const TAG_LABELS: Record<Language, Record<Tag, string>> = {
  es: { vegan: "Vegano", vegetarian: "Vegetariano", gluten_free: "Sin gluten", spicy: "Picante", new: "Novedad", recommended: "Recomendado" },
  ca: { vegan: "Vegà", vegetarian: "Vegetarià", gluten_free: "Sense gluten", spicy: "Picant", new: "Novetat", recommended: "Recomanat" },
  en: { vegan: "Vegan", vegetarian: "Vegetarian", gluten_free: "Gluten-free", spicy: "Spicy", new: "New", recommended: "Recommended" },
  fr: { vegan: "Végétalien", vegetarian: "Végétarien", gluten_free: "Sans gluten", spicy: "Épicé", new: "Nouveau", recommended: "Recommandé" },
  it: { vegan: "Vegano", vegetarian: "Vegetariano", gluten_free: "Senza glutine", spicy: "Piccante", new: "Novità", recommended: "Consigliato" },
  de: { vegan: "Vegan", vegetarian: "Vegetarisch", gluten_free: "Glutenfrei", spicy: "Scharf", new: "Neu", recommended: "Empfohlen" },
};
