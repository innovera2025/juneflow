/*
 * AIQuantityTakeoff — the CAD/BIM AI take-off screen (title boq.aiqTitle),
 * ported 1:1 from pototype/ai-qto.jsx AIQuantityTakeoff (L47-225) + QTOReview (L228-296)
 * + QTOSummary (L299-376). Route boq.aiqto (docs/extract/NAV-ROUTES.md L23, component
 * AIQuantityTakeoff in ai-qto.jsx), visual-gate reference tests/visual/reference/gallery/
 * g1/09-s.jpg (STEP 1, the upload screen).
 *
 * Design fidelity (PLAN.md §0 rule 1): the 4-step wizard is the prototype's, verbatim — the
 * two-crumb breadcrumb + title/subtitle + DEMO badge, the StepHeader, and step 1 (the gated
 * screen): the 1.5fr/1fr grid, the dashed dropzone with the two sample buttons, the LOD
 * Field, the file-type accuracy rail, the info banner, and the footer's start button.
 * Steps 2-4 (not gated) keep the prototype's processing / review-table / summary structure.
 *
 * Backend reality (rule 8, C10) — the AI-QTO backend (apps/api/src/routes/ai-qto.ts) is an
 * explicit STUB (B-070 / PLAN.md §12): it runs NO IFC/RVT/DWG parse, and GET /ai-qto/{job}
 * returns canned sample data stamped `stub:true` + a note reading "canned ... NOT extracted
 * from any uploaded model". So per §0 rule 3 (never copy the mock mechanic) + C10 (never
 * fabricate AI output), the screen:
 *   - wires the REAL parts: the file upload -> POST /ai-qto/upload (the `ai_per_month` quota
 *     gates it, real 402), the job status -> GET /ai-qto/{job} (read only status, to advance
 *     the wizard — never the canned quantities), and create -> POST /ai-qto/{job}/create-boq.
 *   - seeds ZERO AI take-off rows: the QTO_ROWS_SEED / QTO_ELEMENTS_FOUND mocks are NOT
 *     copied. The review/summary tables render their real (initially empty) QtoRow[] and
 *     em-dash every figure with no real source, exactly like boq-bom.tsx. The manual
 *     add-row IS live (user data — honest). The moment §12 ships a real take-off engine,
 *     parseQtoItems(job.items) feeds the unit-tested agg and the tables light up unchanged.
 *   - the stub nature stays disclosed through the prototype's own DEMO / Preview badge
 *     (boq.aiqDemoBadge) and the "simulated result, real parse needs a backend" subtitle
 *     (boq.aiqSubtitle) — both real i18n keys.
 *
 * WIRE GAPS (reported honestly, never fabricated):
 *   - AI take-off DATA (detected elements, mapped rows, quantities, confidence, the cost
 *     KPIs/shares/groups) has no real source (stub, §12) -> empty-state / em-dash + this
 *     flag. The 3D BIM viewer (pototype/ai-qto-viewer.jsx BIMViewer) renders fabricated
 *     geometry, so it is an honest muted placeholder here (not ported).
 *   - create-boq needs a top-level project_id (backend 400 without it) that the SACRED
 *     contract body omits (see use-aiqto.ts) -> the create resolves to the backend's honest
 *     result rather than a faked success.
 *   - the AI-credit quota CHIP + over-quota upgrade modal (pototype/pkg-builder.jsx
 *     AiQuotaChip / openAiQuotaModal) are a pkg-builder component whose strings have NO
 *     i18n keys and are not visible in the g1/09 reference -> not rendered; the quota is
 *     still enforced (the real GET /me `ai_per_month` disables the start button when
 *     exhausted, and the backend gates the upload with a 402).
 *
 * i18n (rule 2): every string is a boq.aiq* DICT key (t), a reused DICT key
 * (nav.sec.boq / nav.boq.list / boq.repStatusDone, t), or an aiqto-strings.json phrase (tp).
 * Nothing is translated anew. Comments are English-only (CLAUDE.md / B-073); Thai copy lives
 * only in i18n-full.json / the .json sibling. The baht glyph is built from a char code so no
 * Thai-block char sits in this source.
 */
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { DictKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Field } from "../../ui/field";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useMe } from "../../shell/use-shell-data";
import { formatMoney } from "./boq-rows";
import {
  QTO_CAT_ORDER,
  groupByCode,
  qtoTotal,
  qtoCatTotal,
  qtoCatPct,
  avgConfidence,
  lowConfCount,
  millions2,
  toMappings,
  type QtoCat,
  type QtoGroupKey,
  type QtoRow,
} from "./aiqto-agg";
import { useUploadAiQto, useAiQtoJob, useCreateBoqFromAiQto } from "./use-aiqto";
import aiqtoStrings from "./aiqto-strings.json" with { type: "json" };

const P = (k: keyof typeof aiqtoStrings) => aiqtoStrings[k] as PhraseKey;

/** Em-dash for any figure the stub cannot yet source (§0: honest em-dash, never fabricated). */
const DASH = "—";

/**
 * The baht glyph (U+0E3F) the prototype appends to the summary total (ai-qto.jsx L371). Built
 * from a char code so no Thai-block char sits in this source (B-073 / i18n-guard); it is a
 * currency SYMBOL, not translatable copy.
 */
const BAHT = String.fromCharCode(0x0e3f);

/** StepHeader labels (ai-qto.jsx labels L71) — the 4 wizard step DICT keys, in order. */
const STEP_LABEL_KEYS: readonly DictKey[] = [
  "boq.aiqStepUpload",
  "boq.aiqStepProcessing",
  "boq.aiqStepReview",
  "boq.aiqStepSummary",
];

/** LOD options (ai-qto.jsx L138). 100/200/400 carry DICT keys; 300/350 are bare ASCII. */
const LOD_OPTIONS: readonly { value: string; labelKey?: DictKey; label?: string }[] = [
  { value: "100", labelKey: "boq.aiqLod100" },
  { value: "200", labelKey: "boq.aiqLod200" },
  { value: "300", label: "LOD 300" },
  { value: "350", label: "LOD 350" },
  { value: "400", labelKey: "boq.aiqLod400" },
];

/** File-type accuracy rail metadata (ai-qto.jsx QTO_FILETYPES L6-12). Tokens back the tone. */
const FILE_TYPES: readonly {
  ext: string;
  icon: IconName;
  noteKey: DictKey;
  accKey: DictKey;
  tone: string;
}[] = [
  { ext: "IFC", icon: "box", noteKey: "boq.aiqNoteIfc", accKey: "boq.aiqAccExact", tone: "var(--ok)" },
  { ext: "RVT", icon: "box", noteKey: "boq.aiqNoteRvt", accKey: "boq.aiqAccExact", tone: "var(--ok)" },
  { ext: "DWG", icon: "doc", noteKey: "boq.aiqNoteDwg", accKey: "boq.aiqAccMedium", tone: "var(--warn)" },
  { ext: "DXF", icon: "doc", noteKey: "boq.aiqNoteDwg", accKey: "boq.aiqAccMedium", tone: "var(--warn)" },
  { ext: "PDF", icon: "doc", noteKey: "boq.aiqNotePdf", accKey: "boq.aiqAccCheck", tone: "var(--danger)" },
];

/** Processing sub-steps (ai-qto.jsx QTO_PROC_STEPS L14-20) — label DICT key + icon. */
const PROC_STEPS: readonly { labelKey: DictKey; icon: IconName }[] = [
  { labelKey: "boq.aiqProcRead", icon: "doc" },
  { labelKey: "boq.aiqProcDetect", icon: "grid" },
  { labelKey: "boq.aiqProcClassify", icon: "filter" },
  { labelKey: "boq.aiqProcMatch", icon: "link" },
  { labelKey: "boq.aiqProcCompute", icon: "budget" },
];

/**
 * Category palette + label alias (ai-qto.jsx QTO_CAT_TONE L45). The #B45309 labor hex has no
 * @juneflow/tokens equivalent so it is a prototype-verbatim literal (B-037(a), same as
 * boq-bom); M/S map to brand/info tokens.
 */
const CAT_META: Record<QtoCat, { tone: string; labelAlias: keyof typeof aiqtoStrings }> = {
  M: { tone: "var(--brand)", labelAlias: "catMaterial" },
  L: { tone: "#B45309", labelAlias: "catLabor" },
  S: { tone: "var(--info)", labelAlias: "catSubcon" },
};

/** Summary group label DICT keys (ai-qto.jsx groups L303-305). */
const GROUP_LABEL_KEY: Record<QtoGroupKey, DictKey> = {
  g02: "boq.aiqGroup02",
  g0304: "boq.aiqGroup0304",
  g05: "boq.aiqGroup05",
};

/** A file the user selected/sampled — the real Blob is uploaded; the stub ignores content. */
interface PickedFile {
  name: string;
  ext: string;
  blob: Blob;
}

/** Table header cell (ds.jsx th L214-219). */
function th(w?: number, align: "left" | "right" = "left"): CSSProperties {
  return {
    textAlign: align,
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell (ds.jsx td L220). */
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

/** Native-select style matching the prototype select trigger (new-boq-form fieldStyle). */
const selectStyle: CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 7,
  background: "var(--surface)",
  outline: "none",
  fontFamily: "inherit",
};

/** Interpolate {placeholder} tokens in an i18n template (no new translation — §0 rule 2). */
function fill(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

/** Human-readable byte size (ASCII), for the file row (ai-qto.jsx `f.size` was mock). */
function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** File extension (upper) from a filename, defaulting to the first known type. */
function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  const up = (m?.[1] ?? "").toUpperCase();
  return FILE_TYPES.some((t) => t.ext === up) ? up : "IFC";
}

/** DEMO / Preview pill (ai-qto.jsx title badge L93). */
function DemoBadge() {
  const { t } = useI18n();
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 9px",
        borderRadius: 999,
        background: "var(--warn-soft)",
        color: "var(--warn)",
      }}
    >
      {t("boq.aiqDemoBadge")}
    </span>
  );
}

/** 4-step wizard header (ai-qto.jsx StepHeader L70-88). */
function StepHeader({ step }: { step: number }) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
      {STEP_LABEL_KEYS.map((labelKey, i) => {
        const n = i + 1;
        return (
          <div key={n} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: n <= step ? "var(--brand)" : "var(--surface-3)",
                  color: n <= step ? "#fff" : "var(--text-3)",
                }}
              >
                {n < step ? "✓" : n}
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: n === step ? 700 : 500,
                  color: n === step ? "var(--text)" : "var(--text-3)",
                }}
              >
                {t(labelKey)}
              </span>
            </div>
            {n < 4 && (
              <div style={{ width: 28, height: 2, background: n < step ? "var(--brand)" : "var(--surface-3)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Honest placeholder for pototype/ai-qto-viewer.jsx BIMViewer — the 3D model preview renders
 * fabricated geometry (no real BIM data, §12), so it is a muted box with the box glyph rather
 * than an invented model (C10). Flagged in the header WIRE GAPS.
 */
function BimPreview({ height = 240 }: { height?: number }) {
  return (
    <div
      style={{
        height,
        background: "var(--surface-2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-3)",
      }}
    >
      <Icon name="box" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
    </div>
  );
}

/** Progress bar (ds.jsx Bar L168-188), brand fill. */
function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ width: "100%", height: 6, background: "var(--surface-3)", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: "var(--brand)", borderRadius: 999, transition: "width .3s" }} />
    </div>
  );
}

/** KPI card (ds.jsx MiniKpi L330-354). */
function MiniKpi({
  label,
  value,
  unit,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  tone?: string;
  icon?: IconName;
}) {
  return (
    <div
      style={{
        padding: 18,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        {icon && (
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: `color-mix(in srgb, ${tone || "var(--brand)"} 10%, var(--surface))`,
              color: tone || "var(--brand)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name={icon} size={15} strokeWidth={1.5} />
          </div>
        )}
        <span style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 700, color: tone || "var(--text)", letterSpacing: "-0.018em" }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{unit}</span>}
      </div>
      {sub && <div className="num" style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/** Accuracy badge (ai-qto.jsx file-type / file-row acc chip). */
function AccBadge({ label, tone, size = "md" }: { label: string; tone: string; size?: "sm" | "md" }) {
  return (
    <span
      style={{
        fontSize: size === "sm" ? 10.5 : 11,
        fontWeight: 700,
        padding: size === "sm" ? "2px 8px" : "3px 9px",
        borderRadius: 999,
        background: `color-mix(in srgb, ${tone} 14%, white)`,
        color: tone,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export function AIQuantityTakeoff() {
  const { t, tp } = useI18n();

  // Real AI-credit quota (GET /me -> package.limits.ai + package.ai_used). The chip/modal
  // are not rendered (no i18n keys, not in the reference — header WIRE GAPS), but the quota
  // still gates the start button here and the backend gates the upload with a 402.
  const meQ = useMe();
  const pkg = meQ.data?.package as Record<string, unknown> | undefined;
  const pkgLimits = pkg?.limits as Record<string, unknown> | undefined;
  const aiLimit = typeof pkgLimits?.ai === "number" ? pkgLimits.ai : null;
  const aiUsed = typeof pkg?.ai_used === "number" ? pkg.ai_used : 0;
  const quotaExhausted = aiLimit != null && aiLimit >= 0 && aiUsed >= aiLimit;

  const [step, setStep] = useState(1);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [lod, setLod] = useState("300");
  const [rows, setRows] = useState<QtoRow[]>([]);
  const [selRow, setSelRow] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const upload = useUploadAiQto();
  const jobQ = useAiQtoJob(step >= 2 ? jobId : null);

  // Step 2 -> 3: advance when the real job status resolves (no fabricated timer — §0 rule 3).
  useEffect(() => {
    if (step === 2 && jobQ.isSuccess) setStep(3);
  }, [step, jobQ.isSuccess]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked: PickedFile[] = Array.from(list).map((f) => ({ name: f.name, ext: extOf(f.name), blob: f }));
    if (picked.length) setFiles((f) => [...f, ...picked]);
  };

  // Sample buttons: a placeholder Blob stands in for a real model (the stub ignores content).
  const addSample = (ext: string) => {
    const blob = new Blob([`aiqto-sample-${ext}`], { type: "application/octet-stream" });
    setFiles((f) => [...f, { name: `sample.${ext.toLowerCase()}`, ext, blob }]);
  };

  const startExtract = () => {
    const file = files[0]?.blob;
    if (!file || quotaExhausted) return;
    upload.mutate(file, {
      onSuccess: (job) => {
        const j = job as Record<string, unknown>;
        const id = typeof j.job_id === "string" ? j.job_id : typeof j.id === "string" ? j.id : null;
        setJobId(id);
        setStep(2);
      },
      // Over quota / rejected -> stay on step 1 (the backend enforced it; no fabricated toast).
    });
  };

  const restart = () => {
    setStep(1);
    setRows([]);
    setSelRow(null);
    setJobId(null);
  };

  return (
    <Page
      breadcrumbs={[t("nav.sec.boq"), tp(P("breadcrumbLeaf"))]}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          {t("boq.aiqTitle")} <DemoBadge />
        </span>
      }
      subtitle={t("boq.aiqSubtitle")}
    >
      <Card>
        <StepHeader step={step} />

        {/* STEP 1 — Upload (the visual-gate reference, g1/09) */}
        {step === 1 && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".ifc,.rvt,.dwg,.dxf,.pdf"
              style={{ display: "none" }}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 18 }}>
              <div>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: "1.5px dashed var(--border-strong)",
                    borderRadius: 12,
                    padding: "34px 20px",
                    textAlign: "center",
                    background: "var(--surface-2)",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 14,
                      background: "var(--brand-soft)",
                      color: "var(--brand)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto 12px",
                    }}
                  >
                    <Icon name="upload" size={26} />
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{t("boq.aiqDropzone")}</div>
                  <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 5 }}>{t("boq.aiqSupportFormats")}</div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14, flexWrap: "wrap" }}>
                    <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
                      <Btn kind="outline" size="sm" icon="box" onClick={() => addSample("IFC")}>
                        {t("boq.aiqSampleIfc")}
                      </Btn>
                    </span>
                    <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
                      <Btn kind="outline" size="sm" icon="doc" onClick={() => addSample("DWG")}>
                        {t("boq.aiqSampleDwg")}
                      </Btn>
                    </span>
                  </div>
                </div>

                {files.length > 0 && (
                  <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                    {files.map((f, i) => {
                      const ft = FILE_TYPES.find((x) => x.ext === f.ext) ?? FILE_TYPES[0];
                      return (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            padding: "11px 14px",
                            border: "1px solid var(--border)",
                            borderRadius: 10,
                            background: "var(--surface)",
                          }}
                        >
                          <div style={{ width: 48, height: 36, borderRadius: 6, overflow: "hidden", flexShrink: 0, border: "1px solid var(--border)" }}>
                            <BimPreview height={36} />
                          </div>
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 9,
                              background: "var(--surface-2)",
                              color: "var(--brand)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Icon name={ft.icon} size={18} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {f.name}
                            </div>
                            <div className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>
                              {f.ext} {"·"} {humanSize(f.blob.size)}
                            </div>
                          </div>
                          <AccBadge label={t(ft.accKey)} tone={ft.tone} />
                          <button
                            onClick={() => setFiles((arr) => arr.filter((_, j) => j !== i))}
                            style={{ width: 26, height: 26, border: "none", background: "transparent", cursor: "pointer", color: "var(--text-3)" }}
                          >
                            <Icon name="x" size={15} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={{ marginTop: 16, maxWidth: 280 }}>
                  <Field label={t("boq.aiqLodLabel")}>
                    <select value={lod} onChange={(e) => setLod(e.target.value)} style={selectStyle}>
                      {LOD_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.labelKey ? t(o.labelKey) : o.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>{t("boq.aiqAccuracyByType")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {FILE_TYPES.map((ft) => (
                    <div
                      key={ft.ext}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 9 }}
                    >
                      <span className="num" style={{ width: 42, fontSize: 11, fontWeight: 800, color: "var(--text-2)" }}>
                        {ft.ext}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11.5, color: "var(--text-2)" }}>{t(ft.noteKey)}</div>
                      </div>
                      <AccBadge label={t(ft.accKey)} tone={ft.tone} size="sm" />
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--info-soft)", borderRadius: 9, fontSize: 11, color: "var(--info)", lineHeight: 1.6 }}>
                  <Icon name="info" size={13} /> {t("boq.aiqInfoAccuracy")}
                </div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                marginTop: 18,
                paddingTop: 16,
                borderTop: "1px solid var(--border)",
              }}
            >
              {/* AI-credit chip omitted (pkg-builder component, no i18n keys, not in reference —
                  header WIRE GAPS); spacer keeps the start button right-aligned as in g1/09. */}
              <div />
              <Btn
                kind="primary"
                size="md"
                disabled={files.length === 0 || quotaExhausted || upload.isPending}
                onClick={startExtract}
              >
                {t("boq.aiqStartExtract")}
                <Icon name="chevR" size={15} />
              </Btn>
            </div>
          </div>
        )}

        {/* STEP 2 — Processing (real GET /ai-qto/{job} lifecycle; canned elements em-dashed) */}
        {step === 2 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 14 }}>{t("boq.aiqProcessingTitle")}</div>
              {PROC_STEPS.map((s, i) => {
                const done = jobQ.isSuccess;
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "11px 0",
                      borderBottom: i < PROC_STEPS.length - 1 ? "1px solid var(--border)" : "none",
                    }}
                  >
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 999,
                        flexShrink: 0,
                        background: done ? "var(--ok)" : "var(--brand)",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {done ? <Icon name="check" size={15} /> : <Icon name={s.icon} size={14} />}
                    </div>
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>{t(s.labelKey)}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: done ? "var(--ok)" : "var(--brand)" }}>
                      {done ? t("boq.repStatusDone") : t("boq.aiqProcActive")}
                    </span>
                  </div>
                );
              })}
              <div style={{ marginTop: 14 }}>
                <Bar value={jobQ.isSuccess ? PROC_STEPS.length : 0} max={PROC_STEPS.length} />
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 14 }}>{t("boq.aiqElementsFound")}</div>
              {/* Detected elements are AI output with no real source (stub, §12) — honest
                  em-dash placeholder, never the canned counts (§0 rule 3 / C10). */}
              <Card pad={0} style={{ overflow: "hidden" }}>
                <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>
                  <Icon name="box" size={26} color="var(--text-3)" style={{ opacity: 0.5 }} />
                  <div className="num" style={{ marginTop: 10, fontSize: 16 }}>{DASH}</div>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* STEP 3 — Review & mapping */}
        {step === 3 && (
          <QtoReview rows={rows} setRows={setRows} selRow={selRow} setSelRow={setSelRow} onBack={restart} onNext={() => setStep(4)} />
        )}

        {/* STEP 4 — Summary & create */}
        {step === 4 && <QtoSummary jobId={jobId} rows={rows} />}
      </Card>
    </Page>
  );
}

/** Step 3: review + mapping table + model viewer (ai-qto.jsx QTOReview L228-296). */
function QtoReview({
  rows,
  setRows,
  selRow,
  setSelRow,
  onBack,
  onNext,
}: {
  rows: QtoRow[];
  setRows: React.Dispatch<React.SetStateAction<QtoRow[]>>;
  selRow: string | null;
  setSelRow: (id: string | null) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();
  const low = lowConfCount(rows);

  const updateQty = (id: string, v: string) =>
    setRows((arr) => arr.map((r) => (r.id === id ? { ...r, qty: Number.parseFloat(v) || 0 } : r)));
  const del = (id: string) => setRows((arr) => arr.filter((r) => r.id !== id));
  const addManual = () =>
    setRows((a) => [
      ...a,
      {
        id: "m" + Date.now(),
        elem: t("boq.aiqManualElem"),
        code: DASH,
        name: t("boq.aiqManualName"),
        unit: tp(P("thUnit")),
        qty: 1,
        price: 0,
        cat: "M",
        conf: 100,
        eid: "manual",
        group: "",
      },
    ]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{t("boq.aiqReviewTitle")}</div>
        {low > 0 && (
          <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "var(--danger-soft)", color: "var(--danger)" }}>
            {fill(t("boq.aiqLowConfBadge"), { n: String(low) })}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Btn kind="soft" size="sm" icon="filter" onClick={() => ctx.notify(t("boq.aiqSuggestSpecToast"))}>
            {t("boq.aiqSuggestSpec")}
          </Btn>
          <Btn kind="soft" size="sm" icon="check" onClick={() => ctx.notify(t("boq.aiqCheckDupToast"))}>
            {t("boq.aiqCheckDup")}
          </Btn>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 16, alignItems: "start" }}>
        <Card pad={0} style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <th style={th(160)}>{t("boq.aiqThElement")}</th>
                  <th style={th(90)}>{tp(P("thCode"))}</th>
                  <th style={th()}>{t("nav.boq.list" as DictKey)}</th>
                  <th style={th(60)}>{tp(P("thUnit"))}</th>
                  <th style={th(90, "right")}>{t("boq.aiqThQty")}</th>
                  <th style={th(80)}>{tp(P("thCat"))}</th>
                  <th style={th(70)}>{t("boq.aiqThAi")}</th>
                  <th style={th(40)} />
                </tr>
              </thead>
              <tbody>
                {/* Real (initially empty) take-off rows — no canned AI rows (stub, §12). Manual
                    rows the user adds render here; the moment a real engine lands the same
                    markup lights up from parseQtoItems(job.items). */}
                {rows.map((r) => {
                  const isLow = r.conf < 80;
                  const sel = selRow === r.id;
                  const cm = CAT_META[r.cat];
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelRow(r.id)}
                      style={{
                        borderTop: "1px solid var(--border)",
                        cursor: "pointer",
                        background: sel ? "var(--brand-soft)" : isLow ? "var(--danger-soft)" : "transparent",
                      }}
                    >
                      <td style={{ ...td, padding: "10px 14px", fontSize: 11 }}>
                        {r.elem}
                        <div className="num" style={{ fontSize: 9.5, color: "var(--text-3)" }}>{r.eid}</div>
                      </td>
                      <td style={{ ...td, padding: "10px 14px" }} className="num">{r.code}</td>
                      <td style={{ ...td, padding: "10px 14px", fontWeight: 600 }}>{r.name}</td>
                      <td style={{ ...td, padding: "10px 14px", color: "var(--text-3)" }}>{r.unit}</td>
                      <td style={{ ...td, padding: "10px 14px", textAlign: "right" }}>
                        <input
                          value={r.qty}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateQty(r.id, e.target.value.replace(/[^\d.]/g, ""))}
                          className="num"
                          style={{ width: 64, height: 26, padding: "0 6px", textAlign: "right", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11.5, fontFamily: "inherit" }}
                        />
                      </td>
                      <td style={{ ...td, padding: "10px 14px" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: `color-mix(in srgb, ${cm.tone} 13%, white)`, color: cm.tone }}>
                          {tp(P(cm.labelAlias))}
                        </span>
                      </td>
                      <td style={{ ...td, padding: "10px 14px" }}>
                        <span
                          className="num"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "2px 6px",
                            borderRadius: 999,
                            background: r.conf >= 90 ? "var(--ok-soft)" : r.conf >= 80 ? "var(--warn-soft)" : "var(--danger-soft)",
                            color: r.conf >= 90 ? "var(--ok)" : r.conf >= 80 ? "var(--warn)" : "var(--danger)",
                          }}
                        >
                          {r.conf}%
                        </span>
                      </td>
                      <td style={{ ...td, padding: "10px 14px" }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            del(r.id);
                          }}
                          style={{ width: 24, height: 24, border: "none", background: "transparent", cursor: "pointer", color: "var(--text-3)" }}
                        >
                          <Icon name="x" size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)" }}>
            <Btn kind="ghost" size="sm" icon="plus" onClick={addManual}>
              {t("boq.aiqAddRow")}
            </Btn>
          </div>
        </Card>

        <Card pad={0} style={{ position: "sticky", top: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
            <Icon name="box" size={15} color="var(--brand)" /> {t("boq.aiqViewerHeader")}
          </div>
          <BimPreview />
        </Card>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <Btn kind="ghost" size="md" icon="chevL" onClick={onBack}>
          {t("boq.aiqRestart")}
        </Btn>
        <Btn kind="primary" size="md" onClick={onNext}>
          {t("boq.aiqConfirmMatch")}
          <Icon name="chevR" size={15} />
        </Btn>
      </div>
    </div>
  );
}

/** Step 4: summary + create BOQ (ai-qto.jsx QTOSummary L299-376). */
function QtoSummary({ jobId, rows }: { jobId: string | null; rows: QtoRow[] }) {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();
  const create = useCreateBoqFromAiQto(jobId);

  const total = qtoTotal(rows);
  const has = rows.length > 0;
  const groups = groupByCode(rows);

  const createBOQ = () => {
    create.mutate(toMappings(rows), {
      onSuccess: (doc) => {
        const d = doc as Record<string, unknown>;
        const no = typeof d.no === "string" ? d.no : DASH;
        ctx.notify(fill(t("boq.aiqCreateToast"), { no, n: String(rows.length) }));
        ctx.navigate("boq.list");
      },
      // create-boq needs project_id the SACRED contract omits (see use-aiqto.ts) — the
      // backend's honest 400 surfaces rather than a fabricated success.
    });
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 18 }}>
        <MiniKpi label={t("boq.aiqKpiExtracted")} value={String(rows.length)} unit={tp(P("itemsUnit"))} tone="var(--brand)" icon="grid" />
        <MiniKpi label={t("boq.aiqKpiValue")} value={has ? millions2(total) : DASH} unit={tp(P("millionBaht"))} tone="var(--ok)" icon="budget" />
        <MiniKpi label={t("boq.aiqKpiConf")} value={has ? `${avgConfidence(rows)}%` : DASH} tone="var(--info)" icon="check" />
        <MiniKpi label={t("boq.aiqKpiNeedCheck")} value={String(lowConfCount(rows))} unit={tp(P("itemsUnit"))} tone="var(--warn)" icon="warn" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16 }}>
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{t("boq.aiqModelCostShare")}</div>
          <div style={{ borderRadius: 8, overflow: "hidden", marginBottom: 12, border: "1px solid var(--border)" }}>
            <BimPreview height={120} />
          </div>
          <div style={{ display: "flex", height: 24, borderRadius: 6, overflow: "hidden", marginBottom: 12, background: "var(--surface-2)" }}>
            {QTO_CAT_ORDER.map((c) => {
              const pct = qtoCatPct(rows, c);
              if (pct <= 0) return null;
              return (
                <div
                  key={c}
                  style={{ width: `${pct}%`, background: CAT_META[c].tone, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700 }}
                >
                  {pct}%
                </div>
              );
            })}
          </div>
          {QTO_CAT_ORDER.map((c) => (
            <div key={c} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: CAT_META[c].tone }} />
                {tp(P(CAT_META[c].labelAlias))}
              </span>
              <span className="num" style={{ fontWeight: 700 }}>{has ? formatMoney(qtoCatTotal(rows, c)) : DASH}</span>
            </div>
          ))}
        </Card>

        <Card pad={0}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 700 }}>{t("boq.aiqGroupWork")}</div>
          <div style={{ padding: 8 }}>
            {groups.map((gp) => (
              <div key={gp.key} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: "var(--surface-2)", borderRadius: 7, fontSize: 12.5, fontWeight: 700 }}>
                  <span>{t(GROUP_LABEL_KEY[gp.key])}</span>
                  <span className="num" style={{ color: "var(--brand)" }}>{formatMoney(gp.total)}</span>
                </div>
                {gp.rows.map((r) => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 14px", fontSize: 11.5 }}>
                    <span style={{ color: "var(--text-2)" }}>
                      <span className="num">{r.code}</span> {r.name}
                    </span>
                    <span className="num">{formatMoney(r.qty)} {r.unit}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>
          {t("boq.aiqKpiValue")}
          <b className="num" style={{ fontSize: 17, color: "var(--brand)", marginLeft: 8 }}>
            {has ? `${formatMoney(total)} ${BAHT}` : DASH}
          </b>
        </div>
        <Btn kind="primary" size="lg" icon="check" disabled={create.isPending} onClick={createBOQ}>
          {fill(t("boq.aiqCreateBoq"), { n: String(rows.length) })}
        </Btn>
      </div>
    </div>
  );
}
