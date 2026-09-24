import { describe, expect, test, vi } from "vitest";
import { sampleSkus } from "@/data/sampleSkus";
import * as rules from "@/lib/rules";
import type { Finding } from "@/types/sku";
import { evalRuleAssertion, textMatches } from "./assertions";
import { parseEvalCsv } from "./parse";

const sku = sampleSkus[0]!;

describe("eval rule assertions", () => {
  test("RULE-05: finding_not_flagged rule_ids [AMZ-DESC-05] text 'your' passes when only an AMZ-BULLET-03 finding contains 'your'", () => {
    const only: Finding = { id: "bullet_1:AMZ-BULLET-03:0", rule_id: "AMZ-BULLET-03", field: "bullet_1", severity: "low", message: "use a HEADER: format", evidence: "Keeps your dog busy" };
    const spy = vi.spyOn(rules, "auditSku").mockReturnValue([only]);
    const r = evalRuleAssertion({ type: "finding_not_flagged", rule_ids: ["AMZ-DESC-05"], text: "your" }, sku, sampleSkus);
    expect(r.pass).toBe(true);
    const any = evalRuleAssertion({ type: "finding_not_flagged", rule_ids: [], text: "your" }, sku, sampleSkus);
    expect(any.pass).toBe(false);
    spy.mockRestore();
  });

  test("parser reads rule_ids array and rule_id string", () => {
    const head = "sku_id,is_client,competitor_group,brand,category,title,bullet_1,description,image_urls,expectations\n";
    const exp = JSON.stringify([{ type: "finding_not_flagged", rule_ids: ["AMZ-DESC-05"], text: "your" }, { type: "finding_flagged", rule_id: "AMZ-TITLE-06" }]);
    const { set } = parseEvalCsv(`${head}X1,true,g,B,c,T,b,d,,"${exp.replace(/"/g, '""')}"\n`, "t.csv");
    const a = set!.rows[0]!.assertions as { rule_ids: string[] }[];
    expect(a[0]!.rule_ids).toEqual(["AMZ-DESC-05"]);
    expect(a[1]!.rule_ids).toEqual(["AMZ-TITLE-06"]);
  });

  test("text matching works both ways, case-insensitive", () => {
    expect(textMatches("Customers love", "customers love it")).toBe(true);
    expect(textMatches("deal", "free shipping")).toBe(false);
  });

  test("identifier placeholder satisfies AMZ-TITLE-06", () => {
    const has06 = (t: string) => rules.validateText("title", t, sku, sampleSkus).some((f) => f.rule_id === "AMZ-TITLE-06");
    expect(has06(`${sku.brand} Dog Toy [confirm: pack size]`)).toBe(false);
    expect(has06(`${sku.brand} Dog Toy [confirm: material]`)).toBe(true);
  });
});

describe("rules", () => {
  test.each(["BPA-FREE CANS: Made in the USA with BPA-free can linings", "EASY CARE (BETWEEN USES): Rinse and air dry"])("header detected: %s", (b) => {
    const f = rules.checkBullets([b], sku, sampleSkus).filter((x) => x.rule_id === "AMZ-BULLET-03" || x.rule_id === "AMZ-BULLET-06");
    expect(f).toEqual([]);
  });

  test("AMZ-RESTRICT-05 never matches 'rated for …'", () => {
    const f = rules.checkDescription("Sealed pouch, rated for storage up to 12 months.", sku, sampleSkus);
    expect(f.some((x) => x.rule_id === "AMZ-RESTRICT-05")).toBe(false);
    expect(rules.checkDescription("Top rated by owners.", sku, sampleSkus).some((x) => x.rule_id === "AMZ-RESTRICT-05")).toBe(true);
  });
});
