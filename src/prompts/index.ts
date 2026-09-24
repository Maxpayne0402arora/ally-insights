import { TOP3_EDITS_SYSTEM_PROMPT } from "./top3Edits";
import { TOP3_EDITS_SYSTEM_PROMPT_V2 } from "./top3Edits_v2";

export type PromptVersion = { version: string; system: string; notes: string };

/** Prompt registry. Add new versions (v2, …) as new files — never edit v1. */
export const PROMPTS: Record<string, PromptVersion> = {
  v1: { version: "v1", system: TOP3_EDITS_SYSTEM_PROMPT, notes: "Initial prompt" },
  v2: { version: "v2", system: TOP3_EDITS_SYSTEM_PROMPT_V2, notes: "Context check for interpretation findings; fuller descriptions with placeholders" },
};

/** Version used by the review flow. */
export const CURRENT_PROMPT_VERSION = "v1";

export const currentPrompt = () => PROMPTS[CURRENT_PROMPT_VERSION]!;
