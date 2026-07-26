/*
 * MasterDocNum — the Document Numbering screen, ported 1:1 from pototype/master.jsx
 * MasterDocNum (L818-889). Route master.docnum, visual-gate reference
 * tests/visual/reference/gallery/g2/35.
 *
 * Design fidelity (PLAN.md §0 rule 1): the layout — the two-crumb breadcrumb, the
 * title/subtitle, the add-document-type action, and the full-width table (type · Format ·
 * example · next-number · reset · lock · edit) — is the prototype's, verbatim. th()/td()
 * are the ds.jsx table helpers (same as master-cc.tsx, which passed g2/34). The Format
 * cell reproduces the prototype's coloured segments (brand prefix · "-" · {year} · "-" ·
 * "{####}"); the "-" separators and the "{####}" digit mask are language-neutral literals
 * copied verbatim from the prototype with no token/key (B-037(a) / §0 rule 2 applies to
 * Thai UI strings only).
 *
 * Data (rule 8): GET /doc-numbering (use-doc-numbering.ts) via the generated client — the
 * prototype's DOCNUM_SEED local state becomes the server catalogue. Two display rules carry
 * logic and live in docnum-rows.ts (unit-tested, gate G3):
 *   - next-number = nextRunning (B-060): running + 1 padded to 4 digits only when all-digits
 *     (the BOQ "B-02 v3" row renders raw).
 *   - lock cell = lockedLabelKey (B-067): the wire lock-mode CODE (all|dept|warehouse|none)
 *     -> its docnum.lock* dict key, with none -> the literal em-dash "—".
 * The example column's year is the current CE year (B-060, dynamic — today 2026 matches the
 * prototype's hardcoded 2026 and the g2/35 reference). The reset cell renders the wire's
 * Thai reset string through tp() (LESSON: reset values live in the i18n `phrases` layer,
 * echoed for th; "—" is not a phrase and echoes unchanged) — the value is server data, so
 * no Thai literal sits in this source.
 *
 * Write path DEFERRED (B-066): POST/PUT /doc-numbering are typed in the contract but the API
 * registers only GET, so the add button and the per-row edit are render-only stubs — NO
 * onClick — mirroring the B-050/B-065 deferred-write precedent. The DocNumForm modal is not
 * built (it would 404 on submit); it lands with the Phase-2 numbering-service write path.
 *
 * i18n (rule 2): every user-visible string is a docnum.* / master.* / common.* dict key
 * (t), the "Document Numbering" nav label (tn), or the wire reset string (tp). Tokens back
 * every colour (rule 6).
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import {
  toDocNumRow,
  nextRunning,
  lockedLabelKey,
  type DocNumRow,
} from "./docnum-rows";
import { useDocNumberingList } from "./use-doc-numbering";

/** Table header cell style, ported from ds.jsx th() (L214-219) — same as master-cc.tsx. */
function th(w?: number): CSSProperties {
  return {
    textAlign: "start",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style, ported from ds.jsx td() (L220). */
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

/** Per-row edit button (master.jsx:878) — render-only stub, no onClick (B-066). */
const editBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--surface)",
  cursor: "pointer",
  color: "var(--text-2)",
};

export function MasterDocNum() {
  const { t, tn, tp } = useI18n();

  const docQ = useDocNumberingList();

  const rows = useMemo<DocNumRow[]>(
    () => (docQ.data ?? []).map(toDocNumRow),
    [docQ.data],
  );

  // Example column year: the current CE year (B-060, dynamic; the prototype hardcoded 2026).
  const year = new Date().getFullYear();

  const navTitle = tn("Document Numbering");

  return (
    <Page
      breadcrumbs={[t("master.breadcrumb"), navTitle]}
      title={navTitle}
      subtitle={t("docnum.subtitle")}
      actions={
        // B-066: add write-path deferred (POST /doc-numbering unregistered).
        // Render-only stub — no onClick (present in g2/35).
        <Btn kind="primary" size="md" icon="plus">
          {t("docnum.addBtn")}
        </Btn>
      }
    >
      <Card pad={0}>
        {docQ.isLoading ? (
          // Loading skeleton — token blocks, no invented copy (mirror master-cc).
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <div
                key={n}
                style={{
                  height: 44,
                  marginBottom: 4,
                  borderRadius: 8,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                }}
              />
            ))}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                <th style={th()}>{t("docnum.thType")}</th>
                <th style={th()}>{t("docnum.thFormat")}</th>
                <th style={th()}>{t("docnum.thExample")}</th>
                <th style={th(120)}>{t("docnum.thNext")}</th>
                <th style={th(110)}>{t("docnum.thReset")}</th>
                <th style={th(120)}>{t("docnum.thLock")}</th>
                <th style={th(36)} />
              </tr>
            </thead>
            {/* Empty tbody when the catalogue is empty = the table's empty state (no
                invented copy), mirroring master-cc / master-model. */}
            <tbody>
              {rows.map((r) => {
                const lockKey = lockedLabelKey(r.locked);
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...td, fontWeight: 500 }}>{r.type}</td>
                    {/* Format = prefix (brand) - {year} - {####}, verbatim master.jsx:866-871. */}
                    <td style={td} className="num">
                      <span style={{ color: "var(--brand)", fontWeight: 600 }}>{r.prefix}</span>
                      <span style={{ color: "var(--text-3)" }}>-</span>
                      <span style={{ color: "var(--text-2)" }}>{t("docnum.fmtYear")}</span>
                      <span style={{ color: "var(--text-3)" }}>-</span>
                      <span style={{ color: "var(--text-2)" }}>{"{####}"}</span>
                    </td>
                    <td style={{ ...td, fontFamily: "var(--font-num)" }}>
                      {r.prefix}-{year}-{r.running}
                    </td>
                    <td style={{ ...td, fontWeight: 600 }} className="num">
                      {nextRunning(r.running)}
                    </td>
                    <td style={{ ...td, fontSize: 11.5 }}>{tp(r.reset_rule as PhraseKey)}</td>
                    <td style={{ ...td, fontSize: 11.5, color: "var(--text-2)" }}>
                      {lockKey ? t(lockKey) : "—"}
                    </td>
                    <td style={td}>
                      {/* B-066: per-row edit — render-only stub, no onClick (deferred write). */}
                      <button title={t("common.edit")} style={editBtnStyle}>
                        <Icon name="edit" size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
