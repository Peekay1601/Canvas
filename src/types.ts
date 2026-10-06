// The snapshot returned by the connector's production_canvas tool (seedance/canvas.py).

export type AssetKind = "characters" | "locations" | "costumes" | "props";

export interface Asset {
  id: string;
  name: string;
  description?: string | null;
  status: string; // needed | ready
  image?: string | null; // path under assets/
  units: string[]; // unit codes it appears in
  character_id?: string | null;
}

export type Stage =
  | "script" | "assets" | "images" | "shots" | "prompts" | "queue" | "generating" | "review" | "export";

export interface Unit {
  code: string;
  number: number;
  title: string | null;
  summary?: string | null;
  has_script: boolean;
  assets_needed: number;
  shots: number;
  seconds: number;
  by_status: Record<string, number>;
  stage: Stage;
  next: string | null;
}

export interface Snapshot {
  project: {
    name: string; title: string; type?: string | null; unit_kind?: string | null;
    ratio?: string | null; resolution?: string | null; look?: string | null;
  };
  bible: string[];
  assets: Record<AssetKind, Asset[]>;
  units: Unit[];
  generations: number;
}

// The pipeline from the connector's workflows: start_project -> prepare_assets -> prepare_unit -> queue -> review -> export
export const STEPS = ["Script", "Assets", "Shots", "Prompts", "Generate", "Review", "Export"] as const;

export const STAGE_STEP: Record<Stage, number> = {
  script: 0, assets: 1, images: 1, shots: 2, prompts: 3, queue: 4, generating: 4, review: 5, export: 6,
};

export const STAGE_LABEL: Record<Stage, string> = {
  script: "Needs script", assets: "Needs assets", images: "Waiting for images", shots: "Needs shots",
  prompts: "Writing prompts", queue: "Ready to queue", generating: "Generating", review: "In review",
  export: "Ready to export",
};
