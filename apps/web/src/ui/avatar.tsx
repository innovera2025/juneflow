/*
 * Avatar — ported 1:1 from pototype/ds.jsx Avatar() (200-211). Initials circle.
 * The default fallback color #0F766E is a prototype-verbatim literal (B-037(a):
 * no matching @juneflow/tokens value); callers pass a token/data color when known.
 */
export interface AvatarProps {
  name: string;
  color?: string;
  size?: number;
}

export function Avatar({ name, color = "#0F766E", size = 28 }: AvatarProps) {
  const initials = (name || "?")
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: color,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.4,
        fontWeight: 700,
        flexShrink: 0,
        letterSpacing: "-0.01em",
      }}
    >
      {initials}
    </div>
  );
}
