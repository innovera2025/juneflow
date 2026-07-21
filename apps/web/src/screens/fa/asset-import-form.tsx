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
 * PRESENTATIONAL (reported honestly, never fabricated) — there is NO file-upload / parse endpoint:
 * this whole flow is presentational. POST /fa/import (fa.ts importAssets) exists, but it needs
 * client-PARSED rows, which this mock file-picker does not produce (the prototype's on-screen
 * sample rows are un-keyed Thai mock data — rule 2 + rule 3 — so the preview sample TABLE is
 * dropped, not fabricated). The download/upload/confirm actions are UI acknowledgments only; the
 * confirm count is the screen's own baked-in mock figure (the fa.import.btnConfirm + checkPass copy
 * bake "24"), kept for internal consistency of the presentational flow — no asset is really
 * imported here.
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { useShellCtx } from "../../shell/shell-context";

/** The template filename (ASCII constant, matches fa.import.fileLine {file}). */
const TEMPLATE_FILE = "FA-Template-2026.xlsx";
/** The screen's own baked-in mock count (fa.import.btnConfirm / checkPass copy already say "24"). */
const IMPORT_SAMPLE_COUNT = 24;

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

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <div style={{ flex: 1 }} />
        {stage === "preview" && (
          <Btn
            kind="primary"
            size="md"
            icon="check"
            onClick={() => {
              onClose();
              ctx.notify(
                t("fa.register.toastImport").replace("{count}", String(IMPORT_SAMPLE_COUNT)),
              );
            }}
          >
            {t("fa.import.btnConfirm")}
          </Btn>
        )}
      </div>
    </>
  );
}
