# A11y + RTL-Correctness Audit — ported web screens

**Scope:** `apps/web/src/screens/**`, `apps/web/src/ui/*`, `apps/web/src/shell/*` — read-only.
**Author:** orch-B recon. **Consumer:** orch-A (fixes land in `apps/web`, orch-A's porting zone). orch-B did NOT edit any `apps/web` file.
**Method:** static analysis (grep + JSX-tag parser attributing every `onClick` to its element; physical-CSS greps). Line numbers are as-of this scan.

> Design-fidelity caveat (root CLAUDE.md / PLAN.md §0): every fix below MUST preserve the exact rendered pixels. All recommended changes are *semantic/attribute-only* (swap `<div onClick>` → `<button>` reset to unstyled, add `aria-*`, convert physical CSS to the logical equivalent that renders identically in LTR). None change layout in the `en`/`th` (LTR) reference used by the visual gate. Convert physical→logical props (they are pixel-identical in LTR) so RTL comes for free; keep the visual gate green.

---

## 1. Summary (headline numbers)

| Metric | Count | Notes |
|---|---:|---|
| `aria-label` occurrences (whole web app) | **4** | all 4 in `ui/date-picker.tsx` only |
| `aria-hidden` occurrences | **2** | `ui/icon.tsx` (covers ALL icons — good) + one in master-company |
| `role=` occurrences | **0** | no dialog/menu/menuitem/row roles anywhere |
| `aria-modal` occurrences | **0** | no modal exposes dialog semantics |
| `aria-live` / live regions | **0** | toasts (`shell/toast-host.tsx`) are not announced |
| `<th scope=…>` | **0** | no data table sets column/row scope |
| `htmlFor` (label→control association) | **0** | **no `<input>`/`<select>` in the app is programmatically labelled** |
| **`onClick` on non-interactive DOM tags** | **53** | 42 `<div>`, 5 `<tr>`, 4 `<span>`, 2 `<td>` — see §2. Of these ~**39 are genuine interactive controls** needing keyboard support; ~6 are benign `stopPropagation` catchers; ~8 are backdrop overlays. |
| Icon-only controls with **no accessible name** | **16** | 12 raw `<button>` (icon only, no `aria-label`) + 4 self-closing `<Btn icon=… />` |
| **Physical-CSS lines defeating RTL** | **~99** | 37 margin/padding (`marginLeft/Right`,`paddingLeft/Right`) + 11 `textAlign:"left"` + 39 `textAlign:"right"` (numeric cols, borderline) + ~12 static `left/right` positioning. **High-confidence subset ≈ 60** (excludes the 39 borderline numeric right-aligns). |

**The two systemic red flags:** (1) `aria-label`/`role`/`aria-modal`/`htmlFor`/`scope`/`aria-live` are essentially all **zero** — the app has almost no assistive-tech affordances; (2) the **entire app chrome** (sidebar nav rows, topbar company/project/language switchers, notifications, user menu, search results) is built from `<div onClick>`, so a keyboard user cannot Tab to or operate navigation at all. Both are best fixed in shared primitives / shell (§4), not screen-by-screen.

RTL infrastructure **is** live: `shell/app-shell.tsx:47` renders `<div dir={dir}>` and `i18n/lang-store.ts` sets `<html dir="rtl">` for `ar`, and the topbar already flips its breadcrumb chevron by `dir`. So the physical CSS below genuinely lands on the wrong side in `ar` — it is a real bug, not dormant.

---

## 2. Per-screen findings

Legend — a11y issue types:
- **NAV/CTRL-as-div** = interactive control rendered as `<div>/<span>/<tr>` (not focusable/operable by keyboard) → convert to `<button>` (unstyled reset) or add `role`+`tabIndex`+`onKeyDown`.
- **icon-btn** = icon-only button with no `aria-label`.
- **menu** = dropdown menu built of `<div onClick>` items with no `role="menu"`/`menuitem`, no arrow-key/Escape.
- **row-click** = `<tr onClick>` navigates but row is not keyboard-reachable.
- **label** = form control not associated to a label (`htmlFor=0` everywhere).
- **backdrop** = `<div onClick>` overlay to dismiss; benign but usually lacks an Escape handler for keyboard users.

RTL column = physical-CSS lines on that screen (margin/padding/textAlign/positioning) needing logical-prop conversion.

### Screens

| Screen (file) | A11y issues (file:line) | RTL physical-CSS | Priority |
|---|---|---:|---|
| **boq/boq-list.tsx** | menu items `<div onClick>` L498/507/510/515; backdrop L479; label-count `<span onClick>` L405; icon-only more-btn L458; 3 raw `<input>` unlabelled | ~6 — `textAlign:"left"` L494; `right:8` L486; `marginLeft:"auto"` L343; `textAlign:"right"` L417/453/534 | P2 |
| **boq/boq-editor.tsx** | menu items `<div onClick>` L434/439/449/1145/1148/1152; backdrops L416/1126; group-row `<div onClick>` L1081; icon-only btns L396/1056/1094; 11 raw `<input>` unlabelled | ~16 (most on screen) — `textAlign:"left"` L430/1522; `marginLeft` L216/356/1195/1251; `right:` L421/596/1136; `textAlign:"right"` L382/386/389/609/1378/1381 | **P1** (heaviest) |
| **boq/boq-overview.tsx** | (controls are `<Btn>` — ok); check tree/expand rows | ~7 — `paddingLeft:10` L296; `marginRight:6` L724; `textAlign:"right"` L736–741 (5, numeric) | P3 |
| **boq/boq-approval.tsx** | `<div onClick>` L430 (toggle row); raw `<label>` L724 unassociated | ~5 — `marginLeft` L178/608; `marginRight:4` L755; `textAlign:"right"` L642/647 | P2 |
| **boq/boq-bom.tsx** | `<div onClick>` L261 | ~5 — `marginLeft:"auto"` L403; `textAlign:"right"` L454/458/461/473 (numeric) | P3 |
| **boq/boq-archive.tsx** | `<span onClick>` L303; icon-only `<Btn icon="copy"/>` L370; raw `<input>` ×3 | ~3 — `marginRight:8` L359; `textAlign:"right"` L326/366 | P2 |
| **boq/aiqto.tsx** | `<tr onClick>` row L792 (row-click); `<span onClick=stopProp>` L502/507 (benign); icon-only btns L558/839; inline `<input>` textAlign right L812 | ~5 — `marginLeft:"auto"` L668/755/972(marginLeft:8); `textAlign:"right"` L806/812 | P2 |
| **boq/new-boq-form.tsx** | `<div onClick>` L298; 13 raw `<input>` unlabelled (largest form) | ~1 — `marginLeft:"auto"` L432 | **P1** (label) |
| **dashboard/dashboard.tsx** | controls are `<Btn>`/`<TopBar>` — ok | ~1 — `marginLeft:8` L370 | P3 |
| **gr/gr-list.tsx** | `<tr onClick>` row L466 (row-click) | ~5 — `marginRight:5` L482; `marginLeft:"auto"` L593; `textAlign:"right"` L504/633/634 | P2 |
| **gr/gr-create-form.tsx** | raw `<label>` L192/271 unassociated; 10 raw `<input>` | ~3 — `textAlign:"right"` L303/304/316 | P2 |
| **pr/pr-list.tsx** | `<tr onClick>` row L541; `<td onClick=stopProp>` L544/580 (benign); 5 raw `<input>` | ~3 — `marginLeft` L225/490; `textAlign:"right"` L563 | P2 |
| **po-wo/po-list.tsx** | `<tr onClick>` row L425; icon-only `<Btn icon="print"/>` L589 | ~2 — `marginLeft:"auto"` L594; `textAlign:"right"` L441 | P2 |
| **po-wo/wo-list.tsx** | `<tr onClick>` row L420 | ~3 — `marginLeft:"auto"` L531; `textAlign:"right"` L434/440 | P2 |
| **po-wo/po-create-form.tsx** | raw `<label>` L132 unassociated; 6 raw `<input>` | 0 | P2 (label) |
| **po-wo/wo-create-form.tsx** | raw `<label>` L145 unassociated; 8 raw `<input>` | 0 | P2 (label) |
| **master/master-company.tsx** | tree-row menu items `<div onClick>` L302/320/339; backdrop L284; icon-only more-btn L264; tree indent by `marginLeft:r.level*28` (RTL-wrong) | ~4 — `marginLeft` L193(indent)/244/256; `right:0` L291 | **P1** (nav tree) |
| **master/master-project.tsx** | `<div onClick>` L127(backdrop)/145; icon-only edit `<Btn/>` L400; `textAlign:"left"` on flex label L108 | ~2 — `left:0` L132; `textAlign:"left"` L108 | P2 |
| **master/master-vendor.tsx** | menu items `<div onClick>` L527/544; backdrop L509; icon-only more-btn L489; base `textAlign:"left"` L61 | ~6 — `marginLeft` L382/399; `right:8` L516; `textAlign:"left"` L61; `textAlign:"right"` L445/478 | P2 |
| **master/master-cc.tsx** | controls `<Btn>` — ok; base `textAlign:"left"` L50 | ~4 — `textAlign:"left"` L50; `textAlign:"right"` L161/175/201 | P3 |
| **master/master-model.tsx** | icon-only edit `<Btn/>` L237 | ~3 — `marginLeft:"auto"` L241; `right:10` L164; `left:10` L180 | P2 |
| **master/master-docnum.tsx** | icon-only raw btn L170; base `textAlign:"left"` L56 | ~1 — `textAlign:"left"` L56 | P3 |
| **master/master-project-type.tsx** | controls `<Page>`/`<Btn>` — ok | 0 | P3 |
| **master/users-permissions.tsx** | `<div onClick>` L232 (perm toggle?); base `textAlign:"left"` L69; `marginRight:4` icon L380 | ~2 — `textAlign:"left"` L69; `marginRight:4` L380 | P2 |
| **master/user-add-form.tsx** | 8 raw `<input>` unlabelled | ~1 — `marginLeft` L236 | P2 (label) |
| **master/role-add-form.tsx** | 4 raw `<input>`; base `textAlign:"left"` L62 | ~1 — `textAlign:"left"` L62 | P2 (label) |
| **master/{cc,block,model,org,vendor}-add-form.tsx** | 5–9 raw `<input>` each, all unlabelled (`htmlFor=0`) | mostly 0 | P2 (label) |
| **login/login-screen.tsx** | raw `<label>` L212 unassociated; 3 raw `<input>` | ~1 — `left:"50%"` L262 (centering transform — benign) | P2 (label) |
| **login/forgot-form.tsx** | 1 raw `<input>` unlabelled | 0 | P2 (label) |

### Shell (in scope)

| Shell file | A11y issues (file:line) | RTL physical-CSS | Priority |
|---|---|---:|---|
| **shell/sidebar.tsx** | **entire nav is `<div onClick>`**: NavRow L295, sub-item L328, user/settings trigger L245 — nav not keyboard-reachable | ~1 — `paddingLeft:30` L322 (sub-nav indent, RTL-wrong) | **P1** |
| **shell/topbar.tsx** | breadcrumb chevron already `dir`-aware (good); triggers live in switcher components | 0 | — |
| **shell/company-switcher.tsx** | trigger `<div onClick>` L111; `textAlign:"left"` L203 | ~4 — `pos.left` useState (runtime anchor, RTL-wrong); `textAlign:"left"` L203 | P2 |
| **shell/project-switcher.tsx** | trigger `<div onClick>` L133; item `<div onClick>` L179; `textAlign:"left"` L268 | ~6 — `paddingLeft:32` L173; `marginLeft:2` L279; `textAlign:"left"` L268; `pos.left` runtime | P2 |
| **shell/language-switcher.tsx** | trigger `<div onClick>` L101 | ~3 — `pos.left` useState runtime anchor | P2 |
| **shell/notifications.tsx** | trigger `<div onClick>` L93; item control | ~4 — `right:6` L162; `pos.right` runtime | P2 |
| **shell/user-menu.tsx** | menu item `<div onClick>` L58 | ~3 — `pos.left/bottom` runtime anchor | P2 |
| **shell/search-palette.tsx** | backdrop L71; inner stopProp L85; **result items `<div onClick>` L115**; `<input>` L102 has only placeholder (no `aria-label`); no `role="dialog"` | 0 | P2 |
| **shell/modal-host.tsx** | footer buttons are `<Btn>` — ok | ~1 — `marginLeft:"auto"` L30 | P3 |
| **shell/toast-host.tsx** | **no `aria-live`** — toasts not announced to SR | ~1 — `left:"50%"` (centering, benign) | P2 |
| **shell/app-shell.tsx** | sets `dir` (good); icon-only raw btn L100 | ~2 — `marginLeft:"auto"` L91; `right:16` L106 | P2 |
| **shell/tweaks-popover.tsx** | icon-only raw btn L117 | ~1 — `right:16` L95 | P3 |

### UI primitives (in scope — see §4 for the shared-fix specs)

| Primitive | A11y issues | RTL |
|---|---|---|
| **ui/button.tsx** (`Btn`) | renders real `<button type>` ✅ — BUT no way to give an icon-only button an accessible name (no `aria-label` prop) | — |
| **ui/field.tsx** (`Field`) | renders `<label>` but children (the input) are a **sibling, not nested and no `htmlFor`/`id`** → label NOT associated. Root cause of `htmlFor=0`. | `marginBottom` only (logical-safe) |
| **ui/modal.tsx** (`Modal`) | Escape + backdrop close ✅ — BUT no `role="dialog"`, no `aria-modal`, no `aria-labelledby`, **no focus trap, no initial focus**; close btn L126 icon-only no `aria-label` | `inset:0` (logical-safe) |
| **ui/icon.tsx** (`Icon`) | `aria-hidden="true"` on every svg ✅ (correct — icons are decorative) | — |
| **ui/date-picker.tsx** | the only file with `aria-label` (×4) ✅; check calendar grid roles | 3 — `pos.right` useState runtime anchor | 
| **ui/card.tsx / avatar.tsx / kbd.tsx / range-switch.tsx / chart.tsx** | presentational; verify any `onClick` cards get button semantics | low |

---

## 3. RTL detail — the exact conversions

Physical → logical (all pixel-identical in LTR, so visual gate stays green):

| Physical (found) | Logical replacement | Count | Priority |
|---|---|---:|---|
| `marginLeft: X` / `marginRight: X` | `marginInlineStart` / `marginInlineEnd` | 33 | P2 (high-confidence) |
| `marginLeft: "auto"` (flex spacer → pushes toolbar right) | `marginInlineStart: "auto"` | ~16 of the 33 | P2 |
| `paddingLeft` / `paddingRight` | `paddingInlineStart` / `paddingInlineEnd` | 4 | P2 (incl. tree/nav indents — clearly wrong in RTL) |
| `textAlign: "left"` | `textAlign: "start"` | 11 | **P2 (high-confidence, clearly wrong in RTL)** |
| `textAlign: "right"` (numeric `className="num"` cells) | `textAlign: "end"` | 39 | P3 (borderline — Arabic numeric-column convention varies; convert for consistency but lower urgency) |
| static `left: X` / `right: X` on absolute dropdowns/badges | `insetInlineStart` / `insetInlineEnd` | ~12 | P2 (dropdowns anchor to wrong side in RTL) |
| `pos:{left/right}` from `getBoundingClientRect()` in switchers/popovers/date-picker | compute anchor from `dir` (measure inline-start vs -end) | ~6 components | P3 (runtime, separate fix class — note, not in the 99 line count) |

**Tree/nav indentation is the sharpest RTL bug:** `master-company.tsx:193 marginLeft: r.level*28`, `sidebar.tsx:322 paddingLeft:30`, `project-switcher.tsx:173 paddingLeft:32` — in `ar` the hierarchy indents from the *left* (wrong edge). Convert to `marginInlineStart`/`paddingInlineStart`.

---

## 4. Shared-primitive recommendations (one fix → many screens) — spec for orch-A

These are the highest-leverage fixes. Fix the primitive/shell once instead of touching 20 screens.

### FIX-1 (P1, highest leverage) — `ui/field.tsx`: associate label with control
`Field` renders `<label>{label}</label>` then `{children}` as a sibling with no `htmlFor`. Result: **0 associated labels app-wide**, and screen readers announce every input as unlabelled. Every `master/*-add-form.tsx`, `*-create-form.tsx`, login, gr/pr/po/wo forms rely on this.
- **Spec:** generate an `id` (e.g. `useId()`), put `htmlFor={id}` on `<label>`, and inject `id` into the child control (clone or expose an `id`/`controlId` prop). No visual change. This single fix labels the majority of forms.
- **Caveat:** some forms pass raw `<input>` outside `Field` (e.g. `new-boq-form.tsx` 13 inputs, `boq-editor.tsx` 11, `gr-create-form.tsx` raw `<label>` L192/271, login L212). Those need per-form `htmlFor`/`id` or migration to `Field`.

### FIX-2 (P1) — `shell/sidebar.tsx` + topbar switchers: make chrome keyboard-operable
The whole primary navigation and topbar controls are `<div onClick>`. Convert the NavRow (L295), sub-item (L328), avatar/settings trigger (L245), and the switcher/notifications/user-menu triggers (`company-switcher` L111, `project-switcher` L133/179, `language-switcher` L101, `notifications` L93, `user-menu` L58) to `<button>` (unstyled reset: `background:none;border:0;padding:0;font:inherit;cursor:pointer;text-align:inherit` + existing style) — or add `role="button" tabIndex={0} onKeyDown` (Enter/Space). Pixel-identical, but Tab/Enter now work. Add `aria-expanded` to disclosure triggers.

### FIX-3 (P1) — `ui/modal.tsx`: dialog semantics + focus trap
Add `role="dialog"` + `aria-modal="true"` to the inner panel, `aria-labelledby` tied to the title, move focus into the modal on open, trap Tab within it, and restore focus on close. Also give the close button (L126) an `aria-label` (e.g. `t("common.close")`). One fix covers every modal (`modal-host`, all add/create forms rendered inside `Modal`).

### FIX-4 (P2, wide) — `ui/button.tsx` (`Btn`): accessible name for icon-only buttons
Add an optional `label`/`aria-label` prop and apply it to the `<button>`. Then the 4 self-closing `<Btn icon=… />` (master-model L237, po-list L589, master-project L400, boq-archive L370) get names. Consider dev-warning when `icon` is set with no `children` and no `label`. Also fix the 12 raw icon-only `<button>`s (aiqto L558/839, boq-editor L396/1056/1094, boq-list L458, master-company L264, master-docnum L170, master-vendor L489, app-shell L100, tweaks-popover L117, modal close L126) — prefer migrating them to `Btn` with a `label`.

### FIX-5 (P2) — shared dropdown-menu component
The identical menu pattern (`<div onClick>` items inside an absolutely-positioned panel with an `inset:0` backdrop) repeats in boq-list, boq-editor, master-company, master-vendor, user-menu, search-palette results. Extract a `Menu`/`MenuItem` primitive with `role="menu"`/`role="menuitem"`, `tabIndex`, arrow-key navigation, Escape-to-close, and `insetInlineEnd` (RTL) anchoring. Fixes keyboard operability + RTL positioning for ~6 screens at once.

### FIX-6 (P2) — table semantics + row-click keyboard
`<th scope>` is 0 everywhere and 5 list screens use `<tr onClick>` (aiqto L792, gr-list L466, po-list L425, wo-list L420, pr-list L541). Add `scope="col"` to header cells (shared table header helper if one exists) and give clickable rows keyboard access — simplest: put the primary action in a real `<button>`/link within the row (the row's first cell) rather than the whole `<tr>`, or add `tabIndex={0}`+`onKeyDown`+`role`. Keep the `<td onClick=stopProp>` cells (pr-list L544/580) as-is (benign).

### FIX-7 (P2) — `shell/toast-host.tsx`: live region
Wrap the toast container in `aria-live="polite"` (or `role="status"`) so toasts are announced. One-line, one place.

### FIX-8 (P2) — global physical→logical CSS sweep
Mechanical find/replace across screens+shell (see §3 table). Safe in LTR (visual gate green), fixes RTL. Do `textAlign:"left"→"start"` (11) and margin/padding→inline (37) and static positioning→inset-inline (~12) first (high-confidence); treat numeric-column `textAlign:"right"→"end"` (39) as a lower-priority consistency pass. Consider a lint rule (`no-restricted-syntax` on physical props) to prevent regressions in future ports.

---

## 5. Backdrop / benign notes (do not over-fix)
- `stopPropagation`-only handlers (aiqto span L502/507, pr-list td L544/580, modal inner L73, search-palette inner L85) are correct as-is — not interactive controls.
- `inset:0` backdrop overlays that dismiss menus (boq-editor L416/1126, boq-list L479, master-company L284, master-project L127, master-vendor L509) are acceptable, but the ad-hoc ones lack an Escape handler — folding them into the shared `Menu` (FIX-5) gives them Escape for free. `Modal` (L58) and `search-palette` (L71) backdrops already pair with Escape / focus.
