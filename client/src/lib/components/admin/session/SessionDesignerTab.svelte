<script lang="ts">
  import { onMount } from "svelte";
  import type { SessionDesign } from "ame-shared/sessionDesign";
  import {
    compileSessionDesign,
    defaultSessionDesign,
    diffCompiled,
    stepsForDesign,
    validateSessionDesign,
  } from "ame-shared/sessionDesign";
  import * as api from "$lib/api";
  import { experiment } from "$lib/stores/experiment";
  import { openBlockRequest } from "$lib/stores/adminNav";
  import {
    blockIdsWithRows,
    initialApplyState,
    lastProgressOf,
    replaceDesign,
    uniqueLabel,
    upsertByName,
  } from "$lib/admin/sessionDesigns";
  import {
    applyDisplay,
    canStartApply,
    runApply,
    shouldAdoptRoutines,
    uploadOnly,
  } from "$lib/admin/applySequence";
  import { adoptDisabledReason, adoptPatch } from "$lib/admin/driftAdoption";
  import CohortPanel from "./CohortPanel.svelte";
  import RotationSchedule from "./RotationSchedule.svelte";
  import ApplyBar from "./ApplyBar.svelte";
  import DriftStrip from "./DriftStrip.svelte";

  /**
   * Where the Generate & Save sequence has got to. "routines-only" means the
   * routines were saved but the content rows were not, which is a retry, not a
   * failure to start over.
   */
  type ApplyState = "idle" | "applying" | "applied" | "routines-only";

  let {
    experimentId,
    onviewcontent,
  }: {
    experimentId: string;
    /** Switch the page to the Content tab, so a researcher can inspect the written rows. */
    onviewcontent: () => void;
  } = $props();

  let lastProgress = $state(0);
  let selectedId = $state<string | null>(null);
  let applyState = $state<ApplyState>("idle");

  /**
   * True from the moment Generate & Save starts until both writes have settled.
   * Separate from `applyState` because an edit made mid-write resets that to
   * `idle`; this is the only thing that keeps the button locked across it.
   */
  let inFlight = $state(false);

  /**
   * Ids of blocks whose content rows are on the server, seeded from the content
   * listing at mount and kept in step by each apply. Not reactive: it is read
   * only inside handlers, never from the template.
   */
  let rowBlockIds = new Set<string>();

  /**
   * The block under edit. `$state` rather than a bare `$derived` because the
   * drift-adoption path writes a new design through `updateDesign`, and a bare
   * `$derived` cannot take part in that. The effect below keeps it in step with
   * the store; it writes `selected` without reading it, so it cannot loop.
   * Nothing outside `updateDesign` may assign to it.
   *
   * `.raw` is load-bearing: a deep `$state` proxy is a Proxy exotic object, and
   * `structuredClone` refuses to serialise one. `compileSessionDesign` clones
   * the seats, the pattern and each trial's content, so a proxied design throws
   * DataCloneError out of the `compiled` derivation and the whole tab renders
   * nothing but its block switcher. Every edit replaces the design wholesale
   * through the store, so nothing here needs deep reactivity.
   */
  let selected = $state.raw<SessionDesign | null>(null);

  const designs = $derived($experiment.sessionDesigns);

  /** The block an id selects, with the same fallback the effect below applies. */
  const blockFor = (id: string | null): SessionDesign | null =>
    designs.find((d) => d.id === id) ?? designs[0] ?? null;

  $effect(() => {
    selected = blockFor(selectedId);
  });

  /** The state a block opens in — see `initialApplyState`. */
  const stateFor = (design: SessionDesign | null): ApplyState =>
    design ? initialApplyState(design, $experiment.routines, rowBlockIds) : "idle";

  /**
   * `$state.raw` above is what stops a proxy reaching `structuredClone`, but it
   * enforces that only by convention: a future `selected.cohortSize = n` would
   * both re-proxy the value and silently stop re-rendering. Snapshotting here
   * makes the compile step correct under either rune, so the guarantee does not
   * rest on remembering which one this variable uses.
   */
  const plain = $derived(selected ? $state.snapshot(selected) : null);

  /**
   * The single compile step the whole feature rests on: the rotation schedule
   * and the progress rows come out of one call, so they cannot drift apart.
   */
  const compiled = $derived(plain ? compileSessionDesign(plain) : null);
  const issues = $derived(
    plain ? validateSessionDesign(plain, $experiment.routines, $experiment.conditions) : [],
  );
  const steps = $derived(plain ? stepsForDesign(plain) : []);
  const driftEntries = $derived(compiled ? diffCompiled(compiled, $experiment.routines) : []);
  /** Why "Adopt from Builder" is unavailable, or null when every difference is adoptable. */
  const adoptReason = $derived(adoptDisabledReason(driftEntries));

  onMount(async () => {
    try {
      const rows = (await api.listContent(experimentId)) as Record<string, unknown>[];
      lastProgress = lastProgressOf(rows);
      rowBlockIds = blockIdsWithRows(rows);
    } catch {
      lastProgress = 0;
    }

    // The listing is what tells a half-written block apart from a fresh one, so
    // the opening state is settled only once it has arrived. An apply pressed
    // before then owns the state and is not overwritten.
    if (applyState === "idle" && !inFlight) applyState = stateFor(blockFor(selectedId));
  });

  /**
   * Switching or creating a block invalidates the previous apply result too —
   * including its error, which belongs to the block that was on screen when the
   * write failed and would otherwise read as this one's.
   */
  function selectBlock(id: string | null) {
    designRevision += 1;
    selectedId = id;
    applyError = null;
    applyState = stateFor(blockFor(id));
  }

  function addDesign() {
    const created = defaultSessionDesign($experiment.routines, $experiment.conditions, lastProgress);
    const design: SessionDesign = {
      ...created,
      label: uniqueLabel(
        designs.map((d) => d.label),
        created.label,
      ),
    };
    experiment.setSessionDesigns([...designs, design]);
    selectBlock(design.id);
  }

  function deleteDesign() {
    if (!selected) return;
    const message = `Delete "${selected.label}"? Routines and content rows it already wrote are left in place.`;
    if (!confirm(message)) return;
    experiment.setSessionDesigns(designs.filter((d) => d.id !== selected!.id));
    selectBlock(null);
  }

  // The Builder's "Open" action set this before switching tabs; consume it here
  // so "Open" lands on the block that was clicked, not merely on this tab.
  // Reads a store and writes a different rune, so it cannot loop.
  $effect(() => {
    const requested = $openBlockRequest;
    if (requested === null) return;
    // Through selectBlock, so an "Open" arrives with the same clean slate a
    // switcher change gives: the incoming block's own apply state, and none of
    // the outgoing block's error.
    selectBlock(requested);
    openBlockRequest.set(null);
  });

  /**
   * Take the Builder's live values as the block's own — the match routine's
   * seats AND the trial routine's interaction pattern, which are the two of
   * `diffCompiled`'s four drift kinds that adoption can resolve. Routed through
   * updateDesign so the store stays the single writer; cohortSize is set from
   * the same slots array, because the validator requires the two to agree.
   *
   * An adopted pattern the cohort cannot cover raises the validator's coverage
   * error rather than being filtered out here: the Builder's value belongs on
   * screen together with the reason it cannot ship.
   */
  function adoptFromBuilder() {
    if (!plain || adoptReason) return;

    const patch = adoptPatch(plain, $experiment.routines);
    if (Object.keys(patch).length === 0) return;
    updateDesign(patch);
  }

  /**
   * Write the block's compiled routines over the Builder's, creating any that
   * are gone. upsertRoutinesByName is create-or-replace by name in one store
   * update, so re-applying a block never appends a duplicate match routine.
   *
   * The routines come off `compiled`, the tab's single compile step, rather
   * than from a second `compileSessionDesign` call on the rune: two compiles
   * are two chances to disagree, and the second would be the one line that
   * reintroduced the DataCloneError if `selected` ever became a deep `$state`.
   */
  function overwriteFromDesign() {
    if (!compiled) return;
    experiment.upsertRoutinesByName(compiled.routines);
  }

  /**
   * The only writer of the selected design. Resets `applyState` because an edit
   * invalidates whatever the last apply reported, and clears `applyError` with
   * it — a message left standing under a bar that has returned to "ready"
   * describes a write the researcher has already moved past.
   */
  function updateDesign(patch: Partial<SessionDesign>) {
    if (!selected) return;
    applyState = "idle";
    applyError = null;
    designRevision += 1;
    experiment.setSessionDesigns(replaceDesign(designs, selected.id, patch));
  }

  /** The message from a failed write, shown under the bar until the next attempt. */
  let applyError = $state<string | null>(null);

  /**
   * Bumped by every edit that invalidates an apply already in flight. The
   * outcome of a write started before the edit is discarded, or the bar would
   * report "Applied · N rows written" over a design whose N was never written.
   */
  let designRevision = $state(0);

  /**
   * Generate & Save. The routine snapshot is built PURELY and sent as-is; the
   * Builder adopts it only once the server has accepted it, because the compile
   * plan reads its `+` / `~` verb back off the Builder and must never claim to
   * rewrite a routine the server has never seen. From `routines-only` this
   * retries the content upload alone: the routines are already on the
   * experiment and re-sending them would be a pointless write.
   */
  async function handleApply() {
    if (!canStartApply(compiled, inFlight)) return;
    // Narrowing for TypeScript; canStartApply has already refused a null block.
    if (!compiled) return;

    const retrying = applyState === "routines-only";
    const revision = designRevision;
    // Read off `compiled` before any await: it is derived, so an edit mid-flight
    // would otherwise swap the rows out from under the write that is running.
    const { routines, contentRows, band, participantsPerSession } = compiled;
    const snapshot = upsertByName($experiment.routines, routines);

    applyState = "applying";
    applyError = null;
    inFlight = true;

    const io = {
      saveRoutines: async () => {
        await api.updateExperiment(experimentId, {
          routines: snapshot,
          sessionDesigns: $experiment.sessionDesigns,
          participantsPerSession,
          // The server validates every session design against the conditions it
          // is saved with. Omitting them validates against the STORED list, so a
          // condition added in Settings but not yet saved would 400 the apply.
          conditions: $experiment.conditions,
        });
      },
      uploadContent: async () => {
        await api.replaceContent(experimentId, contentRows, band);
      },
    };

    try {
      const outcome = retrying ? await uploadOnly(io) : await runApply(io);

      if (shouldAdoptRoutines(outcome)) {
        experiment.upsertRoutinesByName(routines);
        experiment.setField("participantsPerSession", participantsPerSession);
        // The dirty flag is deliberately NOT cleared here. This PUT is a PARTIAL
        // save — routines, sessionDesigns, participantsPerSession and conditions
        // only — so it cannot know whether the Settings tab still holds unsaved
        // edits. Clearing it would hide them behind a "no changes" header and
        // lose them. Only the header's full save may call markSaved().
      }

      // What the server now holds for this block, so switching away and back
      // reports the same thing the bar does.
      if (outcome.state === "applied") rowBlockIds.add(band.blockId);
      else rowBlockIds.delete(band.blockId);

      const display = applyDisplay(outcome, revision !== designRevision);
      applyState = display.state;
      applyError = display.error;
    } finally {
      inFlight = false;
    }
  }
</script>

{#if designs.length === 0}
  <div class="empty">
    <div class="empty-inner">
      <svg
        width="120"
        height="72"
        viewBox="0 0 120 72"
        fill="none"
        stroke="#c4c4c4"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <circle cx="24" cy="20" r="9" />
        <circle cx="60" cy="20" r="9" />
        <circle cx="96" cy="20" r="9" />
        <circle cx="24" cy="56" r="9" />
        <circle cx="60" cy="56" r="9" />
        <circle cx="96" cy="56" r="9" />
        <path d="M33 20 H51" stroke="#0a0a0a" />
        <path d="M96 29 V47" stroke="#0a0a0a" />
        <path d="M33 56 H51" stroke="#0a0a0a" stroke-dasharray="3 3" />
      </svg>

      <h2>No session block yet</h2>

      <p class="lede">
        A session block matches a group of participants, keeps them together across several
        trials, and re-pairs them for each one. Everything it needs — the matching routine, the
        trials, and the content rows — is generated together, so the schedule and the progress
        sequence cannot drift apart.
      </p>

      <button class="btn-primary" onclick={addDesign}>New session block</button>

      <p class="fine">
        Pre-filled for 8 participants in dyads over 7 trials. Everything is editable after.
      </p>
    </div>
  </div>
{:else}
  <div class="designer">
    <div class="switcher">
      <span class="switcher-label">Block</span>
      <select value={selected?.id ?? ""} onchange={(e) => selectBlock(e.currentTarget.value)}>
        {#each designs as design (design.id)}
          <option value={design.id}>{design.label}</option>
        {/each}
      </select>
      <button class="btn-ghost" onclick={addDesign}>+ New session block</button>
      <div class="spacer"></div>
      <button class="btn-danger" onclick={deleteDesign}>Delete block</button>
    </div>

    {#if selected}
      <!--
        Task 8 mounts <DriftStrip> as the first child of this tab; it is the
        feature's only drift surface, and the apply bar below carries none.
      -->
      {#if driftEntries.length > 0}
        <div class="drift-slot">
          <DriftStrip
            entries={driftEntries}
            adoptDisabledReason={adoptReason}
            onadopt={adoptFromBuilder}
            onoverwrite={overwriteFromDesign}
          />
        </div>
      {/if}
      <!--
        Keyed on the block id: CohortPanel and RotationSchedule both hold local
        UI state — an expanded seat, the Schedule/Coverage tab, the lapsed
        round-robin pin — and without a key those survive a change of block and
        describe the wrong one.
      -->
      {#key selected.id}
        <div class="panes">
          <CohortPanel design={selected} {issues} onchange={updateDesign} />
          <RotationSchedule
            design={selected}
            routines={$experiment.routines}
            conditions={$experiment.conditions}
            {steps}
            {issues}
            onchange={updateDesign}
          />
        </div>
      {/key}

      {#if compiled}
        <ApplyBar
          {compiled}
          {issues}
          state={applyState}
          {inFlight}
          routineNames={$experiment.routines.map((r) => r.name)}
          onapply={handleApply}
          {onviewcontent}
        />
      {/if}
      {#if applyError}
        <p class="apply-error">{applyError}</p>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 500px;
    padding: 2rem;
  }

  .empty-inner {
    max-width: 460px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  h2 {
    font-size: 16px;
    font-weight: 600;
    margin: 0;
  }

  .lede {
    margin: 0;
    font-size: 13px;
    color: var(--gray-600);
    line-height: 1.7;
  }

  .fine {
    margin: 0;
    font-size: 11px;
    color: var(--gray-400);
  }

  .btn-primary {
    background: var(--black);
    color: #fff;
    padding: 0.5rem 1.25rem;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 14px;
    cursor: pointer;
    font-family: inherit;
    margin-top: 0.25rem;
  }

  .designer {
    display: flex;
    flex-direction: column;
    min-height: 500px;
    overflow: hidden;
  }

  .switcher {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    border-bottom: 1px solid var(--gray-200);
  }

  .switcher-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--gray-700);
  }

  .switcher select {
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-family: inherit;
    background: #fff;
  }

  .spacer {
    flex: 1;
  }

  .btn-ghost {
    font-size: 11px;
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
    background: #fff;
    cursor: pointer;
    color: var(--gray-600);
    font-family: inherit;
  }

  .btn-danger {
    font-size: 11px;
    padding: 0.2rem 0.4rem;
    border: 1px solid var(--danger);
    color: var(--danger);
    border-radius: var(--radius-sm);
    background: #fff;
    cursor: pointer;
    font-family: inherit;
  }

  /*
    CohortPanel supplies its own 280px width, border-right and padding, and
    RotationSchedule its own `flex: 1` and padding; `min-height: 0` is what
    lets both scroll instead of stretching the page.
  */
  .drift-slot {
    padding: 1rem 1rem 0;
  }

  .panes {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .apply-error {
    margin: 0.5rem 1rem 0;
    font-size: 12px;
    color: var(--danger);
  }
</style>
