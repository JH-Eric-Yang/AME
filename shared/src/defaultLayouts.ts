import type { RoutineType, RoutineLayout } from "./types.js";

const DefaultLayouts: Record<RoutineType, RoutineLayout> = {
  "routine-borderless": {
    rows: [{ columns: [{ span: 12 }] }],
  },
  "routine-card": {
    rows: [{ columns: [{ span: 8 }], justify: "center" }],
  },
  "routine-consent": {
    rows: [
      { columns: [{ span: 12 }] },
      { columns: [{ span: 6 }, { span: 6 }] },
    ],
  },
  "routine-end": {
    rows: [{ columns: [{ span: 8 }], justify: "center" }],
  },
  "routine-end-matching": {
    rows: [{ columns: [{ span: 8 }], justify: "center" }],
  },
  "routine-matching": {
    rows: [{ columns: [{ span: 8 }], justify: "center" }],
  },
  "routine-pos-check": {
    rows: [
      { columns: [{ span: 6 }, { span: 6 }] },
      { columns: [{ span: 12 }] },
    ],
  },
  "routine-video-chat": {
    rows: [{ columns: [{ span: 6 }, { span: 6 }] }],
  },
  "routine-survey": {
    rows: [{ columns: [{ span: 8 }], justify: "center" }],
  },
};

export function getDefaultLayout(type: RoutineType): RoutineLayout {
  return structuredClone(DefaultLayouts[type]);
}
