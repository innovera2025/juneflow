/*
 * MasterModel — the Model / House-type catalogue screen, ported 1:1 from
 * pototype/master.jsx MasterModel (L507-578). Route master.model, visual-gate
 * reference tests/visual/reference/gallery/g2/33.
 *
 * Design fidelity (PLAN.md §0 rule 1): the layout — the two-crumb breadcrumb, the
 * title/subtitle, the add-model action, and the three-column card grid (colour-striped
 * card; gradient header with the inline house glyph + status badge + code badge; the
 * type + spec line; the price / BOM two-cell row; the BOM + edit actions + unit count) —
 * is the prototype's, verbatim. The inline house <svg> is kept as-is (ds.jsx has no
 * "house" glyph); every tokened colour stays var(--), the card's per-model colour hex is
 * the server's (B-050), rendered directly like master-project.tsx.
 *
 * Mock mechanics dropped (rule 3): the prototype's MODELS local state becomes the real
 * catalogue (GET /models, use-models.ts); create is POST /models (server assigns colour
 * + status="draft", so the body omits them) that invalidates the list. The mock BOM
 * number (248+i*30, master.jsx:563) is FORBIDDEN — the BOM cell reads the real
 * bom_item_count; the bottom count reads the real unit_count.
 *
 * i18n (rule 2): navTitle is the "Model / House-type" nav_i18n key (tn), sourced from
 * model-strings.json so no Thai literal sits in this .tsx (i18n-guard). statusActive/
 * statusDraft/sqm/item/unit are model-strings.json phrases (tp). The spec line REUSES
 * t("model.fieldBed") / t("model.fieldBath") (the form field labels) as the bedroom/
 * bathroom words and t("model.parkingLabel") for parking — exact-reuse, B-057 precedent.
 * parkingLabel / priceUnit / toastAdd are the B-063 keys. tokens back every colour
 * (rule 6); the code-badge #fff bg + its boxShadow + the gradient alpha suffixes are
 * prototype-verbatim literals (B-037).
 */
import { useMemo } from "react";
import type { NavKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toModelCard,
  formatModelPrice,
  hasBom,
  statusActive,
  type ModelCard,
} from "./model-cards";
import { useModelList, useCreateModel } from "./use-models";
import { ModelAddForm, type ModelDraft } from "./model-add-form";
import modelStrings from "./model-strings.json" with { type: "json" };

export function MasterModel() {
  const { t, tn, tp } = useI18n();
  const ctx = useShellCtx();

  const modelsQ = useModelList();
  const createModel = useCreateModel();

  const cards = useMemo<ModelCard[]>(
    () => (modelsQ.data ?? []).map(toModelCard),
    [modelsQ.data],
  );

  const navTitle = tn(modelStrings.navTitle as NavKey);
  const activeWord = tp(modelStrings.statusActive as PhraseKey);
  const draftWord = tp(modelStrings.statusDraft as PhraseKey);
  const sqmWord = tp(modelStrings.sqm as PhraseKey);
  const itemWord = tp(modelStrings.item as PhraseKey);
  const unitWord = tp(modelStrings.unit as PhraseKey);

  // add model (master.jsx:510-521): open the form modal; on submit fire the create
  // mutation (server assigns colour + status="draft") + the add toast, then close.
  const openAdd = () =>
    ctx.openModal({
      title: t("model.addTitle"),
      subtitle: t("model.addSubtitle"),
      icon: "plus",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <ModelAddForm
          existingCodes={cards.map((c) => c.code)}
          onClose={close}
          onSubmit={(draft: ModelDraft) => {
            // Compose the opaque POST /models body: price MILLIONS -> FULL baht + THB;
            // no colour/status/counts (server-assigned, B-050).
            createModel.mutate(
              {
                code: draft.code,
                type: draft.type,
                area: draft.area,
                bed: draft.bed,
                bath: draft.bath,
                parking: draft.parking,
                price: draft.price * 1_000_000,
                currency_code: "THB",
              },
              {
                onSuccess: () =>
                  ctx.notify(
                    t("model.toastAdd")
                      .replace("{code}", draft.code)
                      .replace("{type}", draft.type),
                  ),
              },
            );
            close();
          }}
        />
      ),
    });

  return (
    <Page
      breadcrumbs={[t("master.breadcrumb"), navTitle]}
      title={navTitle}
      subtitle={t("model.subtitle")}
      actions={
        <Btn kind="primary" size="md" icon="plus" onClick={openAdd}>
          {t("model.addBtn")}
        </Btn>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {modelsQ.isLoading
          ? // Loading skeleton (grid) — token blocks, no invented copy.
            [0, 1, 2].map((n) => (
              <div
                key={n}
                style={{
                  height: 248,
                  borderRadius: "var(--r-lg)",
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                }}
              />
            ))
          : cards.map((c) => (
              <Card
                key={c.id}
                pad={0}
                style={{ overflow: "hidden", borderTop: `4px solid ${c.color}` }}
              >
                <div
                  style={{
                    height: 120,
                    background: `linear-gradient(135deg, ${c.color}22, ${c.color}08)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                  }}
                >
                  {/* Inline house glyph — ds.jsx has no "house" Icon; kept verbatim
                      (master.jsx:537-539). Stroke = the server colour. */}
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M3 21h18M5 21V9l7-5 7 5v12M9 12h2M13 12h2M9 16h2M13 16h2"
                      stroke={c.color}
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 10,
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: statusActive(c) ? "var(--ok-soft)" : "var(--warn-soft)",
                      color: statusActive(c) ? "var(--ok)" : "var(--warn)",
                    }}
                  >
                    {statusActive(c) ? activeWord : draftWord}
                  </span>
                  <span
                    className="num"
                    style={{
                      position: "absolute",
                      top: 10,
                      left: 10,
                      fontSize: 12,
                      fontWeight: 700,
                      padding: "3px 10px",
                      borderRadius: 4,
                      background: "#fff",
                      color: c.color,
                      boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
                    }}
                  >
                    {c.code}
                  </span>
                </div>
                <div style={{ padding: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{c.type}</div>
                  <div
                    className="num"
                    style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}
                  >
                    {`${c.area} ${sqmWord} · ${c.bed} ${t("model.fieldBed")} · ${c.bath} ${t("model.fieldBath")} · ${c.parking} ${t("model.parkingLabel")}`}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 10,
                      marginTop: 12,
                      paddingTop: 12,
                      borderTop: "1px dashed var(--border)",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{t("model.priceLabel")}</div>
                      <div className="num" style={{ fontSize: 14, fontWeight: 700, color: c.color }}>
                        {`${formatModelPrice(c.price)} ${t("model.priceUnit")}`}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>BOM</div>
                      <div className="num" style={{ fontSize: 12, fontWeight: 600 }}>
                        {hasBom(c) ? `${c.bom_item_count} ${itemWord}` : "—"}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                    <Btn
                      kind="soft"
                      size="sm"
                      icon="grid"
                      onClick={() => ctx.notify(t("model.notifyOpenBom"))}
                    >
                      BOM
                    </Btn>
                    {/* Edit action — no onClick in the prototype (master.jsx:569); a
                        render-only dead button. No PATCH /models exists (B-050). */}
                    <Btn kind="ghost" size="sm" icon="edit" />
                    <span
                      className="num"
                      style={{
                        marginInlineStart: "auto",
                        fontSize: 10.5,
                        color: "var(--text-3)",
                        alignSelf: "center",
                      }}
                    >
                      {`${c.unit_count} ${unitWord}`}
                    </span>
                  </div>
                </div>
              </Card>
            ))}
      </div>
    </Page>
  );
}
