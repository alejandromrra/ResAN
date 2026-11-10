import { describe, expect, it } from "vitest";
import {
  ALLERGENS,
  ALLERGEN_LABELS,
  LANGUAGES,
  TAGS,
  TAG_LABELS,
  allowedNextStatuses,
  can,
  canTransition,
  deriveTableStatus,
  pickLanguage,
  resolveFeatures,
} from "./index";

describe("i18n", () => {
  it("tiene etiqueta de cada alérgeno y etiqueta en todos los idiomas", () => {
    for (const lang of LANGUAGES) {
      for (const a of ALLERGENS) expect(ALLERGEN_LABELS[lang][a]).toBeTruthy();
      for (const t of TAGS) expect(TAG_LABELS[lang][t]).toBeTruthy();
    }
    expect(ALLERGENS).toHaveLength(14);
  });

  it("elige idioma del navegador si el local lo ofrece, si no el de por defecto", () => {
    expect(pickLanguage("fr-FR", ["es", "fr"], "es")).toBe("fr");
    expect(pickLanguage("de", ["es", "en"], "es")).toBe("es");
    expect(pickLanguage(undefined, ["es", "en"], "en")).toBe("en");
    expect(pickLanguage("xx", ["es"], "es")).toBe("es");
  });
});

describe("rbac", () => {
  it("sigue la matriz del informe", () => {
    expect(can("owner", "venue.settings")).toBe(true);
    expect(can("manager", "venue.settings")).toBe(false);
    expect(can("manager", "menu.edit")).toBe(true);
    expect(can("waiter", "menu.edit")).toBe(false);
    expect(can("waiter", "bill.manage")).toBe(true);
    expect(can("kitchen", "bill.manage")).toBe(false);
    expect(can("kitchen", "item.availability")).toBe(true);
  });
});

describe("transiciones de línea", () => {
  it("cocina avanza lo que se cocina pero no sirve", () => {
    expect(canTransition("kitchen", "kitchen", "new", "preparing")).toBe(true);
    expect(canTransition("kitchen", "kitchen", "preparing", "ready")).toBe(true);
    expect(canTransition("kitchen", "kitchen", "ready", "served")).toBe(false);
  });

  it("el camarero sirve platos listos y bebidas directas, pero no cocina", () => {
    expect(canTransition("waiter", "kitchen", "ready", "served")).toBe(true);
    expect(canTransition("waiter", "serve", "new", "served")).toBe(true);
    expect(canTransition("waiter", "kitchen", "new", "preparing")).toBe(false);
    expect(canTransition("waiter", "serve", "new", "preparing")).toBe(false);
  });

  it("solo encargado y propietario anulan o deshacen un servido", () => {
    expect(canTransition("waiter", "kitchen", "new", "cancelled")).toBe(false);
    expect(canTransition("manager", "kitchen", "new", "cancelled")).toBe(true);
    expect(canTransition("manager", "kitchen", "served", "ready")).toBe(true);
    expect(canTransition("waiter", "kitchen", "served", "ready")).toBe(false);
  });

  it("lista los siguientes estados permitidos", () => {
    expect(allowedNextStatuses("kitchen", "kitchen", "preparing").sort()).toEqual(["new", "ready"]);
  });
});

describe("estado de mesa", () => {
  const base = {
    hasOpenSession: true,
    billRequested: false,
    waiterCalling: false,
    billPrinted: false,
    pendingApproval: 0,
    readyToServe: 0,
    inProgress: 0,
  };

  it("prioriza lo más urgente", () => {
    expect(deriveTableStatus({ ...base, hasOpenSession: false })).toBe("free");
    expect(deriveTableStatus(base)).toBe("occupied");
    expect(deriveTableStatus({ ...base, inProgress: 2 })).toBe("waiting_food");
    expect(deriveTableStatus({ ...base, inProgress: 2, readyToServe: 1 })).toBe("ready_to_serve");
    expect(deriveTableStatus({ ...base, readyToServe: 1, waiterCalling: true })).toBe("calling");
    expect(deriveTableStatus({ ...base, waiterCalling: true, billRequested: true })).toBe("bill_requested");
    expect(deriveTableStatus({ ...base, billPrinted: true })).toBe("paying");
  });
});

describe("módulos", () => {
  it("aplica valores por defecto", () => {
    expect(resolveFeatures(undefined)).toEqual({ kitchenDisplay: true, waiterView: true, serviceCalls: true });
    expect(resolveFeatures({ serviceCalls: false }).serviceCalls).toBe(false);
  });
});
