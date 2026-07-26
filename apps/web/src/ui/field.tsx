/*
 * Field — labelled form control, ported 1:1 from pototype/pr-form.jsx Field().
 * Required marker is a token-red asterisk. All colors from @juneflow/tokens.
 */
import { cloneElement, isValidElement, useId } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";

export interface FieldProps {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}

export function Field({ label, required, hint, children, style = {} }: FieldProps) {
  // Associate the label with its control (htmlFor→id). If the single child element
  // already carries an id, respect it; otherwise inject a generated one. No visual change.
  const generatedId = useId();
  const child = isValidElement(children) ? (children as ReactElement<{ id?: string }>) : null;
  const controlId = child?.props.id ?? generatedId;
  const control =
    child && child.props.id === undefined ? cloneElement(child, { id: controlId }) : children;
  return (
    <div style={style}>
      <label
        htmlFor={controlId}
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
      {control}
      {hint && (
        <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}
