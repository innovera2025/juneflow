import { aggregate } from "./report";

// globalTeardown — consolidate all worker part files into one readable diff
// report after the run (P0-QA-04). Prints the report paths so "รายงาน diff
// อ่านได้" is discoverable from the Playwright run output.
export default function globalTeardown(): void {
  const { mdPath, jsonPath } = aggregate();
  console.log(`\n[visual-gate] report: ${mdPath}\n[visual-gate] json:   ${jsonPath}`);
}
