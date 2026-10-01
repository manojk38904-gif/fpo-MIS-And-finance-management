/**
 * Correction-pass item 4 — the frozen text specifies FPO-Code's PROPERTIES
 * (platform-generated, unique, immutable) and references the Master-SRS
 * Numbering Engine, but does not itself specify an algorithm, and that
 * Numbering Engine does not exist in this codebase. The previous pass's
 * initials+numeric-suffix placeholder was wrongly framed as an "Implementation
 * Detail Allowed Within Frozen Rule" — it is not: silently inventing a
 * production numbering algorithm on the Owner's behalf is exactly what that
 * framing is not supposed to permit. This port makes the boundary explicit:
 * the production binding (see NotImplementedFpoCodeGeneratorAdapter) BLOCKS
 * tenant activation outright until the real Numbering Engine exists, rather
 * than silently fabricating a code that looks plausible.
 */
export const FPO_CODE_GENERATOR_PORT = Symbol('FPO_CODE_GENERATOR_PORT');

export interface FpoCodeGeneratorPort {
  /** Returns a platform-generated, unique, immutable FPO Code for this registration. */
  generate(fpoName: string, registrationId: string): Promise<string>;
}
