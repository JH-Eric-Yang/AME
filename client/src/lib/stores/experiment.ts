import { writable, derived } from "svelte/store";
import type { RoutineConfig, ElementConfig, RoutineLayout, GridRow, RandomizationConfig } from "ame-shared";
import type { SessionDesign } from "ame-shared/sessionDesign";
import { getDefaultLayout } from "ame-shared/defaultLayouts";
import { upsertByName } from "$lib/admin/sessionDesigns";

interface ExperimentState {
  id: string;
  name: string;
  description: string;
  visible: boolean;
  allowNew: boolean;
  img: string | null;
  avCollection: boolean;
  bodyDetection: boolean;
  videoChat: boolean;
  supplementaryDevice: string;
  activeTime: number;
  rollBackTime: number;
  participantsPerSession: number;
  participantIdParam: string | null;
  conditions: string[];
  randomization: boolean;
  randomizationConfig: RandomizationConfig | null;
  matchingStrategy: string;
  initialProperties: Record<string, unknown>;
  conditionProperties: Record<string, Record<string, unknown>>;
  routines: RoutineConfig[];
  sessionDesigns: SessionDesign[];
  // Builder UI state
  selectedRoutineIndex: number | null;
  selectedElementIndex: number | null;
  dirty: boolean;
}

const DefaultState: ExperimentState = {
  id: "",
  name: "",
  description: "",
  visible: false,
  allowNew: true,
  img: null,
  avCollection: false,
  bodyDetection: false,
  videoChat: false,
  supplementaryDevice: "NONE",
  activeTime: 30,
  rollBackTime: 60,
  participantsPerSession: 1,
  participantIdParam: null,
  conditions: [],
  randomization: false,
  randomizationConfig: null,
  matchingStrategy: "FIFO",
  initialProperties: {},
  conditionProperties: {},
  routines: [],
  sessionDesigns: [],
  selectedRoutineIndex: null,
  selectedElementIndex: null,
  dirty: false,
};

function createExperimentStore() {
  const { subscribe, set, update } = writable<ExperimentState>({ ...DefaultState });

  return {
    subscribe,
    reset() {
      set({ ...DefaultState });
    },
    load(data: Record<string, unknown>) {
      update((s) => ({
        ...s,
        ...data,
        routines: ((data.routines as RoutineConfig[]) ?? []).map((r) => ({
          ...r,
          layout: r.layout ?? getDefaultLayout(r.type),
        })),
        sessionDesigns: (data.sessionDesigns as SessionDesign[]) ?? [],
        selectedRoutineIndex: null,
        selectedElementIndex: null,
        dirty: false,
      }));
    },
    setField(field: string, value: unknown) {
      update((s) => ({ ...s, [field]: value, dirty: true }));
    },
    /**
     * Record that everything in the store has been written to the server.
     *
     * The ONLY way to clear the flag: `setField` spreads a literal `dirty: true`
     * after its computed key, so `setField("dirty", false)` sets it to true.
     *
     * Call this ONLY after a save that sent every field — the header's
     * `handleSave`. A partial save (the Session Designer's apply, which PUTs
     * routines and session designs alone) must leave the flag alone, or unsaved
     * edits on another tab are hidden behind a clean header and lost.
     */
    markSaved() {
      update((s) => ({ ...s, dirty: false }));
    },
    selectRoutine(index: number | null) {
      update((s) => ({
        ...s,
        selectedRoutineIndex: index,
        selectedElementIndex: null,
      }));
    },
    selectElement(routineIndex: number, elementIndex: number | null) {
      update((s) => ({
        ...s,
        selectedRoutineIndex: routineIndex,
        selectedElementIndex: elementIndex,
      }));
    },
    addRoutine(routine: RoutineConfig) {
      update((s) => ({
        ...s,
        routines: [...s.routines, routine],
        selectedRoutineIndex: s.routines.length,
        selectedElementIndex: null,
        dirty: true,
      }));
    },
    updateRoutine(index: number, routine: Partial<RoutineConfig>) {
      update((s) => {
        const routines = [...s.routines];
        routines[index] = { ...routines[index], ...routine };
        return { ...s, routines, dirty: true };
      });
    },
    setSessionDesigns(designs: SessionDesign[]) {
      update((s) => ({ ...s, sessionDesigns: designs, dirty: true }));
    },
    upsertRoutinesByName(incoming: RoutineConfig[]) {
      update((s) => ({ ...s, routines: upsertByName(s.routines, incoming), dirty: true }));
    },
    patchRoutineByName(name: string, patch: Partial<RoutineConfig>) {
      update((s) => {
        const index = s.routines.findIndex((r) => r.name === name);
        if (index === -1) return s;
        const routines = [...s.routines];
        routines[index] = { ...routines[index], ...patch };
        return { ...s, routines, dirty: true };
      });
    },
    updateLayout(routineIndex: number, layout: RoutineLayout) {
      update((s) => {
        const routines = [...s.routines];
        routines[routineIndex] = { ...routines[routineIndex], layout };
        return { ...s, routines, dirty: true };
      });
    },
    addRow(routineIndex: number, row: GridRow) {
      update((s) => {
        const routines = [...s.routines];
        const routine = { ...routines[routineIndex] };
        routine.layout = { ...routine.layout, rows: [...routine.layout.rows, row] };
        routines[routineIndex] = routine;
        return { ...s, routines, dirty: true };
      });
    },
    removeRow(routineIndex: number, rowIndex: number) {
      update((s) => {
        const routines = [...s.routines];
        const routine = { ...routines[routineIndex] };
        routine.layout = {
          ...routine.layout,
          rows: routine.layout.rows.filter((_, i) => i !== rowIndex),
        };
        routines[routineIndex] = routine;
        return { ...s, routines, dirty: true };
      });
    },
    updateRow(routineIndex: number, rowIndex: number, row: Partial<GridRow>) {
      update((s) => {
        const routines = [...s.routines];
        const routine = { ...routines[routineIndex] };
        const rows = [...routine.layout.rows];
        rows[rowIndex] = { ...rows[rowIndex], ...row };
        routine.layout = { ...routine.layout, rows };
        routines[routineIndex] = routine;
        return { ...s, routines, dirty: true };
      });
    },
    moveElement(
      routineIndex: number,
      elementIndex: number,
      position: { row: number; column: number; order?: number },
    ) {
      update((s) => {
        const routines = [...s.routines];
        const routine = { ...routines[routineIndex] };
        const elements = [...routine.elements];
        elements[elementIndex] = { ...elements[elementIndex], position };
        routine.elements = elements;
        routines[routineIndex] = routine;
        return { ...s, routines, dirty: true };
      });
    },
    batchMoveElements(
      routineIndex: number,
      moves: Array<{ elementIndex: number; position: { row: number; column: number; order: number } }>,
    ) {
      update((s) => {
        const routines = [...s.routines];
        const routine = { ...routines[routineIndex] };
        const elements = [...routine.elements];
        for (const move of moves) {
          elements[move.elementIndex] = { ...elements[move.elementIndex], position: move.position };
        }
        routine.elements = elements;
        routines[routineIndex] = routine;
        return { ...s, routines, dirty: true };
      });
    },
    removeRoutine(index: number) {
      update((s) => {
        const routines = s.routines.filter((_, i) => i !== index);
        return {
          ...s,
          routines,
          selectedRoutineIndex: null,
          selectedElementIndex: null,
          dirty: true,
        };
      });
    },
    addElement(routineIndex: number, element: ElementConfig) {
      update((s) => {
        const routines = [...s.routines];
        const routine = { ...routines[routineIndex] };
        routine.elements = [...routine.elements, element];
        routines[routineIndex] = routine;
        return { ...s, routines, dirty: true };
      });
    },
    updateElement(routineIndex: number, elementIndex: number, element: Partial<ElementConfig>) {
      update((s) => {
        const routines = [...s.routines];
        const routine = { ...routines[routineIndex] };
        const elements = [...routine.elements];
        elements[elementIndex] = { ...elements[elementIndex], ...element };
        routine.elements = elements;
        routines[routineIndex] = routine;
        return { ...s, routines, dirty: true };
      });
    },
    removeElement(routineIndex: number, elementIndex: number) {
      update((s) => {
        const routines = [...s.routines];
        const routine = { ...routines[routineIndex] };
        routine.elements = routine.elements.filter((_, i) => i !== elementIndex);
        routines[routineIndex] = routine;
        return { ...s, routines, selectedElementIndex: null, dirty: true };
      });
    },
    addRole(routineIndex: number, roleName: string) {
      update((s) => {
        const routines = [...s.routines];
        const routine = { ...routines[routineIndex] };
        routine.roles = [...(routine.roles ?? []), roleName];
        routines[routineIndex] = routine;
        return { ...s, routines, dirty: true };
      });
    },
    removeRole(routineIndex: number, roleIndex: number) {
      update((s) => {
        const routines = [...s.routines];
        const routine = { ...routines[routineIndex] };
        const removedRole = routine.roles?.[roleIndex];
        routine.roles = (routine.roles ?? []).filter((_, i) => i !== roleIndex);
        if (removedRole) {
          routine.elements = routine.elements.map((el) => {
            if (!el.showForRoles?.includes(removedRole)) return el;
            const filtered = el.showForRoles.filter((r) => r !== removedRole);
            return { ...el, showForRoles: filtered.length > 0 ? filtered : undefined };
          });
        }
        routines[routineIndex] = routine;
        return { ...s, routines, dirty: true };
      });
    },
  };
}

export const experiment = createExperimentStore();

export const selectedRoutine = derived(experiment, ($exp) =>
  $exp.selectedRoutineIndex !== null ? $exp.routines[$exp.selectedRoutineIndex] ?? null : null,
);

export const selectedElement = derived(experiment, ($exp) => {
  if ($exp.selectedRoutineIndex === null || $exp.selectedElementIndex === null) return null;
  return $exp.routines[$exp.selectedRoutineIndex]?.elements[$exp.selectedElementIndex] ?? null;
});
