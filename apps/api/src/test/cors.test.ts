import { describe, expect, it } from "vitest";
import { isLocalNetworkOrigin } from "../app";

describe("CORS en desarrollo", () => {
  it("acepta localhost y la red local, no orígenes públicos", () => {
    for (const o of ["http://localhost:3000", "http://192.168.1.50:3000", "http://10.0.0.7:3000", "http://172.20.1.2:3000", "http://mi-mac.local:3000"]) {
      expect(isLocalNetworkOrigin(o)).toBe(true);
    }
    for (const o of ["https://evil.example", "http://8.8.8.8:3000", "http://172.32.0.1", "no-es-url"]) {
      expect(isLocalNetworkOrigin(o)).toBe(false);
    }
  });
});
