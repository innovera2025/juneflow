/*
 * ShellContext — React-context replacement for the prototype's window.__juneflowCtx
 * global singleton (pototype/shell.jsx:100-102). Provides the exact ctx shape the
 * prototype's popovers/screens read:
 *   { route, params, navigate, back, history, notify, openModal, closeModal,
 *     confirm, tweaks, setTweak, resetTweaks }  (shell.jsx:100)
 *
 * Routing is delegated to TanStack Router (URL-based) instead of shell.jsx's
 * internal useState route — `route` is derived from the current pathname and
 * navigate() drives the router. The shell-local history stack mirrors shell.jsx
 * (cap 12) so the back-nav strip reproduces exactly. tweaks persist to
 * localStorage "juneflow-state" like the prototype (route/params live in the URL).
 *
 * Mock mechanics dropped (§0 rule 3): window.__fioriBusy (shell.jsx:65) is not
 * ported; toast auto-dismiss keeps the code-accurate 2400ms (shell.jsx:85).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { IconName } from "../ui/icon";

/** viewMode: tenant (customer) vs platform (system owner) — sidebar mode gate. */
export type ViewMode = "tenant" | "platform";

/** The loose tweaks bag (shell.jsx TWEAK_DEFAULTS + company/project/viewMode). */
export interface Tweaks {
  theme: string;
  density: string;
  accent: string;
  viewMode: ViewMode;
  /** Active company id (CompanySwitcher). */
  company?: string;
  /** Active "projectId.phaseId" (ProjectSwitcher). */
  project?: string;
}

/** Modal descriptor (shell.jsx modal state: custom | confirm | fullbleed). */
export interface ModalCfg {
  kind: "custom" | "confirm" | "fullbleed";
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  iconTone?: string;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  body?: ReactNode | ((args: { ctx: ShellCtx; close: () => void }) => ReactNode);
  [key: string]: unknown;
}

export type ToastTone = "ok" | "info" | "warn" | "danger";
export interface ToastState {
  msg: string;
  tone: ToastTone;
}

interface HistoryEntry {
  route: string;
  params: Record<string, unknown>;
}

/** The app context shape — mirrors shell.jsx ctx 1:1 (plus modal/toast read state). */
export interface ShellCtx {
  route: string;
  params: Record<string, unknown>;
  navigate: (route: string, params?: Record<string, unknown>) => void;
  back: () => void;
  history: HistoryEntry[];
  notify: (msg: string, tone?: ToastTone) => void;
  openModal: (cfg: Omit<ModalCfg, "kind">) => void;
  closeModal: () => void;
  confirm: (cfg: Omit<ModalCfg, "kind">) => void;
  tweaks: Tweaks;
  setTweak: (k: keyof Tweaks, v: Tweaks[keyof Tweaks]) => void;
  resetTweaks: () => void;
  /** Read-only view of the active modal (rendered by the shell host). */
  modal: ModalCfg | null;
  /** Read-only view of the active toast (rendered by the shell host). */
  toast: ToastState | null;
}

/** shell.jsx TWEAK_DEFAULTS (theme/density/accent) + viewMode default "tenant". */
export const TWEAK_DEFAULTS: Tweaks = {
  theme: "light",
  density: "comfortable",
  accent: "navy",
  viewMode: "tenant",
};

const STATE_KEY = "juneflow-state";
const TOAST_MS = 2400;

const ShellContext = createContext<ShellCtx | null>(null);

/** Read persisted tweaks from localStorage (guarded, like shell.jsx). */
function loadTweaks(): Tweaks {
  try {
    const raw = globalThis.localStorage?.getItem(STATE_KEY);
    if (!raw) return { ...TWEAK_DEFAULTS };
    const parsed = JSON.parse(raw) as { tweaks?: Partial<Tweaks> };
    return { ...TWEAK_DEFAULTS, ...(parsed.tweaks ?? {}) };
  } catch {
    return { ...TWEAK_DEFAULTS };
  }
}

function persistTweaks(tweaks: Tweaks): void {
  try {
    globalThis.localStorage?.setItem(STATE_KEY, JSON.stringify({ tweaks }));
  } catch {
    /* storage unavailable — no-op */
  }
}

/** Current route id from the URL pathname ("/boq.overview" -> "boq.overview"). */
function routeFromPath(pathname: string): string {
  const id = pathname.replace(/^\/+/, "").split("/")[0];
  return id || "dashboard";
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const navigateRouter = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const route = routeFromPath(pathname);

  const [params, setParams] = useState<Record<string, unknown>>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [modal, setModal] = useState<ModalCfg | null>(null);
  const [tweaks, setTweaks] = useState<Tweaks>(() => loadTweaks());
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  // Persist tweaks on change (shell.jsx persists route/params/tweaks; route/params
  // are the URL here, so only tweaks need mirroring to localStorage).
  useEffect(() => persistTweaks(tweaks), [tweaks]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Apply data-density globally (B-042). The prototype applyTweaks (shell.jsx:16)
  // sets data-theme + data-density; the theme stays navy (B-042), but
  // density is live via @juneflow/tokens [data-density] CSS. Default = "comfortable"
  // (TWEAK_DEFAULTS), so var(--gap)/var(--pad-*) resolve to the comfortable geometry
  // that the reference gallery was captured at.
  useEffect(() => {
    try {
      document.documentElement.setAttribute("data-density", tweaks.density);
    } catch {
      /* no document (SSR/tests) */
    }
  }, [tweaks.density]);

  const navigate = useCallback(
    (newRoute: string, newParams: Record<string, unknown> = {}) => {
      setHistory((h) => [...h, { route, params }].slice(-12));
      setParams(newParams);
      navigateRouter({ to: `/${newRoute}` as never });
    },
    [route, params, navigateRouter],
  );

  const back = useCallback(() => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (!prev) return h;
      setParams(prev.params);
      navigateRouter({ to: `/${prev.route}` as never });
      return h.slice(0, -1);
    });
  }, [navigateRouter]);

  const notify = useCallback((msg: string, tone: ToastTone = "ok") => {
    setToast({ msg, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const openModal = useCallback(
    (cfg: Omit<ModalCfg, "kind">) => setModal({ kind: "custom", ...cfg }),
    [],
  );
  const confirm = useCallback(
    (cfg: Omit<ModalCfg, "kind">) => setModal({ kind: "confirm", ...cfg }),
    [],
  );
  const closeModal = useCallback(() => setModal(null), []);

  const setTweak = useCallback(
    (k: keyof Tweaks, v: Tweaks[keyof Tweaks]) => {
      setTweaks((prev) => ({ ...prev, [k]: v }));
    },
    [],
  );

  const resetTweaks = useCallback(() => setTweaks({ ...TWEAK_DEFAULTS }), []);

  const ctx = useMemo<ShellCtx>(
    () => ({
      route,
      params,
      navigate,
      back,
      history,
      notify,
      openModal,
      closeModal,
      confirm,
      tweaks,
      setTweak,
      resetTweaks,
      modal,
      toast,
    }),
    [route, params, navigate, back, history, notify, openModal, closeModal, confirm, tweaks, setTweak, resetTweaks, modal, toast],
  );

  return <ShellContext.Provider value={ctx}>{children}</ShellContext.Provider>;
}

/** Access the shell ctx. Throws outside <ShellProvider>. */
export function useShellCtx(): ShellCtx {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShellCtx must be used within <ShellProvider>");
  return ctx;
}
