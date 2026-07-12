import { resetResults } from "./report";

// globalSetup — clear stale visual-gate artifacts before a run so the
// consolidated report reflects only this run (P0-QA-04).
export default function globalSetup(): void {
  resetResults();
}
