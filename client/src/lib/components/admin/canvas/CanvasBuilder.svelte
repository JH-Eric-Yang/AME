<script lang="ts">
  import { experiment, selectedElement } from "$lib/stores/experiment";
  import { findOwningDesign } from "ame-shared/blockOwnership";
  import { getDefaultLayout } from "ame-shared/defaultLayouts";
  import { canRenderOnHandset } from "ame-shared/surfaces";
  import {
    clampPlacement,
    neighbourPlacements,
    firstOverlap,
    conformTarget,
    hasIntrinsicSize,
    stageSize,
    DefaultFreePlacement,
  } from "ame-shared/layout";
  import type { RoutineType, ElementType, GridRow, ElementConfig, FreePlacement } from "ame-shared";
  import { audienceTabs, elementsForAudience, roleAudienceFor } from "$lib/admin/surfaceAxis";
  import { naturalSizes, measureNaturalSize, mediaUrl } from "$lib/admin/naturalSize";
  import { createConformGuard } from "$lib/admin/conformGuard";
  import { resolveRoutineSelection } from "$lib/admin/routineSelection";
  import { splitRowColumns, removeColumn } from "$lib/admin/rowSplit";
  import ElementPalette from "./ElementPalette.svelte";
  import CanvasToolbar from "./CanvasToolbar.svelte";
  import CanvasGrid from "./CanvasGrid.svelte";
  import Inspector from "./Inspector.svelte";
  import RoutineInspector from "./RoutineInspector.svelte";

  const RoutineTypes: { value: RoutineType; label: string }[] = [
    { value: "routine-borderless", label: "Borderless" },
    { value: "routine-card", label: "Card" },
    { value: "routine-consent", label: "Consent" },
    { value: "routine-end", label: "End" },
    { value: "routine-matching", label: "Matching" },
    { value: "routine-end-matching", label: "End Matching" },
    { value: "routine-pos-check", label: "Position Check" },
    { value: "routine-video-chat", label: "Video Chat" },
    { value: "routine-survey", label: "Survey" },
  ];

  let newRoutineName = $state("");
  let newRoutineType: RoutineType = $state("routine-card");
  let showAddRoutine = $state(false);

  const ri = $derived($experiment.selectedRoutineIndex);
  const ei = $derived($experiment.selectedElementIndex);
  const routine = $derived(ri !== null ? $experiment.routines[ri] : null);
  const elements = $derived(routine?.elements ?? []);
  const sessionDesigns = $derived($experiment.sessionDesigns);

  // "Screen for" audience: which role (or the phone) the canvas previews.
  // The device is one more audience, not a separate authoring surface — one
  // routine holds every screen it produces.
  let audience = $state("All");
  const tabs = $derived(audienceTabs(routine?.roles ?? [], Boolean(routine?.device?.mode)));
  const currentTab = $derived(
    tabs.find((t) => t.label === audience) ?? { label: "All", surface: "screen" as const },
  );
  const surface = $derived(currentTab.surface);
  // The ROLE audience a tab implies — the Device tab is a surface, not a
  // role, so it means "every role's phone elements", not showForRoles: ["Device"].
  const roleAudience = $derived(roleAudienceFor(currentTab));
  const visibleElements = $derived(elementsForAudience(elements, roleAudience, surface));
  const hiddenElementNames = $derived(
    elements.filter((el) => !visibleElements.includes(el)).map((el) => el.name),
  );

  // A stale audience (e.g. a role from the previous routine) would leave the
  // tab bar with no active tab, so reset it whenever the selected routine changes.
  $effect(() => {
    ri;
    audience = "All";
  });

  // The canvas needs a routine to draw. The store opens at null and
  // removeRoutine() returns it to null, so without this the Builder tab lands
  // on its empty state and a deletion strands the researcher there.
  $effect(() => {
    const want = resolveRoutineSelection($experiment.routines.length, ri);
    if (want !== ri) experiment.selectRoutine(want);
  });

  function addRoutine() {
    if (!newRoutineName) return;
    experiment.addRoutine({
      name: newRoutineName,
      type: newRoutineType,
      layout: getDefaultLayout(newRoutineType),
      elements: [],
    });
    newRoutineName = "";
    showAddRoutine = false;
  }

  function handleAddRow() {
    if (ri === null) return;
    experiment.addRow(ri, { columns: [{ span: 12 }] });
  }

  function handleRemoveRow(rowIndex: number) {
    if (ri === null) return;
    const hasElements = elements.some((el) => el.position?.row === rowIndex);
    if (hasElements && !confirm("This row has elements. Remove anyway? Elements will lose their position.")) return;
    elements.forEach((el, elIdx) => {
      if (el.position?.row === rowIndex) {
        experiment.updateElement(ri, elIdx, { position: undefined });
      } else if (el.position && el.position.row > rowIndex) {
        experiment.moveElement(ri, elIdx, { ...el.position, row: el.position.row - 1 });
      }
    });
    experiment.removeRow(ri, rowIndex);
  }

  function handleUpdateRow(rowIndex: number, row: Partial<GridRow>) {
    if (ri === null) return;
    experiment.updateRow(ri, rowIndex, row);
  }

  // Reuses the same store call CanvasToolbar's column-span input goes
  // through, so the inline "+ Column" control and the toolbar can never
  // disagree about a row's layout.
  function handleSplitRow(rowIndex: number) {
    if (ri === null || !routine) return;
    const row = routine.layout.rows[rowIndex];
    if (!row) return;
    handleUpdateRow(rowIndex, { columns: splitRowColumns(row) });
  }

  // One store write for the row and the elements, so the canvas never renders
  // an element pointing at a column that no longer exists.
  function handleRemoveColumn(rowIndex: number, colIndex: number) {
    if (!routine) return;
    const row = routine.layout.rows[rowIndex];
    if (!row) return;
    const removal = removeColumn(row, rowIndex, colIndex, routine.elements);
    const rows = routine.layout.rows.map((r, i) => (i === rowIndex ? { ...r, columns: removal.columns } : r));
    experiment.patchRoutineByName(routine.name, { layout: { ...routine.layout, rows }, elements: removal.elements });
  }

  // A palette (or element) drag released on the "+ Row" tail: create the
  // row, then place the drop into its one column, via the existing
  // add-row/drop paths rather than a second implementation of either.
  function handleDropOnTail(dataStr: string) {
    if (ri === null || !routine) return;
    const newRowIndex = routine.layout.rows.length;
    handleAddRow();
    handleDrop(newRowIndex, 0, dataStr);
  }

  function handleDrop(rowIndex: number, colIndex: number, dataStr: string) {
    if (ri === null) return;
    try {
      const data = JSON.parse(dataStr);
      if (data.action === "new") {
        const elementType = data.elementType as ElementType;
        if (surface === "device" && !canRenderOnHandset(elementType)) return;
        const existingInCell = elements.filter(
          (el) => el.position?.row === rowIndex && el.position?.column === colIndex,
        );
        const newElement: ElementConfig = {
          name: `${data.elementType}-${elements.length + 1}`,
          type: elementType,
          params: {},
          position: { row: rowIndex, column: colIndex, order: existingInCell.length },
          showForRoles: roleAudience === "All" ? undefined : [roleAudience],
          surface: surface === "screen" ? undefined : surface,
        };
        experiment.addElement(ri, newElement);
      } else if (data.action === "move") {
        const existingInTarget = elements.filter(
          (el) => el.position?.row === rowIndex && el.position?.column === colIndex,
        );
        experiment.moveElement(ri, data.elementIndex, {
          row: rowIndex,
          column: colIndex,
          order: existingInTarget.length,
        });
      }
    } catch {
      // Ignore invalid drop data
    }
  }

  /**
   * The placements a free-mode drop or edit has to stay clear of, narrowed to
   * the audience the canvas is currently showing — the same set FreeCanvas's
   * drag collides against, so no two authoring paths disagree about what is
   * legal. `null` means nothing is being placed yet: a fresh palette drop.
   */
  function freeNeighbours(selfIndex: number | null) {
    return neighbourPlacements(
      elements,
      selfIndex,
      (el) => !hiddenElementNames.includes(el.name),
    );
  }

  /**
   * The stage an intrinsic ratio is measured against, or null when there is
   * none to measure against.
   *
   * A placement is stored in percentages of this box, so without its pixel
   * size a media ratio cannot be turned into one — which is why a fluid stage
   * simply leaves every box as authored.
   */
  const freeStage = $derived(
    routine && (routine.layout.mode ?? "flow") === "free" && routine.layout.stage &&
      routine.layout.stage !== "fluid"
      ? stageSize(routine.layout.stage)
      : null,
  );

  // Ask the browser for the true size of every medium on a free stage. The
  // measurement is cached by URL and never repeated, including for media that
  // fails to load, so this may run on every render.
  $effect(() => {
    if (!freeStage) return;
    for (const el of elements) {
      if (!hasIntrinsicSize(el.type)) continue;
      const url = mediaUrl(el);
      if (url) measureNaturalSize(url, el.type === "video" ? "video" : "image");
    }
  });

  /** See conformGuard: the belt to `conformTarget`'s braces. */
  const conformGuard = createConformGuard();

  /**
   * Give every locked box its media's real shape.
   *
   * This is what "lock aspect ratio" means, so it is applied rather than
   * offered: a box that keeps its media's ratio while showing a different one
   * is not locked to anything. The width the researcher chose is kept and the
   * height derived from it (see `conformPlacement`).
   *
   * A conform that would land on a neighbour is DECLINED and the box left as
   * authored, exactly as a drag released on a neighbour is declined and a
   * typed value that would overlap is refused. No-overlap is the invariant
   * that lets free placement have no z-order at all, and it is enforced at
   * authoring time only, so a path that wrote without asking would break it
   * with nothing downstream to catch it. The Inspector says so when it happens.
   *
   * Only elements the canvas is currently showing are conformed, because those
   * are the ones whose neighbours `freeNeighbours` knows about — an element on
   * another audience tab is conformed when that tab is open.
   */
  $effect(() => {
    const sizes = $naturalSizes;
    const stage = freeStage;
    if (ri === null || !stage) return;
    elements.forEach((el, index) => {
      if (hiddenElementNames.includes(el.name)) return;
      const url = mediaUrl(el);
      const target = conformTarget(el, url ? sizes[url] : null, stage);
      if (!target) return;
      if (!conformGuard.claim(el.name, el.placement, target)) return;
      if (firstOverlap(target, freeNeighbours(index))) return;
      experiment.updateElement(ri, index, { placement: target });
    });
  });

  // Free mode's counterpart to handleDrop: a palette or "not placed" strip
  // item released on the stage, at the stage % the pointer landed on rather
  // than a row/column cell. New elements get a default footprint centred on
  // the drop point; moved elements keep the footprint they already had.
  //
  // Overlap is forbidden (§6.1), and enforcement is authoring-time only, so a
  // drop that clamps and commits without checking breaks the invariant with
  // nothing downstream to catch it. A new element released on an occupied spot
  // is added with NO placement, so it appears in the "Not placed" strip rather
  // than being stacked or silently discarded; a move onto an occupied spot is
  // declined and the element stays where it was, which is exactly what the
  // drag does when it is released invalid.
  function handleFreeDrop(xPct: number, yPct: number, dataStr: string) {
    if (ri === null) return;
    try {
      const data = JSON.parse(dataStr);
      if (data.action === "new") {
        const elementType = data.elementType as ElementType;
        if (surface === "device" && !canRenderOnHandset(elementType)) return;
        const { wPct, hPct } = DefaultFreePlacement;
        const placement = clampPlacement({
          xPct: xPct - wPct / 2,
          yPct: yPct - hPct / 2,
          wPct,
          hPct,
        });
        const blocked = firstOverlap(placement, freeNeighbours(null)) !== null;
        const newElement: ElementConfig = {
          name: `${data.elementType}-${elements.length + 1}`,
          type: elementType,
          params: {},
          placement: blocked ? undefined : placement,
          showForRoles: roleAudience === "All" ? undefined : [roleAudience],
          surface: surface === "screen" ? undefined : surface,
        };
        experiment.addElement(ri, newElement);
      } else if (data.action === "move") {
        const existing = elements[data.elementIndex]?.placement;
        const wPct = existing?.wPct ?? DefaultFreePlacement.wPct;
        const hPct = existing?.hPct ?? DefaultFreePlacement.hPct;
        const placement = clampPlacement({
          xPct: xPct - wPct / 2,
          yPct: yPct - hPct / 2,
          wPct,
          hPct,
        });
        if (firstOverlap(placement, freeNeighbours(data.elementIndex))) return;
        experiment.updateElement(ri, data.elementIndex, { placement });
      }
    } catch {
      // Ignore invalid drop data
    }
  }

  function handleUpdatePlacement(elementIndex: number, placement: FreePlacement) {
    if (ri === null) return;
    experiment.updateElement(ri, elementIndex, { placement });
  }

  function handleSelectElement(elementIndex: number) {
    if (ri !== null) {
      experiment.selectElement(ri, elementIndex);
    }
  }

  function handleRemoveElement(elementIndex: number) {
    if (ri !== null) {
      experiment.removeElement(ri, elementIndex);
    }
  }
</script>

<div class="canvas-builder">
  <!-- Left Panel: Tree + Palette -->
  <div class="left-panel">
    <div class="tree-section">
      <div class="tree-header">
        <span class="tree-title">Routines</span>
        <button class="btn-add" onclick={() => (showAddRoutine = true)}>+</button>
      </div>

      {#each $experiment.routines as r, rIdx}
        <div class="tree-item">
          <button
            class="tree-node"
            class:selected={ri === rIdx}
            onclick={() => experiment.selectRoutine(rIdx)}
          >
            <span>{r.name}</span>
            <span class="type-badge">{r.type.replace("routine-", "")}</span>
            {#if findOwningDesign(r.name, sessionDesigns)}
              <span class="block-badge" title="Compiled by a session block — see the Session tab">block</span>
            {/if}
          </button>

        </div>
      {/each}

      {#if showAddRoutine}
        <div class="add-form">
          <input type="text" bind:value={newRoutineName} placeholder="Routine name" />
          <select bind:value={newRoutineType}>
            {#each RoutineTypes as rt}
              <option value={rt.value}>{rt.label}</option>
            {/each}
          </select>
          <div class="add-actions">
            <button onclick={addRoutine}>Add</button>
            <button onclick={() => (showAddRoutine = false)}>Cancel</button>
          </div>
        </div>
      {/if}
    </div>

    <div class="palette-section">
      <ElementPalette {surface} />
    </div>
  </div>

  <!-- Center Panel: Canvas -->
  <div class="center-panel">
    {#if routine && routine.layout}
      <div class="audience-bar">
        {#each tabs as t}
          <button
            type="button"
            class="audience-tab"
            class:active={audience === t.label}
            onclick={() => (audience = t.label)}
          >
            {t.label}
            <span class="audience-count">{elementsForAudience(elements, roleAudienceFor(t), t.surface).length}</span>
          </button>
        {/each}
      </div>
      <CanvasToolbar
        layout={routine.layout}
        onaddrow={handleAddRow}
        onremoverow={handleRemoveRow}
        onupdaterow={handleUpdateRow}
      />
      <CanvasGrid
        layout={routine.layout}
        routineType={routine.type}
        routineConfig={routine.config}
        {elements}
        {hiddenElementNames}
        selectedElementIndex={ei}
        onselectelement={handleSelectElement}
        onremoveelement={handleRemoveElement}
        ondrop={handleDrop}
        onaddrow={handleAddRow}
        onsplitrow={handleSplitRow}
        onremovecolumn={handleRemoveColumn}
        ontaildrop={handleDropOnTail}
        onfreedrop={handleFreeDrop}
        onupdateplacement={handleUpdatePlacement}
      />
    {:else}
      <div class="empty-canvas">
        <p class="muted">Select a routine to view its canvas.</p>
      </div>
    {/if}
  </div>

  <!-- Right Panel: Inspector -->
  <div class="right-panel">
    {#if $selectedElement && ri !== null && ei !== null && routine}
      <Inspector
        element={$selectedElement}
        {routine}
        {hiddenElementNames}
        routineIndex={ri}
        elementIndex={ei}
      />
    {:else if routine && ri !== null}
      <RoutineInspector {routine} routineIndex={ri} />
    {:else}
      <div class="empty-inspector">
        <p class="muted">Select a routine or element to edit.</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .canvas-builder { display: flex; height: 100%; min-height: 500px; }

  .left-panel { width: 20%; min-width: 180px; border-right: 1px solid var(--gray-200); display: flex; flex-direction: column; overflow-y: auto; }
  .tree-section { padding: 0.75rem; border-bottom: 1px solid var(--gray-200); }
  .palette-section { flex: 1; overflow-y: auto; }

  .tree-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
  .tree-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--gray-600); }

  .tree-node { display: flex; align-items: center; gap: 0.35rem; width: 100%; padding: 0.3rem 0.5rem; border: none; background: none; cursor: pointer; font-size: 12px; text-align: left; border-radius: var(--radius-sm); }
  .tree-node:hover { background: var(--gray-50); }
  .tree-node.selected { background: var(--black); color: var(--white); }
  .tree-node.selected .type-badge { background: var(--gray-700); color: var(--gray-300); }
  .type-badge { font-size: 9px; background: var(--gray-100); padding: 1px 3px; border-radius: var(--radius-pill); color: var(--gray-600); font-family: var(--font-display); margin-left: auto; }
  .block-badge { font-size: 9px; background: var(--black); color: var(--white); padding: 1px 5px; border-radius: var(--radius-pill); font-family: var(--font-display); }
  .tree-node.selected .block-badge { background: var(--white); color: var(--black); }

  .btn-add { font-size: 12px; padding: 0 0.4rem; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); background: var(--white); cursor: pointer; }

  .add-form { padding: 0.5rem; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); margin-top: 0.5rem; }
  .add-form input, .add-form select { width: 100%; padding: 0.3rem; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); font-size: 12px; margin-bottom: 0.35rem; box-sizing: border-box; }
  .add-actions { display: flex; gap: 0.35rem; }
  .add-actions button { font-size: 11px; padding: 0.2rem 0.5rem; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); background: var(--white); cursor: pointer; }

  .center-panel { flex: 1; display: flex; flex-direction: column; overflow-y: auto; background-image: var(--dot-grid); background-size: 14px 14px; }

  .audience-bar { display: flex; gap: 0.35rem; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--gray-200); flex-wrap: wrap; background: var(--white); }
  .audience-tab { display: flex; align-items: center; gap: 0.35rem; padding: 0.25rem 0.6rem; font-size: 12px; border: 1px solid var(--gray-200); border-radius: 999px; background: var(--white); cursor: pointer; color: var(--gray-600); }
  .audience-tab:hover { border-color: var(--black); color: var(--black); }
  .audience-tab.active { background: var(--black); border-color: var(--black); color: var(--white); }
  .audience-tab.active .audience-count { background: var(--gray-700); color: var(--gray-300); }
  .audience-count { font-size: 10px; font-family: var(--font-display); background: var(--gray-100); color: var(--gray-400); border-radius: 999px; padding: 0 5px; }
  .right-panel { width: 25%; min-width: 220px; border-left: 1px solid var(--gray-200); overflow-y: auto; }

  .empty-canvas, .empty-inspector { display: flex; align-items: center; justify-content: center; height: 100%; }
  .muted { color: var(--gray-400); font-size: 13px; }
</style>
