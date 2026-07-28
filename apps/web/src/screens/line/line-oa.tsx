/*
 * LineOAPreview — the "LINE OA" resident-channel preview screen, ported 1:1 from
 * pototype/line-oa.jsx (LineFrame/Bubble/CardBubble/QuickReplies/InputBar + the 12
 * chat/LIFF mockups + LineOAPreview) and pototype/line-pm.jsx (the 4 PM mockups:
 * LinePMPlan/Quote/Cert/Contracts, which line-oa.jsx references by global). Route
 * `line` (docs/extract/NAV-ROUTES.md; registry component LineOAPreview).
 *
 * section-0 fidelity (rule 1): the phone-mockup JSX structure + inline styles are the
 * prototype's, verbatim. The prototype's literal hexes (#fff, #6B6A67, #1A7F5A,
 * #B7791F, #B4453C, #ECECEA, #FAFAF9, LINE_GREEN #06C755, …) are prototype-verbatim
 * with no token equivalent (B-037a); token vars (var(--brand), var(--surface-2), …)
 * are used exactly where the prototype uses them.
 *
 * Strings (Wei ruling B-184): this is a STATIC screenshot-fixture, not translatable
 * product copy. So the ~200 hardcoded Thai/emoji demo strings inside the 16 mockups +
 * the 8 benefit bullets live BYTE-EXACT in line-oa-fixture.json (a non-.tsx fixture;
 * Thai there is not an i18n key and is not minted), while the PRODUCT chrome (page
 * title/subtitle/breadcrumb, the left screen-list nav+group labels, the right
 * OA-stats/features-title/CTA card, the QR/settings buttons + toasts) resolves through
 * the 43 applied `line.preview.*` DICT keys via t(). Result: zero raw Thai byte in this
 * .tsx (B-073) — every Thai glyph is either a fixture value or a runtime t() lookup.
 *
 * Data (rule 3): read-only static preview — NO backend, NO GET, nothing writes. The
 * left screen-list is client state (useState). QR/settings/CTA fire the prototype's own
 * ctx.notify toasts. Bubble/benefit strings that embed literal <br/>/<b> markup render
 * through renderRich (render-rich.ts) — parsed to nodes, never dangerouslySetInnerHTML.
 */
import { useState, type ReactNode } from "react";
import type { DictKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { useShellCtx } from "../../shell/shell-context";
import { Page } from "../../shell/page";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { renderRich } from "./render-rich";
import fxJson from "./line-oa-fixture.json" with { type: "json" };

/* Fixture shape (line-oa-fixture.json). Every leaf is verified BYTE-EXACT against the
 * prototype sources by scripts, so this hand-authored interface is the typed boundary
 * for the JSON import (single cast; the runtime shape is guaranteed by the builder). */
interface FxRow { l: string; v: string; c?: string }
interface FxCard { title: string; badge?: string; badgeColor?: string; footer?: string; rows?: FxRow[] }
interface FxMenu { i: string; l: string; c: string }
interface FxCat { i: string; l: string; a?: boolean }
interface FxStep { l: string; t: string }
interface FxKv { l: string; v: string }
interface Fixture {
  primitives: { frameTitle: string; online: string; readLabel: string; inputPlaceholder: string };
  home: { welcome: string; name: string; meta: string; greet: string; menuHint: string; menu: FxMenu[] };
  report: { date: string; ask: string; ack: string; chooseCat: string; pick: string; sendPhoto: string; card: FxCard; quick: string[]; inputPh: string };
  track: { date: string; ask: string; steps: string; onSite: string; statusCard: FxCard; historyCard: FxCard };
  warranty: { date: string; ask: string; listIntro: string; list: string; card: FxCard; quick: string[] };
  payment: { date: string; ask: string; remind: string; askPromo: string; promoReply: string; card: FxCard; quick: string[] };
  promo: { date: string; hot: string; newsIntro: string; promoEyebrow: string; promoTitle: string; promoWithin: string; promoUnit: string; promoSpec: string; promoDiscount: string; promoBook: string; promoContact: string; promoMore: string; newsCard: FxCard; quick: string[] };
  common: { date: string; ask: string; confirm: string; remind: string; slotCard: FxCard; bookedCard: FxCard; quick: string[] };
  sales: { date: string; ask: string; intro: string; agentInitials: string; agentName: string; agentRole: string; agentRating: string; btnChat: string; btnCall: string; infoCard: FxCard; quick: string[] };
  liffReport: { frameTitle: string; header: string; boundLabel: string; unit: string; unitSub: string; warrantyBadge: string; catTitle: string; cats: FxCat[]; descTitle: string; descText: string; photoTitle: string; photoAdd: string; apptTitle: string; apptVal: string; btnDraft: string; btnSubmit: string };
  liffTrack: { frameTitle: string; statusLabel: string; statusVal: string; statusSub: string; timelineTitle: string; steps: FxStep[]; techLabel: string; techInitials: string; techName: string; techRole: string; rateText: string; star: string; contactBtn: string };
  push: { frameTitle: string; date: string; b1: string; b2: string; b3: string; b4: string; card1: FxCard; card2: FxCard; card3: FxCard; card4: FxCard };
  bind: { frameTitle: string; header: string; welcome: string; welcomeSub: string; lineName: string; lineSub: string; confirmBadge: string; unitsTitle: string; unit: string; unitSub: string; addUnit: string; warrantyTitle: string; warrantyRows: FxRow[]; saveBtn: string };
  feat: string[];
  pmPlan: { date: string; ask: string; intro: string; notice: string; planCard: FxCard; historyCard: FxCard };
  pmQuote: { date: string; offer: string; approve: string; thanks: string; card: FxCard; btnApprove: string; btnReject: string; btnPdf: string };
  pmCert: { date: string; done: string; certEyebrow: string; certTitle: string; certDocNo: string; certKv: FxKv[]; beforeLabel: string; afterLabel: string; passLine: string; certFooter: string; quick: string[] };
  pmContracts: { date: string; ask: string; listCard: FxCard; expiryCard: FxCard; btnRenew: string; btnContact: string };
}
const fx = fxJson as unknown as Fixture;

const LINE_GREEN = "#06C755";
const LINE_BG = "#8AB4D1";

/** Fill "{token}" placeholders in a t() template (i18n has no interpolation, B-017). */
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

/* ── Shared phone-mockup primitives (ported from line-oa.jsx L6-108) ───────────── */

function LineFrame({ children, title = fx.primitives.frameTitle }: { children: ReactNode; title?: string }) {
  return (
    <div style={{ width: 390, height: 844, background: LINE_BG, borderRadius: 44, padding: 12, boxShadow: "0 30px 60px -20px rgba(0,0,0,0.3)", position: "relative", overflow: "hidden" }}>
      <div style={{ height: "100%", background: "#fff", borderRadius: 32, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* iOS Status bar */}
        <div style={{ height: 36, background: LINE_GREEN, color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", fontSize: 12, fontWeight: 600 }}>
          <span>9:41</span>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 10 }}>●●●</span>
          </div>
        </div>
        {/* LINE chat header */}
        <div style={{ background: LINE_GREEN, color: "#fff", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="chevL" size={20} color="#fff" />
          <div style={{ width: 36, height: 36, borderRadius: 999, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: LINE_GREEN, fontSize: 13, fontWeight: 800, position: "relative" }}>
            JF
            <span style={{ position: "absolute", bottom: -2, right: -2, width: 12, height: 12, borderRadius: 999, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: "#FFD400", border: "1.5px solid #fff" }} />
            </span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
              {title} <span style={{ fontSize: 8, padding: "1px 5px", background: "#FFD400", color: "#1C1B1A", borderRadius: 3, fontWeight: 800 }}>OA</span>
            </div>
            <div style={{ fontSize: 10.5, opacity: 0.9 }}>{fx.primitives.online}</div>
          </div>
          <Icon name="search" size={18} color="#fff" />
          <Icon name="more" size={18} color="#fff" />
        </div>
        <div style={{ flex: 1, overflow: "auto", background: "#7FA8C5", padding: "12px 8px" }}>{children}</div>
      </div>
    </div>
  );
}

const DateSep = ({ children }: { children: ReactNode }) => (
  <div style={{ textAlign: "center", margin: "10px 0", fontSize: 11, color: "#fff", fontWeight: 600 }}>
    <span style={{ padding: "3px 12px", background: "rgba(0,0,0,0.18)", borderRadius: 999 }}>{children}</span>
  </div>
);

const Bubble = ({ side = "oa", children, time, read = true }: { side?: "oa" | "user"; children: ReactNode; time: string; read?: boolean }) => (
  <div style={{ display: "flex", marginBottom: 6, justifyContent: side === "user" ? "flex-end" : "flex-start", gap: 6, alignItems: "flex-end" }}>
    {side === "oa" && <div style={{ width: 30, height: 30, borderRadius: 999, background: LINE_GREEN, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>JF</div>}
    <div>
      <div style={{
        maxWidth: 240, padding: "8px 12px",
        background: side === "user" ? LINE_GREEN : "#fff",
        color: side === "user" ? "#fff" : "#1C1B1A",
        borderRadius: side === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
        fontSize: 13, lineHeight: 1.5,
        boxShadow: "0 1px 1px rgba(0,0,0,0.05)",
      }}>{children}</div>
      <div style={{ fontSize: 9.5, color: "rgba(255,255,255,0.85)", textAlign: side === "user" ? "right" : "left", marginTop: 2, fontWeight: 600 }}>
        {read && side === "user" && <span style={{ marginRight: 4 }}>{fx.primitives.readLabel}</span>}
        {time}
      </div>
    </div>
  </div>
);

const CardBubble = ({ title, badge, badgeColor, rows, footer }: FxCard) => (
  <div style={{ display: "flex", marginBottom: 6, gap: 6, alignItems: "flex-end" }}>
    <div style={{ width: 30, height: 30, borderRadius: 999, background: LINE_GREEN, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>JF</div>
    <div style={{ width: 260, background: "#fff", borderRadius: "16px 16px 16px 4px", overflow: "hidden", boxShadow: "0 1px 1px rgba(0,0,0,0.05)" }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #ECECEA", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{title}</span>
        {badge && <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: `${badgeColor}1A`, color: badgeColor }}>{badge}</span>}
      </div>
      {rows && (
        <div style={{ padding: "8px 12px" }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 11.5, borderBottom: i < rows.length - 1 ? "1px dashed #F0EFEB" : "none" }}>
              <span style={{ color: "#6B6A67" }}>{r.l}</span>
              <span style={{ color: r.c || "#1C1B1A", fontWeight: 600 }}>{r.v}</span>
            </div>
          ))}
        </div>
      )}
      {footer && <div style={{ padding: "10px 12px", background: "#FAFAF9", fontSize: 11, color: "var(--brand)", fontWeight: 600, textAlign: "center", borderTop: "1px solid #ECECEA" }}>{footer} →</div>}
    </div>
  </div>
);

const QuickReplies = ({ items, sel }: { items: string[]; sel?: number | null }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 0 4px 36px" }}>
    {items.map((q, i) => (
      <div key={i} style={{
        padding: "6px 12px", background: sel === i ? LINE_GREEN : "#fff", color: sel === i ? "#fff" : LINE_GREEN,
        border: `1px solid ${LINE_GREEN}`, borderRadius: 999, fontSize: 11.5, fontWeight: 600,
      }}>{q}</div>
    ))}
  </div>
);

const InputBar = ({ placeholder = fx.primitives.inputPlaceholder }: { placeholder?: string }) => (
  <div style={{ padding: "8px 10px 12px", background: "#fff", borderTop: "1px solid #ECECEA", display: "flex", alignItems: "center", gap: 8 }}>
    <Icon name="plus" size={20} color="var(--brand)" />
    <Icon name="grid" size={18} color="#6B6A67" />
    <div style={{ flex: 1, padding: "8px 14px", background: "#F0EFEB", borderRadius: 999, fontSize: 12, color: "#98968F" }}>{placeholder}</div>
    <Icon name="check" size={20} color="var(--brand)" />
  </div>
);

/* ── 1. Rich Menu / Home ───────────────────────────────────────────────────────── */
function LineHome() {
  return (
    <LineFrame>
      <div style={{ background: "linear-gradient(135deg, var(--brand), #0B5F58)", margin: "0 0 8px", padding: "16px 12px", borderRadius: 12, color: "#fff", textAlign: "center" }}>
        <div style={{ fontSize: 11, opacity: 0.9 }}>{fx.home.welcome}</div>
        <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>{fx.home.name}</div>
        <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{fx.home.meta}</div>
      </div>
      <Bubble side="oa" time="14:20">{renderRich(fx.home.greet)}</Bubble>
      <div style={{ marginTop: 4 }} />
      <Bubble side="oa" time="14:20">{renderRich(fx.home.menuHint)}</Bubble>
      <div style={{ position: "absolute", bottom: 50, left: 12, right: 12 }}>
        <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.15)", border: "1px solid #ECECEA" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, background: "#ECECEA" }}>
            {fx.home.menu.map((m, i) => (
              <div key={i} style={{ background: "#fff", padding: "16px 6px", textAlign: "center" }}>
                <div style={{ fontSize: 26 }}>{m.i}</div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: m.c, marginTop: 2 }}>{m.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}><InputBar /></div>
    </LineFrame>
  );
}

/* ── 2. Repair-request chat flow ──────────────────────────────────────────────── */
function LineReport() {
  return (
    <LineFrame>
      <DateSep>{fx.report.date}</DateSep>
      <Bubble side="user" time="14:15">{renderRich(fx.report.ask)}</Bubble>
      <Bubble side="oa" time="14:15">{renderRich(fx.report.ack)}</Bubble>
      <CardBubble {...fx.report.card} />
      <Bubble side="oa" time="14:16">{renderRich(fx.report.chooseCat)}</Bubble>
      <QuickReplies items={fx.report.quick} sel={0} />
      <Bubble side="user" time="14:16">{renderRich(fx.report.pick)}</Bubble>
      <Bubble side="oa" time="14:17">{renderRich(fx.report.sendPhoto)}</Bubble>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}><InputBar placeholder={fx.report.inputPh} /></div>
    </LineFrame>
  );
}

/* ── 3. Status tracking ───────────────────────────────────────────────────────── */
function LineTrack() {
  return (
    <LineFrame>
      <DateSep>{fx.track.date}</DateSep>
      <Bubble side="user" time="10:00">{renderRich(fx.track.ask)}</Bubble>
      <CardBubble {...fx.track.statusCard} />
      <Bubble side="oa" time="10:01">{renderRich(fx.track.steps)}</Bubble>
      <Bubble side="oa" time="14:30">{renderRich(fx.track.onSite)}</Bubble>
      <CardBubble {...fx.track.historyCard} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}><InputBar /></div>
    </LineFrame>
  );
}

/* ── 4. Warranty ──────────────────────────────────────────────────────────────── */
function LineWarranty() {
  return (
    <LineFrame>
      <DateSep>{fx.warranty.date}</DateSep>
      <Bubble side="user" time="11:00">{renderRich(fx.warranty.ask)}</Bubble>
      <CardBubble {...fx.warranty.card} />
      <Bubble side="oa" time="11:01">{renderRich(fx.warranty.listIntro)}</Bubble>
      <Bubble side="oa" time="11:01">{renderRich(fx.warranty.list)}</Bubble>
      <QuickReplies items={fx.warranty.quick} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}><InputBar /></div>
    </LineFrame>
  );
}

/* ── 5. Payment + down-payment balance ────────────────────────────────────────── */
function LinePayment() {
  return (
    <LineFrame>
      <DateSep>{fx.payment.date}</DateSep>
      <Bubble side="user" time="09:30">{renderRich(fx.payment.ask)}</Bubble>
      <CardBubble {...fx.payment.card} />
      <Bubble side="oa" time="09:31">{renderRich(fx.payment.remind)}</Bubble>
      <QuickReplies items={fx.payment.quick} />
      <Bubble side="user" time="09:35">{renderRich(fx.payment.askPromo)}</Bubble>
      <Bubble side="oa" time="09:35">{renderRich(fx.payment.promoReply)}</Bubble>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}><InputBar /></div>
    </LineFrame>
  );
}

/* ── 6. Promotions & news ─────────────────────────────────────────────────────── */
function LinePromo() {
  return (
    <LineFrame>
      <DateSep>{fx.promo.date}</DateSep>
      <Bubble side="oa" time="08:00">{renderRich(fx.promo.hot)}</Bubble>
      <div style={{ display: "flex", marginBottom: 6, gap: 6, alignItems: "flex-end" }}>
        <div style={{ width: 30, height: 30, borderRadius: 999, background: LINE_GREEN, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>JF</div>
        <div style={{ width: 260, background: "#fff", borderRadius: "16px 16px 16px 4px", overflow: "hidden", boxShadow: "0 1px 1px rgba(0,0,0,0.05)" }}>
          <div style={{ height: 130, background: "linear-gradient(135deg, var(--brand), #0B5F58)", color: "#fff", padding: 14, position: "relative" }}>
            <div style={{ fontSize: 11, opacity: 0.85, fontWeight: 600 }}>{fx.promo.promoEyebrow}</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6, lineHeight: 1.2 }}>{renderRich(fx.promo.promoTitle)}</div>
            <div style={{ position: "absolute", bottom: 10, right: 12, fontSize: 9, opacity: 0.8 }}>{fx.promo.promoWithin}</div>
          </div>
          <div style={{ padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{fx.promo.promoUnit}</div>
            <div style={{ fontSize: 10.5, color: "#6B6A67", marginBottom: 8 }}>{fx.promo.promoSpec}</div>
            <div style={{ padding: "5px 10px", background: "#ECF6F3", color: "var(--brand)", fontSize: 10.5, fontWeight: 700, borderRadius: 4, display: "inline-block" }}>{fx.promo.promoDiscount}</div>
          </div>
          <div style={{ padding: "10px 12px", background: "#FAFAF9", borderTop: "1px solid #ECECEA", display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700 }}>
            <span style={{ color: "var(--brand)" }}>{fx.promo.promoBook}</span>
            <span style={{ color: "var(--brand)" }}>{fx.promo.promoContact}</span>
            <span style={{ color: "var(--brand)" }}>{fx.promo.promoMore}</span>
          </div>
        </div>
      </div>
      <Bubble side="oa" time="08:01">{renderRich(fx.promo.newsIntro)}</Bubble>
      <CardBubble {...fx.promo.newsCard} />
      <QuickReplies items={fx.promo.quick} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}><InputBar /></div>
    </LineFrame>
  );
}

/* ── 7. Common area · facility booking ────────────────────────────────────────── */
function LineCommon() {
  return (
    <LineFrame>
      <DateSep>{fx.common.date}</DateSep>
      <Bubble side="user" time="13:00">{renderRich(fx.common.ask)}</Bubble>
      <CardBubble {...fx.common.slotCard} />
      <QuickReplies items={fx.common.quick} />
      <Bubble side="user" time="13:01">{renderRich(fx.common.confirm)}</Bubble>
      <CardBubble {...fx.common.bookedCard} />
      <Bubble side="oa" time="13:02">{renderRich(fx.common.remind)}</Bubble>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}><InputBar /></div>
    </LineFrame>
  );
}

/* ── 8. Contact Sales / Juristic ──────────────────────────────────────────────── */
function LineSales() {
  return (
    <LineFrame>
      <DateSep>{fx.sales.date}</DateSep>
      <Bubble side="user" time="15:00">{renderRich(fx.sales.ask)}</Bubble>
      <Bubble side="oa" time="15:00">{renderRich(fx.sales.intro)}</Bubble>
      <div style={{ display: "flex", marginBottom: 6, gap: 6, alignItems: "flex-end" }}>
        <div style={{ width: 30, height: 30, borderRadius: 999, background: LINE_GREEN, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>JF</div>
        <div style={{ width: 260, background: "#fff", borderRadius: "16px 16px 16px 4px", overflow: "hidden", boxShadow: "0 1px 1px rgba(0,0,0,0.05)", padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 50, height: 50, borderRadius: 999, background: "var(--brand)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800 }}>{fx.sales.agentInitials}</div>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{fx.sales.agentName}</div>
              <div style={{ fontSize: 10.5, color: "#6B6A67" }}>{fx.sales.agentRole}</div>
              <div style={{ fontSize: 10.5, color: "#1A7F5A", fontWeight: 600 }}>{fx.sales.agentRating}</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10 }}>
            <div style={{ padding: "6px 10px", background: "#06C7551A", color: LINE_GREEN, borderRadius: 6, fontSize: 11, fontWeight: 700, textAlign: "center" }}>{fx.sales.btnChat}</div>
            <div style={{ padding: "6px 10px", background: "#ECF6F3", color: "var(--brand)", borderRadius: 6, fontSize: 11, fontWeight: 700, textAlign: "center" }}>{fx.sales.btnCall}</div>
          </div>
        </div>
      </div>
      <CardBubble {...fx.sales.infoCard} />
      <QuickReplies items={fx.sales.quick} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}><InputBar /></div>
    </LineFrame>
  );
}

/* ── 9. LIFF · new repair request (full-screen LIFF web view) ──────────────────── */
function LiffReport() {
  return (
    <LineFrame title={fx.liffReport.frameTitle}>
      <div style={{ height: "100%", background: "#FAFAF9", margin: "-12px -8px 0", padding: 0, overflow: "auto" }}>
        <div style={{ padding: "10px 14px 6px", display: "flex", alignItems: "center", gap: 10, background: "#fff", borderBottom: "1px solid #ECECEA" }}>
          <Icon name="x" size={18} color="#1C1B1A" />
          <div style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{fx.liffReport.header}</div>
          <span style={{ fontSize: 9, padding: "2px 6px", background: "#ECF6F3", color: "var(--brand)", borderRadius: 4, fontWeight: 700 }}>LIFF</span>
        </div>
        <div style={{ padding: "12px 14px 80px" }}>
          {/* Bound unit */}
          <div style={{ padding: 12, background: "#fff", border: "1px solid #ECECEA", borderRadius: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 10.5, color: "#6B6A67", fontWeight: 600, marginBottom: 4 }}>{fx.liffReport.boundLabel}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--brand)" }}>{fx.liffReport.unit}</div>
                <div style={{ fontSize: 10.5, color: "#6B6A67" }}>{fx.liffReport.unitSub}</div>
              </div>
              <span style={{ fontSize: 9.5, padding: "2px 7px", background: "#EAF4EE", color: "#1A7F5A", borderRadius: 999, fontWeight: 700 }}>{fx.liffReport.warrantyBadge}</span>
            </div>
          </div>
          {/* Category */}
          <div style={{ padding: 12, background: "#fff", border: "1px solid #ECECEA", borderRadius: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>{fx.liffReport.catTitle}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {fx.liffReport.cats.map((c, i) => (
                <div key={i} style={{ padding: "10px 4px", borderRadius: 8, textAlign: "center", background: c.a ? "#ECF6F3" : "#FAFAF9", border: `1.5px solid ${c.a ? "var(--brand)" : "#ECECEA"}` }}>
                  <div style={{ fontSize: 20 }}>{c.i}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: c.a ? "var(--brand)" : "#6B6A67", marginTop: 2 }}>{c.l}</div>
                </div>
              ))}
            </div>
          </div>
          {/* Description */}
          <div style={{ padding: 12, background: "#fff", border: "1px solid #ECECEA", borderRadius: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{fx.liffReport.descTitle}</div>
            <div style={{ padding: 10, background: "#FAFAF9", borderRadius: 8, fontSize: 12, minHeight: 50, color: "#1C1B1A" }}>{fx.liffReport.descText}</div>
          </div>
          {/* Photos */}
          <div style={{ padding: 12, background: "#fff", border: "1px solid #ECECEA", borderRadius: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>{fx.liffReport.photoTitle}</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 2, 3].map((i) => <div key={i} style={{ width: 64, height: 64, borderRadius: 8, background: "linear-gradient(135deg, #94A3B8, #475569)" }} />)}
              <div style={{ width: 64, height: 64, borderRadius: 8, background: "#FAFAF9", border: "1.5px dashed #D9D9D5", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--brand)" }}>
                <Icon name="plus" size={18} /><span style={{ fontSize: 8, fontWeight: 700 }}>{fx.liffReport.photoAdd}</span>
              </div>
            </div>
          </div>
          {/* Appointment */}
          <div style={{ padding: 12, background: "#fff", border: "1px solid #ECECEA", borderRadius: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{fx.liffReport.apptTitle}</div>
            <div style={{ padding: "10px 12px", background: "#ECF6F3", borderRadius: 8, fontSize: 12, color: "var(--brand)", fontWeight: 600 }}>{fx.liffReport.apptVal}</div>
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "12px 14px 24px", background: "#fff", borderTop: "1px solid #ECECEA", display: "flex", gap: 8 }}>
          <button style={{ flex: 1, height: 42, borderRadius: 10, background: "#FAFAF9", color: "#6B6A67", border: "1px solid #ECECEA", fontSize: 13, fontWeight: 700 }}>{fx.liffReport.btnDraft}</button>
          <button style={{ flex: 2, height: 42, borderRadius: 10, background: "var(--brand)", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Icon name="check" size={16} /> {fx.liffReport.btnSubmit}
          </button>
        </div>
      </div>
    </LineFrame>
  );
}

/* ── 10. LIFF · status tracking + rating ──────────────────────────────────────── */
function LiffTrack() {
  const steps = fx.liffTrack.steps.map((s, i) => ({ l: s.l, t: s.t, done: i <= 2, current: i === 2 }));
  return (
    <LineFrame title={fx.liffTrack.frameTitle}>
      <div style={{ height: "100%", background: "#FAFAF9", margin: "-12px -8px 0", padding: 0, overflow: "auto" }}>
        <div style={{ padding: "10px 14px 6px", display: "flex", alignItems: "center", gap: 10, background: "#fff", borderBottom: "1px solid #ECECEA" }}>
          <Icon name="x" size={18} color="#1C1B1A" />
          <div style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>SR-2026-0048</div>
          <span style={{ fontSize: 9, padding: "2px 6px", background: "#ECF6F3", color: "var(--brand)", borderRadius: 4, fontWeight: 700 }}>LIFF</span>
        </div>
        <div style={{ padding: "14px 14px 80px" }}>
          {/* Status banner */}
          <div style={{ padding: 12, background: "var(--brand)", color: "#fff", borderRadius: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 11, opacity: 0.85 }}>{fx.liffTrack.statusLabel}</div>
            <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>{fx.liffTrack.statusVal}</div>
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>{fx.liffTrack.statusSub}</div>
          </div>
          {/* Timeline */}
          <div style={{ padding: 14, background: "#fff", border: "1px solid #ECECEA", borderRadius: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>{fx.liffTrack.timelineTitle}</div>
            {steps.map((s, i, arr) => (
              <div key={i} style={{ display: "flex", gap: 12, paddingBottom: 12, position: "relative" }}>
                {i < arr.length - 1 && <div style={{ position: "absolute", left: 11, top: 24, bottom: 0, width: 2, background: s.done ? "#1A7F5A" : "#ECECEA" }} />}
                <div style={{ width: 24, height: 24, borderRadius: 999, zIndex: 1, background: s.current ? "var(--brand)" : s.done ? "#1A7F5A" : "#fff", border: s.done ? "none" : "2px solid #D9D9D5", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {s.done && <Icon name={s.current ? "hardhat" : "check"} size={12} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: s.current ? 700 : 600, color: s.current ? "var(--brand)" : s.done ? "#1C1B1A" : "#98968F" }}>{s.l}</div>
                  <div style={{ fontSize: 10.5, color: "#6B6A67" }}>{s.t}</div>
                </div>
              </div>
            ))}
          </div>
          {/* Technician */}
          <div style={{ padding: 12, background: "#fff", border: "1px solid #ECECEA", borderRadius: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: "#6B6A67", fontWeight: 600, marginBottom: 6 }}>{fx.liffTrack.techLabel}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 42, height: 42, borderRadius: 999, background: "#B7791F", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>{fx.liffTrack.techInitials}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{fx.liffTrack.techName}</div>
                <div style={{ fontSize: 10.5, color: "#6B6A67" }}>{fx.liffTrack.techRole}</div>
              </div>
              <div style={{ width: 36, height: 36, borderRadius: 999, background: LINE_GREEN, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="cash" size={16} /></div>
            </div>
          </div>
          {/* Rate after close */}
          <div style={{ padding: 14, background: "#fff", border: "1px solid #ECECEA", borderRadius: 12, opacity: 0.5 }}>
            <div style={{ fontSize: 11.5, color: "#6B6A67", textAlign: "center", marginBottom: 8 }}>{fx.liffTrack.rateText}</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
              {[1, 2, 3, 4, 5].map((i) => <span key={i} style={{ fontSize: 28, color: "#D9D9D5" }}>{fx.liffTrack.star}</span>)}
            </div>
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "12px 14px 24px", background: "#fff", borderTop: "1px solid #ECECEA" }}>
          <button style={{ width: "100%", height: 42, borderRadius: 10, background: "#ECF6F3", color: "var(--brand)", border: "1px solid var(--brand)", fontSize: 13, fontWeight: 700 }}>{fx.liffTrack.contactBtn}</button>
        </div>
      </div>
    </LineFrame>
  );
}

/* ── 11. Flex push notifications ──────────────────────────────────────────────── */
function LinePush() {
  return (
    <LineFrame title={fx.push.frameTitle}>
      <DateSep>{fx.push.date}</DateSep>
      <Bubble side="oa" time="08:00">{renderRich(fx.push.b1)}</Bubble>
      <CardBubble {...fx.push.card1} />
      <Bubble side="oa" time="10:30">{renderRich(fx.push.b2)}</Bubble>
      <CardBubble {...fx.push.card2} />
      <Bubble side="oa" time="15:42">{renderRich(fx.push.b3)}</Bubble>
      <CardBubble {...fx.push.card3} />
      <Bubble side="oa" time="16:00">{renderRich(fx.push.b4)}</Bubble>
      <CardBubble {...fx.push.card4} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}><InputBar /></div>
    </LineFrame>
  );
}

/* ── 12. LINE Login + Bind unit ───────────────────────────────────────────────── */
function LineBind() {
  return (
    <LineFrame title={fx.bind.frameTitle}>
      <div style={{ height: "100%", background: "#FAFAF9", margin: "-12px -8px 0", padding: 0, overflow: "auto" }}>
        <div style={{ padding: "10px 14px 6px", display: "flex", alignItems: "center", gap: 10, background: "#fff", borderBottom: "1px solid #ECECEA" }}>
          <Icon name="x" size={18} color="#1C1B1A" />
          <div style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{fx.bind.header}</div>
          <span style={{ fontSize: 9, padding: "2px 6px", background: "#06C7551A", color: LINE_GREEN, borderRadius: 4, fontWeight: 700 }}>LINE Login</span>
        </div>
        <div style={{ padding: "24px 18px 90px", textAlign: "center" }}>
          <div style={{ width: 90, height: 90, borderRadius: 999, background: "linear-gradient(135deg, var(--brand), #0B5F58)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 36 }}>🏠</div>
          <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>{fx.bind.welcome}</div>
          <div style={{ fontSize: 12, color: "#6B6A67", marginBottom: 20 }}>{fx.bind.welcomeSub}</div>
          {/* Bound LINE account */}
          <div style={{ padding: 14, background: "#fff", border: "1px solid #ECECEA", borderRadius: 12, textAlign: "left", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 999, background: LINE_GREEN, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>L</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{fx.bind.lineName}</div>
                <div style={{ fontSize: 10.5, color: "#6B6A67" }}>{fx.bind.lineSub}</div>
              </div>
              <span style={{ fontSize: 9.5, padding: "2px 7px", background: "#EAF4EE", color: "#1A7F5A", borderRadius: 999, fontWeight: 700 }}>{fx.bind.confirmBadge}</span>
            </div>
          </div>
          {/* Bind units */}
          <div style={{ padding: 14, background: "#fff", border: "1px solid #ECECEA", borderRadius: 12, textAlign: "left", marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>{fx.bind.unitsTitle}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "#ECF6F3", borderRadius: 8, border: "1px solid var(--brand)" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brand)" }}>{fx.bind.unit}</div>
                <div style={{ fontSize: 10.5, color: "#6B6A67" }}>{fx.bind.unitSub}</div>
              </div>
              <Icon name="check" size={16} color="var(--brand)" />
            </div>
            <button style={{ width: "100%", padding: "10px", marginTop: 8, background: "#FAFAF9", border: "1.5px dashed #D9D9D5", borderRadius: 8, color: "#6B6A67", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", fontFamily: "inherit" }}>
              <Icon name="plus" size={14} /> {fx.bind.addUnit}
            </button>
          </div>
          {/* Warranty quick */}
          <div style={{ padding: 14, background: "#fff", border: "1px solid #ECECEA", borderRadius: 12, textAlign: "left", marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>{fx.bind.warrantyTitle}</div>
            {fx.bind.warrantyRows.map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 11.5, borderBottom: i < 3 ? "1px dashed #F0EFEB" : "none" }}>
                <span style={{ color: "#6B6A67" }}>{r.l}</span>
                <span style={{ color: r.c || "#1C1B1A", fontWeight: 600 }}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "12px 14px 24px", background: "#fff", borderTop: "1px solid #ECECEA" }}>
          <button style={{ width: "100%", height: 44, borderRadius: 10, background: "var(--brand)", color: "#fff", border: "none", fontSize: 13, fontWeight: 700 }}>{fx.bind.saveBtn}</button>
        </div>
      </div>
    </LineFrame>
  );
}

/* ── PM · plan + history (line-pm.jsx LinePMPlan) ─────────────────────────────── */
function LinePMPlan() {
  return (
    <LineFrame>
      <DateSep>{fx.pmPlan.date}</DateSep>
      <Bubble side="user" time="09:00">{renderRich(fx.pmPlan.ask)}</Bubble>
      <Bubble side="oa" time="09:00">{renderRich(fx.pmPlan.intro)}</Bubble>
      <CardBubble {...fx.pmPlan.planCard} />
      <Bubble side="oa" time="09:01">{renderRich(fx.pmPlan.notice)}</Bubble>
      <CardBubble {...fx.pmPlan.historyCard} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}><InputBar /></div>
    </LineFrame>
  );
}

/* ── PM · quotation approval (line-pm.jsx LinePMQuote) ────────────────────────── */
function LinePMQuote() {
  return (
    <LineFrame>
      <DateSep>{fx.pmQuote.date}</DateSep>
      <Bubble side="oa" time="11:02">{renderRich(fx.pmQuote.offer)}</Bubble>
      <CardBubble {...fx.pmQuote.card} />
      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6, padding: "4px 0 8px 36px" }}>
        <div style={{ flex: 1, padding: "10px 0", background: LINE_GREEN, color: "#fff", borderRadius: 10, fontSize: 12.5, fontWeight: 700, textAlign: "center", boxShadow: "0 2px 6px rgba(6,199,85,0.3)" }}>{fx.pmQuote.btnApprove}</div>
        <div style={{ flex: 1, padding: "10px 0", background: "#fff", color: "#B4453C", border: "1px solid #B4453C", borderRadius: 10, fontSize: 12.5, fontWeight: 700, textAlign: "center" }}>{fx.pmQuote.btnReject}</div>
        <div style={{ padding: "10px 12px", background: "#fff", color: "#3B6FB0", border: "1px solid #ECECEA", borderRadius: 10, fontSize: 12.5, fontWeight: 700, textAlign: "center" }}>{fx.pmQuote.btnPdf}</div>
      </div>
      <Bubble side="user" time="11:05">{renderRich(fx.pmQuote.approve)}</Bubble>
      <Bubble side="oa" time="11:05">{renderRich(fx.pmQuote.thanks)}</Bubble>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}><InputBar /></div>
    </LineFrame>
  );
}

/* ── PM · service certificate (line-pm.jsx LinePMCert) ────────────────────────── */
function LinePMCert() {
  return (
    <LineFrame>
      <DateSep>{fx.pmCert.date}</DateSep>
      <Bubble side="oa" time="10:50">{renderRich(fx.pmCert.done)}</Bubble>
      <div style={{ display: "flex", marginBottom: 6, gap: 6, alignItems: "flex-end" }}>
        <div style={{ width: 30, height: 30, borderRadius: 999, background: LINE_GREEN, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>JF</div>
        <div style={{ width: 264, background: "#fff", borderRadius: "16px 16px 16px 4px", overflow: "hidden", boxShadow: "0 1px 1px rgba(0,0,0,0.05)" }}>
          {/* cert header */}
          <div style={{ background: "linear-gradient(135deg,var(--brand),var(--brand-2))", color: "#fff", padding: "12px 14px" }}>
            <div style={{ fontSize: 9.5, opacity: 0.8, letterSpacing: "0.05em" }}>{fx.pmCert.certEyebrow}</div>
            <div style={{ fontSize: 13.5, fontWeight: 800, marginTop: 2 }}>{fx.pmCert.certTitle}</div>
            <div className="num" style={{ fontSize: 10, opacity: 0.85, marginTop: 1 }}>{fx.pmCert.certDocNo}</div>
          </div>
          <div style={{ padding: "10px 14px" }}>
            {fx.pmCert.certKv.map((kv) => (
              <div key={kv.l} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 11.5 }}><span style={{ color: "#6B6A67" }}>{kv.l}</span><span style={{ fontWeight: 600 }}>{kv.v}</span></div>
            ))}
            {/* before/after */}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: "#6B6A67", marginBottom: 3 }}>{fx.pmCert.beforeLabel}</div>
                <div style={{ height: 48, borderRadius: 6, background: "linear-gradient(135deg,#94A3B8,#475569)" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: "#6B6A67", marginBottom: 3 }}>{fx.pmCert.afterLabel}</div>
                <div style={{ height: 48, borderRadius: 6, background: "linear-gradient(135deg,var(--brand),#134E4A)" }} />
              </div>
            </div>
            <div style={{ marginTop: 8, padding: "6px 8px", background: "#E8F1EA", borderRadius: 6, fontSize: 10.5, color: "#1A7F5A", fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
              <Icon name="check" size={12} color="#1A7F5A" />{fx.pmCert.passLine}
            </div>
          </div>
          <div style={{ padding: "9px 14px", background: "#FAFAF9", fontSize: 11, color: "var(--brand)", fontWeight: 600, textAlign: "center", borderTop: "1px solid #ECECEA" }}>{fx.pmCert.certFooter}</div>
        </div>
      </div>
      <QuickReplies items={fx.pmCert.quick} sel={null} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}><InputBar /></div>
    </LineFrame>
  );
}

/* ── PM · maintenance contracts (line-pm.jsx LinePMContracts) ──────────────────── */
function LinePMContracts() {
  return (
    <LineFrame>
      <DateSep>{fx.pmContracts.date}</DateSep>
      <Bubble side="user" time="08:30">{renderRich(fx.pmContracts.ask)}</Bubble>
      <CardBubble {...fx.pmContracts.listCard} />
      <CardBubble {...fx.pmContracts.expiryCard} />
      <div style={{ display: "flex", gap: 6, padding: "4px 0 8px 36px" }}>
        <div style={{ flex: 1, padding: "10px 0", background: LINE_GREEN, color: "#fff", borderRadius: 10, fontSize: 12.5, fontWeight: 700, textAlign: "center", boxShadow: "0 2px 6px rgba(6,199,85,0.3)" }}>{fx.pmContracts.btnRenew}</div>
        <div style={{ flex: 1, padding: "10px 0", background: "#fff", color: "var(--brand)", border: "1px solid #ECECEA", borderRadius: 10, fontSize: 12.5, fontWeight: 700, textAlign: "center" }}>{fx.pmContracts.btnContact}</div>
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}><InputBar /></div>
    </LineFrame>
  );
}

/* ── Preview page ─────────────────────────────────────────────────────────────── */

/** Left screen-list registry: id -> icon + the applied nav/group DICT keys. Order
 * matches pototype/line-oa.jsx LINE_SCREENS (L579-596). */
const LINE_SCREENS: { id: string; icon: IconName; navKey: DictKey; groupKey: DictKey }[] = [
  { id: "home", icon: "grid", navKey: "line.preview.navHome", groupKey: "line.preview.groupStart" },
  { id: "bind", icon: "user", navKey: "line.preview.navBind", groupKey: "line.preview.groupStart" },
  { id: "liff-report", icon: "warn", navKey: "line.preview.navLiffReport", groupKey: "line.preview.groupRepair" },
  { id: "report", icon: "warn", navKey: "line.preview.navReport", groupKey: "line.preview.groupRepair" },
  { id: "liff-track", icon: "clock", navKey: "line.preview.navLiffTrack", groupKey: "line.preview.groupRepair" },
  { id: "track", icon: "clock", navKey: "line.preview.navTrack", groupKey: "line.preview.groupRepair" },
  { id: "push", icon: "bell", navKey: "line.preview.navPush", groupKey: "line.preview.groupNotify" },
  { id: "warranty", icon: "check", navKey: "line.preview.navWarranty", groupKey: "line.preview.groupService" },
  { id: "pm-plan", icon: "wrench", navKey: "line.preview.navPmPlan", groupKey: "line.preview.groupPm" },
  { id: "pm-quote", icon: "doc", navKey: "line.preview.navPmQuote", groupKey: "line.preview.groupPm" },
  { id: "pm-cert", icon: "check", navKey: "line.preview.navPmCert", groupKey: "line.preview.groupPm" },
  { id: "pm-contracts", icon: "paperclip", navKey: "line.preview.navPmContracts", groupKey: "line.preview.groupPm" },
  { id: "common", icon: "calendar", navKey: "line.preview.navCommon", groupKey: "line.preview.groupService" },
  { id: "payment", icon: "cash", navKey: "line.preview.navPayment", groupKey: "line.preview.groupFinance" },
  { id: "promo", icon: "trend", navKey: "line.preview.navPromo", groupKey: "line.preview.groupMarketing" },
  { id: "sales", icon: "users", navKey: "line.preview.navSales", groupKey: "line.preview.groupContact" },
];

/** Center phone dispatch: route id -> its mockup component. */
const SCREENS: Record<string, () => JSX.Element> = {
  home: LineHome,
  bind: LineBind,
  "liff-report": LiffReport,
  report: LineReport,
  "liff-track": LiffTrack,
  track: LineTrack,
  push: LinePush,
  warranty: LineWarranty,
  "pm-plan": LinePMPlan,
  "pm-quote": LinePMQuote,
  "pm-cert": LinePMCert,
  "pm-contracts": LinePMContracts,
  common: LineCommon,
  payment: LinePayment,
  promo: LinePromo,
  sales: LineSales,
};

export function LineOAPreview() {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const [screen, setScreen] = useState("home");
  const Active = SCREENS[screen] ?? LineHome;

  return (
    <Page
      breadcrumbs={[t("line.preview.crumbRoot"), t("line.preview.title")]}
      title={t("line.preview.title")}
      subtitle={t("line.preview.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="paperclip" onClick={() => ctx.notify(t("line.preview.qrToast"))}>{t("line.preview.qrBtn")}</Btn>
          <Btn kind="primary" size="md" icon="settings" onClick={() => ctx.notify(t("line.preview.settingsToast"))}>{t("line.preview.settingsBtn")}</Btn>
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr 280px", gap: 24, alignItems: "start" }}>
        {/* Left: screens list */}
        <Card pad={0}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{fill(t("line.preview.screensCount"), { count: LINE_SCREENS.length })}</div>
          </div>
          {LINE_SCREENS.map((s, i) => {
            const sel = s.id === screen;
            return (
              <div key={s.id} onClick={() => setScreen(s.id)} style={{
                padding: "12px 14px", borderTop: i ? "1px solid var(--border)" : "none",
                background: sel ? "var(--brand-soft)" : "transparent",
                borderLeft: sel ? "3px solid var(--brand)" : "3px solid transparent",
                cursor: "pointer",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Icon name={s.icon} size={15} color={sel ? "var(--brand)" : "var(--text-2)"} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: sel ? 700 : 500, color: sel ? "var(--brand)" : "var(--text)" }}>{t(s.navKey)}</div>
                    <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1 }}>{t(s.groupKey)}</div>
                  </div>
                  {sel && <Icon name="chevR" size={13} color="var(--brand)" />}
                </div>
              </div>
            );
          })}
        </Card>

        {/* Center: phone preview */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 4 }}>
          <Active />
        </div>

        {/* Right: features */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Card pad={16}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: LINE_GREEN, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800 }}>L</div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>{t("line.preview.oaHandle")}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{t("line.preview.oaFollowers")}</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <div style={{ padding: 10, background: "var(--surface-2)", borderRadius: 8, textAlign: "center" }}>
                <div className="num" style={{ fontSize: 17, fontWeight: 800, color: "var(--brand)" }}>{t("line.preview.statMsgValue")}</div>
                <div style={{ fontSize: 9.5, color: "var(--text-3)" }}>{t("line.preview.statMsgLabel")}</div>
              </div>
              <div style={{ padding: 10, background: "var(--surface-2)", borderRadius: 8, textAlign: "center" }}>
                <div className="num" style={{ fontSize: 17, fontWeight: 800, color: "var(--ok)" }}>{t("line.preview.statReplyValue")}</div>
                <div style={{ fontSize: 9.5, color: "var(--text-3)" }}>{t("line.preview.statReplyLabel")}</div>
              </div>
            </div>
          </Card>

          <Card pad={16}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t("line.preview.featuresTitle")}</div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: "var(--text-2)", lineHeight: 1.8 }}>
              {fx.feat.map((f, i) => <li key={i}>{renderRich(f)}</li>)}
            </ul>
          </Card>

          <Card pad={16} style={{ background: LINE_GREEN, color: "#fff", border: "none" }}>
            <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 4 }}>{t("line.preview.ctaEyebrow")}</div>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>{t("line.preview.ctaTitle")}</div>
            <div style={{ fontSize: 11, opacity: 0.9, marginBottom: 10 }}>{t("line.preview.ctaBody")}</div>
            <Btn kind="outline" size="sm" icon="arrowR" style={{ background: "#fff", color: LINE_GREEN, border: "none", fontWeight: 700 }} onClick={() => ctx.notify(t("line.preview.settingsToast"))}>{t("line.preview.ctaBtn")}</Btn>
          </Card>
        </div>
      </div>
    </Page>
  );
}
