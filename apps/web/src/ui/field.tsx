/*
 * Field — labelled form control, ported 1:1 from pototype/pr-form.jsx Field().
 * Required marker is a token-red asterisk. All colors from @juneflow/tokens.
 */
import type { CSSProperties, ReactNode } from "react";

export interface FieldProps {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}

export function Field({ label, required, hint, children, style = {} }: FieldProps) {
  return (
    <div style={style}>
      <label
        style={{
          display: "block",
          fontSize: 11.5,
          fontWeight: 600,
          color: "var(--text-2)",
          marginBottom: 6,
        }}
      >
        {label} {required && <span style={{ color: "var(--danger)" }}>*</span>}
      </label>
      {children}
      {hint && (
        <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}
