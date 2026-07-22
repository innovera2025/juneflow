/*
 * AssetImportForm — the "import assets from Excel" modal body, opened by FARegister via
 * ctx.openModal (size "lg"). Ported from pototype/fa.jsx AssetImportForm (L243-336): the two-stage
 * flow (pick: download-template + upload cards -> preview: file-passed banner + confirm) is the
 * prototype's.
 *
 * Design fidelity (rule 1): the two dashed cards, the numbered steps, the drop button, the column
 * spec caption, and the preview banner match the prototype. Every string is a fa.* / boq.* /
 * common.* dict key (t) — no Thai/baht literal in source (rule 2); tokens back every colour.
 *
 * HONEST-DISABLED (Section-0, never fabricated) — POST /fa/import (fa.ts importAssets) is REAL and
 * wired here (useImportFaAssets), but it needs client-PARSED rows. There is NO file-upload / parse
 * endpoint and NO XLSX parser in this app, and the prototype's on-screen sample rows are un-keyed
 * Thai mock data (rule 2 + rule 3) — so no genuine rows can be produced this round. Fabricating the
 * prototype's 24 mock rows is FORBIDDEN by Section-0, which outranks "fire a real POST". Therefore:
 *   - the earlier FAKE success toast (a ctx.notify claiming N imported with NO server call) is
 *     REMOVED — the confirm no longer lies about importing anything;
 *   - the confirm button is HONEST-DISABLED (parsedRows is genuinely empty) + carries an honest
 *     note; the real hook is staged so it fires a truthful POST the moment rows can be produced;
 *   - the 2-stage UI (download-template / upload cards -> file-passed banner) is kept intact for
 *     fidelity — it is presentational prototype chrome; the sample preview TABLE stays dropped.
 * BLOCKER (filed centrally, not here): import needs a backend upload+parse endpoint OR a manual
 * multi-row entry form OR an accepted honest-disable ruling. Note copy pends a Wave-C key.
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { useShellCtx } from "../../shell/shell-context";
import { useImportFaAssets, type ImportFaAssetRow } from "./use-fa";

const DASH = "—";
/** The template filename (ASCII constant, matches fa.import.fileLine {file}). */
const TEMPLATE_FILE = "FA-Template-2026.xlsx";

/** A dashed info card (download-template / upload) — token-backed. */
function dashedCard(tone: string): CSSProperties {
  return {
    padding: 16,
    background: "var(--surface)",
    border: `1.5px dashed ${tone}`,
    borderRadius: 10,
  };
}

export interface AssetImportFormProps {
  onClose: () => void;
}

export function AssetImportForm({ onClose }: AssetImportFormProps) {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const [stage, setStage] = useState<"pick" | "preview">("pick");
  const importM = useImportFaAssets();

  // No file-upload / parse endpoint + no XLSX parser exists, and Section-0 forbids fabricating the
  // prototype's mock rows -> there are genuinely ZERO parseable rows this round. The confirm is
  // honest-disabled; the real POST /fa/import path below only fires if real rows ever appear.
  const parsedRows: ImportFaAssetRow[] = [];
  const canConfirm = parsedRows.length > 0 && !importM.isPending;

  const confirmImport = () => {
    if (parsedRows.length === 0) return; // never fabricate rows (Section-0 rule 3)
    importM.mutate(
      { rows: parsedRows },
      {
        onSuccess: (res) => {
          const imported = Number((res as Record<string, unknown>).imported ?? parsedRows.length);
          onClose();
          // Real server count — not a baked figure.
          ctx.notify(t("fa.register.toastImport").replace("{count}", String(imported)));
        },
      },
    );
  };

  return (
    <>
      {stage === "pick" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          {/* 1. download template (presentational) */}
          <div style={dashedCard("var(--brand)")}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: "var(--brand-soft)",
                  color: "var(--brand)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="download" size={18} />
              </div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>{t("fa.import.step1Title")}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{t("fa.import.step1Sub")}</div>
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-2)", marginBottom: 10 }}>
              {t("fa.import.fileLine").replace("{file}", TEMPLATE_FILE)}
            </div>
            <Btn
              kind="primary"
              size="sm"
              icon="download"
              onClick={() => ctx.notify(t("fa.import.toastTemplate"))}
            >
              {t("boq.listExcDownloadTpl")}
            </Btn>
          </div>

          {/* 2. upload file (presentational — advances to the preview stage) */}
          <div style={dashedCard("var(--accent)")}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="upload" size={18} />
              </div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>{t("fa.import.step2Title")}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{t("fa.import.step2Sub")}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStage("preview")}
              style={{
                width: "100%",
                padding: "14px 12px",
                background: "var(--surface-2)",
                border: "1.5px dashed var(--border-strong)",
                borderRadius: 8,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                color: "var(--text-2)",
                fontSize: 12.5,
                fontWeight: 600,
                fontFamily: "inherit",
              }}
            >
              <Icon name="upload" size={16} color="var(--accent)" />
              {t("fa.import.dropLabel")}
            </button>
            <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 8 }}>
              {t("fa.import.colSpec")}
            </div>
          </div>
        </div>
      )}

      {stage === "preview" && (
        <div
          style={{
            padding: 12,
            background: "var(--ok-soft)",
            borderRadius: 8,
            marginBottom: 14,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Icon name="check" size={16} color="var(--ok)" />
          <div style={{ flex: 1, fontSize: 12 }}>
            <div style={{ fontWeight: 700, color: "var(--ok)" }}>{t("fa.import.checkPass")}</div>
            <div style={{ color: "var(--text-2)", marginTop: 2 }}>{t("fa.import.checkPassSub")}</div>
          </div>
          {/* Note: the prototype's on-screen sample preview TABLE is dropped (un-keyed Thai mock
              rows, rule 2 + rule 3) — never fabricated here. */}
          <button
            type="button"
            onClick={() => setStage("pick")}
            style={{
              fontSize: 11.5,
              color: "var(--brand)",
              background: "none",
              border: "none",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {t("fa.import.changeFile")}
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <div style={{ flex: 1 }} />
        {stage === "preview" && (
          <>
            {/* Honest note that file parsing is not available yet — DASH interim, pending the
                Wave-C key fa.import.disabledNote (never minted here). */}
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>{DASH}</span>
            {/* Honest-disabled: no genuine rows can be produced -> the confirm cannot fire a
                truthful POST /fa/import (Section-0). The real handler is wired in confirmImport. */}
            <Btn kind="primary" size="md" icon="check" disabled={!canConfirm} onClick={confirmImport}>
              {t("fa.import.btnConfirm")}
            </Btn>
          </>
        )}
      </div>
    </>
  );
}
