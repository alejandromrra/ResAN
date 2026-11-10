import { eq } from "drizzle-orm";
import { isLanguage, resolveFeatures, type Features, type Language } from "@resan/shared";
import type { Ctx } from "../context";
import { venues } from "../db/schema";
import { forbidden, notFound } from "./errors";
import type { VenueRow } from "../services/menu";

export async function getVenue(ctx: Ctx, venueId: string): Promise<VenueRow> {
  const [v] = await ctx.db.select().from(venues).where(eq(venues.id, venueId));
  if (!v) throw notFound("venue_not_found");
  return v;
}

export const venueLanguages = (v: VenueRow): Language[] => v.languages.filter(isLanguage);
export const venueDefaultLanguage = (v: VenueRow): Language =>
  isLanguage(v.defaultLanguage) ? v.defaultLanguage : "es";

export function assertFeature(v: VenueRow, feature: keyof Features): void {
  if (!resolveFeatures(v.features)[feature]) throw forbidden("feature_disabled", { feature });
}
