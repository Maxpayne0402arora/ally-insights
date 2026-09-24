import { describe, expect, test } from "vitest";
import { sampleSkus } from "@/data/sampleSkus";
import { auditSku, validateText } from "@/lib/rules";
import { evalRuleAssertion, textMatches } from "./assertions";

describe("eval rule assertions", () => {
  test("finding_not_flagged with rule_ids [AMZ-TITLE-06] and empty text ignores bullet findings", () => {
    const sku = sampleSkus.find((s) => s.is_client && auditSku(s, sampleSkus).some((f) => f.field.startsWith("bullet")) && !auditSku(s, sampleSkus).some((f) => f.rule_id === "AMZ-TITLE-06"))!;
    expect(sku).toBeDefined();
    const r = evalRuleAssertion({ type: "finding_not_flagged", rule_id: "AMZ-TITLE-06", text: "" }, sku, sampleSkus);
    expect(r.pass).toBe(true);
  });

  test("text matching works both ways, case-insensitive", () => {
    expect(textMatches("Customers love", "customers love it")).toBe(true);
    expect(textMatches("customers love it", "Customers LOVE")).toBe(true);
    expect(textMatches("deal", "free shipping")).toBe(false);
  });

  test("identifier placeholder satisfies AMZ-TITLE-06", () => {
    const sku = sampleSkus[0]!;
    const has06 = (t: string) => validateText("title", t, sku, sampleSkus).some((f) => f.rule_id === "AMZ-TITLE-06");
    expect(has06(`${sku.brand} Dog Toy [confirm: pack size]`)).toBe(false);
    expect(has06(`${sku.brand} Dog Toy [confirm: material]`)).toBe(true);
  });
});
