/*
 * ModalHost + ConfirmDialog — the shared modal host from pototype/shell.jsx
 * (197-206). One `modal` state renders kind custom (Modal), confirm (ConfirmDialog),
 * or fullbleed (raw body). The render-prop body({ctx,close}) contract matches the
 * prototype (shell.jsx:202,205). Extracted so the login branch and the shell branch
 * reuse ONE host instead of duplicating the markup (shell.jsx:109-112 vs 197-206).
 */
import type { ReactNode } from "react";
import { Modal } from "../ui/modal";
import { Btn } from "../ui/button";
import { useI18n } from "../i18n";
import { useShellCtx, type ModalCfg } from "./shell-context";

/** Confirm modal (shell.jsx confirm kind). Minimal port: title/subtitle/message +
 *  cancel/confirm actions (dict keys common.cancel/common.confirm). */
function ConfirmDialog({ cfg, onClose }: { cfg: ModalCfg; onClose: () => void }) {
  const { t } = useI18n();
  const message = cfg.message as ReactNode | undefined;
  const onConfirm = cfg.onConfirm as (() => void) | undefined;
  const danger = cfg.danger === true;
  return (
    <Modal
      title={cfg.title}
      subtitle={cfg.subtitle}
      icon={cfg.icon}
      iconTone={cfg.iconTone}
      size={cfg.size ?? "sm"}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, marginInlineStart: "auto" }}>
          <Btn kind="outline" size="md" onClick={onClose}>
            {t("common.cancel")}
          </Btn>
          <Btn
            kind={danger ? "danger" : "primary"}
            size="md"
            onClick={() => {
              onConfirm?.();
              onClose();
            }}
          >
            {t("common.confirm")}
          </Btn>
        </div>
      }
    >
      {message}
    </Modal>
  );
}

export function ModalHost() {
  const ctx = useShellCtx();
  const modal = ctx.modal;
  if (!modal) return null;
  const close = ctx.closeModal;
  const body = typeof modal.body === "function" ? modal.body({ ctx, close }) : modal.body;

  if (modal.kind === "confirm") return <ConfirmDialog cfg={modal} onClose={close} />;
  if (modal.kind === "fullbleed") return <>{body}</>;
  // custom
  return (
    <Modal
      title={modal.title}
      subtitle={modal.subtitle}
      icon={modal.icon}
      iconTone={modal.iconTone}
      size={modal.size}
      onClose={close}
    >
      {body}
    </Modal>
  );
}
