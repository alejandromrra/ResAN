import { z } from "zod";

/**
 * Módulos activables por local (informe, sección 5). Solo están los que ya
 * tienen comportamiento en el servidor; el resto se añade con cada fase.
 */
export const FeaturesSchema = z.object({
  kitchenDisplay: z.boolean().default(true),
  waiterView: z.boolean().default(true),
  serviceCalls: z.boolean().default(true),
});
export type Features = z.infer<typeof FeaturesSchema>;

export const PLANS = ["esencial", "profesional", "premium"] as const;
export type Plan = (typeof PLANS)[number];

/**
 * En la v1 la vista de sala es necesaria para operar las sesiones de mesa, por
 * eso también está en Esencial. Cierre automático de sesiones: pendiente.
 */
export const PLAN_FEATURES: Record<Plan, Features> = {
  esencial: { kitchenDisplay: true, waiterView: true, serviceCalls: false },
  profesional: { kitchenDisplay: true, waiterView: true, serviceCalls: true },
  premium: { kitchenDisplay: true, waiterView: true, serviceCalls: true },
};

export function resolveFeatures(stored: unknown): Features {
  return FeaturesSchema.parse(stored ?? {});
}
