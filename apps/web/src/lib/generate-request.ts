/** What the app sends to `useStudioPlanStore().startGeneration`; the store maps it to the wire GenerateRequest. */

export type GenerateInputKind = "image" | "text" | "image_and_text";

export interface GenerateRequirements {
  /** `null` means no hard budget, not zero. */
  max_budget: number | null;
  currency: string;
  /** Longest side in mm the user stated; omitted or null means no limit. */
  max_length_mm?: number | null;
}

/** `POST /api/projects/generate` request body. */
export interface GenerateRequest {
  intent_id?: string;
  interpretation_choice?: "as_interpreted" | "closest_supported_rover" | "concept_model";
  input: {
    kind: GenerateInputKind;
    image_asset_id: string | null;
    user_text: string | null;
  };
  requirements: GenerateRequirements;
}
