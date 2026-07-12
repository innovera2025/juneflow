// Minimal ambient declaration for js-yaml (no @types/js-yaml in the offline store).
// Only the surface used by the contract engine is declared.
declare module 'js-yaml' {
  export function load(input: string): unknown;
}
