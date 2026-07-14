/*
 * TypeBadge — ported 1:1 from pototype/project-types.jsx TypeBadge() (75-92).
 * Project-type pill (icon + name). The type color is prototype/data-verbatim
 * (B-037(a): project-type identity color, no @juneflow/tokens match). Name text
 * is the type's localized name from project-types.json (en shows nameEn, matching
 * the prototype's `I18N.get()==="en" ? nameEn : name`).
 */
import { Icon } from "../ui/icon";
import { useI18n } from "../i18n";
import { projectTypeMeta } from "./project-types";

export interface TypeBadgeProps {
  type: string;
  size?: "sm" | "md";
  showName?: boolean;
}

export function TypeBadge({ type, size = "md", showName = true }: TypeBadgeProps) {
  const { lang } = useI18n();
  const t = projectTypeMeta(type);
  const h = size === "sm" ? 20 : 24;
  const fs = size === "sm" ? 10 : 11;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: h,
        padding: showName ? "0 8px 0 6px" : 0,
        width: showName ? "auto" : h,
        justifyContent: "center",
        borderRadius: 999,
        background: `color-mix(in srgb, ${t.color} 13%, white)`,
        color: t.color,
        fontSize: fs,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      <Icon name={t.icon as never} size={size === "sm" ? 11 : 13} />
      {showName && <span>{lang === "en" ? t.nameEn : t.name}</span>}
    </span>
  );
}
