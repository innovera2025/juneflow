/*
 * ap-cn-dn-rows unit tests (ap.cn-dn, gate G3) — the pure register + form logic ported from
 * pototype/ap.jsx APCreditDebit (toNoteRow narrowing / combine + newest-first / signed value + tone /
 * status narrowing / KPI derivation / ref-billing label) + CNDNForm (money=SERVER body shape).
 * ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toNoteRow,
  combineNotes,
  signedValue,
  valueTone,
  statusKind,
  statusTone,
  formatMoney,
  formatSignedMoney,
  formatDate,
  noteKpis,
  toApBillingPick,
  apBillingLabel,
  emptyNoteDraft,
  parseAmount,
  noteFormValid,
  buildCreateNoteBody,
  type NoteDraft,
  type NoteRow,
} from "./ap-cn-dn-rows";

const draft = (p: Partial<NoteDraft> = {}): NoteDraft => ({
  vendorId: "v1",
  refApId: "ap1",
  amount: "25500",
  reason: "return defective steel",
  ...p,
});

describe("toNoteRow", () => {
  it("narrows an opaque CN wire row and tags kind", () => {
    const r = toNoteRow(
      {
        id: "cn1",
        no: "CN-2026-0006",
        vendor_id: "ven1",
        ref_ap_id: "bill1",
        reason: "return",
        amount: 25500,
        currency_code: "THB",
        status: "approved",
        note_date: "2026-05-21",
        created_at: "2026-05-21T00:00:00.000Z",
      },
      "CN",
    );
    expect(r).toEqual({
      id: "cn1",
      kind: "CN",
      no: "CN-2026-0006",
      vendorId: "ven1",
      refApId: "bill1",
      reason: "return",
      amount: 25500,
      currencyCode: "THB",
      status: "approved",
      noteDate: "2026-05-21",
      createdAt: "2026-05-21T00:00:00.000Z",
    });
  });

  it("coerces a null status / null reason to '' and a string amount to a number", () => {
    const r = toNoteRow({ id: "dn1", amount: "18200", status: null, reason: null }, "DN");
    expect(r.kind).toBe("DN");
    expect(r.status).toBe("");
    expect(r.reason).toBe("");
    expect(r.amount).toBe(18200);
  });
});

describe("combineNotes", () => {
  it("tags both lists and sorts newest-first by created_at", () => {
    const cn = [{ id: "cn1", created_at: "2026-05-18T00:00:00Z" }];
    const dn = [{ id: "dn1", created_at: "2026-05-21T00:00:00Z" }];
    const rows = combineNotes(cn, dn);
    expect(rows.map((r) => r.id)).toEqual(["dn1", "cn1"]);
    expect(rows.map((r) => r.kind)).toEqual(["DN", "CN"]);
  });

  it("returns [] for two empty lists", () => {
    expect(combineNotes([], [])).toEqual([]);
  });
});

describe("signedValue + valueTone", () => {
  it("makes a CN negative (a reduction) and a DN positive (an increase)", () => {
    expect(signedValue("CN", 25500)).toBe(-25500);
    expect(signedValue("DN", 12200)).toBe(12200);
  });

  it("takes the magnitude regardless of the stored sign", () => {
    expect(signedValue("CN", -25500)).toBe(-25500);
  });

  it("tones a CN green (ok) and a DN red (danger)", () => {
    expect(valueTone("CN")).toBe("var(--ok)");
    expect(valueTone("DN")).toBe("var(--danger)");
  });
});

describe("statusKind + statusTone", () => {
  it("maps approved/pending and everything-else -> draft (incl '')", () => {
    expect(statusKind("approved")).toBe("approved");
    expect(statusKind("pending")).toBe("pending");
    expect(statusKind("")).toBe("draft");
    expect(statusKind("weird")).toBe("draft");
  });

  it("tones each kind via tokens + a verbatim dot hex", () => {
    expect(statusTone("approved")).toEqual({ bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" });
    expect(statusTone("draft").fg).toBe("var(--draft)");
  });
});

describe("formatMoney + formatSignedMoney", () => {
  it("groups thousands (ASCII only)", () => {
    expect(formatMoney(25500)).toBe("25,500");
    expect(formatMoney(-14500)).toBe("-14,500");
    expect(formatMoney(Number.NaN)).toBe("0");
  });

  it("prefixes a positive with + and keeps a negative's -", () => {
    expect(formatSignedMoney(18200)).toBe("+18,200");
    expect(formatSignedMoney(-32700)).toBe("-32,700");
    expect(formatSignedMoney(0)).toBe("0");
  });
});

describe("formatDate", () => {
  it("prefers note_date, else created_at, formatted YYYY-MM-DD", () => {
    expect(formatDate("2026-05-21", "2026-01-01T00:00:00Z")).toBe("2026-05-21");
    expect(formatDate("", "2026-05-21T10:00:00.000Z")).toBe("2026-05-21");
  });

  it("returns '' for missing/invalid input (the cell then em-dashes)", () => {
    expect(formatDate("", "")).toBe("");
    expect(formatDate("not-a-date", "")).toBe("");
  });
});

describe("noteKpis", () => {
  it("derives CN/DN counts + amounts + net AP (DN increases - CN reductions)", () => {
    const rows: NoteRow[] = [
      toNoteRow({ id: "c1", amount: 25500 }, "CN"),
      toNoteRow({ id: "c2", amount: 7200 }, "CN"),
      toNoteRow({ id: "d1", amount: 12200 }, "DN"),
      toNoteRow({ id: "d2", amount: 6000 }, "DN"),
    ];
    const k = noteKpis(rows);
    expect(k.cnCount).toBe(2);
    expect(k.dnCount).toBe(2);
    expect(k.cnAmount).toBe(32700);
    expect(k.dnAmount).toBe(18200);
    expect(k.netAp).toBe(18200 - 32700); // -14,500 (CN outweighs DN)
  });

  it("is all-zero for no rows", () => {
    expect(noteKpis([])).toEqual({ cnCount: 0, dnCount: 0, cnAmount: 0, dnAmount: 0, netAp: 0 });
  });
});

describe("apBillingLabel", () => {
  it("joins invoice_no + vendor_name, falling back through what is present", () => {
    expect(apBillingLabel(toApBillingPick({ id: "b1", invoice_no: "INV-01", vendor_name: "Steel Co" }))).toBe(
      "INV-01 · Steel Co",
    );
    expect(apBillingLabel(toApBillingPick({ id: "b2", vendor_name: "Steel Co" }))).toBe("Steel Co");
    expect(apBillingLabel(toApBillingPick({ id: "b3" }))).toBe(""); // no doc-number, no fields -> caller em-dashes
  });
});

describe("form validity + money=SERVER body shape", () => {
  it("parses a positive amount, else 0", () => {
    expect(parseAmount("25500")).toBe(25500);
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("")).toBe(0);
    expect(parseAmount("-5")).toBe(0);
  });

  it("requires vendor + ref + positive amount + a non-blank reason", () => {
    expect(noteFormValid(draft())).toBe(true);
    expect(noteFormValid(draft({ vendorId: "" }))).toBe(false);
    expect(noteFormValid(draft({ refApId: "" }))).toBe(false);
    expect(noteFormValid(draft({ amount: "0" }))).toBe(false);
    expect(noteFormValid(draft({ reason: "  " }))).toBe(false);
    expect(noteFormValid(emptyNoteDraft())).toBe(false);
  });

  it("builds a body with ONLY {vendor_id, ref_ap_id, amount, reason} — no no/status/JV (money=SERVER)", () => {
    const body = buildCreateNoteBody(draft({ amount: "25500", reason: "  return  " }));
    expect(body).toEqual({
      vendor_id: "v1",
      ref_ap_id: "ap1",
      amount: 25500,
      reason: "return",
    });
    // money=SERVER: the client never sends a number, status, balance, or JV.
    expect(Object.keys(body).sort()).toEqual(["amount", "reason", "ref_ap_id", "vendor_id"]);
    expect(typeof body.amount).toBe("number");
    expect(body).not.toHaveProperty("no");
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("jv");
  });
});
