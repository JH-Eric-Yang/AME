<script lang="ts">
  import type { ElementConfig, ElementType, EventTrigger, FreePlacement, RoutineConfig } from "ame-shared";
  import { canRenderOnHandset } from "ame-shared/surfaces";
  import FamilyMark from "$lib/components/FamilyMark.svelte";
  import { familyOf } from "ame-shared/elementFamilies";
  import type { SequenceRow } from "ame-shared/progressSequence";
  import {
    clampPlacement,
    stageSize,
    neighbourPlacements,
    firstOverlap,
    aspectLocked,
    hasIntrinsicSize,
    conformTarget,
    conformsToAspect,
    naturalAspectScale,
    containSize,
    describeNaturalSize,
    DefaultFreePlacement,
  } from "ame-shared/layout";
  import { naturalSizes, mediaUrl } from "$lib/admin/naturalSize";
  import { experiment } from "$lib/stores/experiment";
  import { NudgeStepPct, NudgeStepFastPct } from "$lib/admin/freeNudge";
  import { formatPct, parsePct, correctedPctText } from "$lib/admin/freePlacementFields";
  import { isOverflowing } from "$lib/admin/overflowCheck";
  import { provideRefPicker, type RefPickerRequest } from "$lib/admin/refPickerContext";
  import type { RefOptionsInput } from "$lib/admin/refOptions";
  import { listContent } from "$lib/api";
  import ParamsEditor from "./params/ParamsEditor.svelte";
  import PropertyFilterEditor from "./PropertyFilterEditor.svelte";
  import ElText from "../../elements/ElText.svelte";
  import ReferencePicker from "../refs/ReferencePicker.svelte";

  interface Props {
    element: ElementConfig;
    routine: RoutineConfig;
    /**
     * Elements belonging to another audience or surface, which the canvas is
     * not showing. Passed through so the placement fields collide against
     * exactly the set FreeCanvas's drag collides against — two elements shown
     * to different roles never share a screen, so they may share a rectangle.
     */
    hiddenElementNames?: string[];
    routineIndex: number;
    elementIndex: number;
  }

  let {
    element,
    routine,
    hiddenElementNames = [],
    routineIndex,
    elementIndex,
  }: Props = $props();

  const freeMode = $derived((routine.layout.mode ?? "flow") === "free");
  const placement = $derived(element.placement ?? DefaultFreePlacement);
  const stageRatio = $derived(
    routine.layout.stage && routine.layout.stage !== "fluid" ? routine.layout.stage : null,
  );

  /** The placed elements this one must not overlap — see `hiddenElementNames`. */
  const neighbours = $derived(
    neighbourPlacements(
      routine.elements,
      elementIndex,
      (el) => !hiddenElementNames.includes(el.name),
    ),
  );

  /** The neighbour a typed value would have landed on, cleared on the next good commit. */
  let placementConflict = $state<string | null>(null);

  /**
   * Commits a typed x/y/w/h field on change (blur/Enter, not every
   * keystroke, so a value is never clamped or reformatted out from under a
   * researcher mid-type) and corrects the field's text if the accepted value
   * differs from what was typed — clamped, or just rounded to one decimal.
   * Mirrors `correctedNumberText`'s idiom (admin/numberInput.ts): Svelte only
   * rewrites `value={expr}` when `expr` changes, so an unclamped/unrounded
   * value has to be forced onto the input imperatively.
   *
   * Overlap is forbidden (§6.1) and enforced at authoring time only, so this
   * path has to ask as well — it used to clamp and commit. It behaves like the
   * drag does: it SHOWS the invalid state (the typed text stays, and a warning
   * names what is in the way) and declines to commit, rather than snapping the
   * value back. Refusing a keystroke outright, or silently rewriting the field,
   * would both be worse than letting a researcher see the conflict and fix it.
   */
  function commitPlacementField(field: keyof FreePlacement, input: HTMLInputElement) {
    const parsed = parsePct(input.value);
    if (parsed === null) return;
    const next = clampPlacement({ ...placement, [field]: parsed });
    const clash = firstOverlap(next, neighbours);
    if (clash) {
      placementConflict = clash.name;
      return;
    }
    placementConflict = null;
    updateEl({ placement: next });
    const corrected = correctedPctText(input.value, next[field]);
    if (corrected !== null) input.value = corrected;
  }

  // Overflow measurement is scoped to `text`: it is the type the plan calls
  // out by name ("text can outgrow its box"), and the only one whose runtime
  // component (ElText) is pure markup with no mount side effects — so it can
  // be mounted off-screen here and measured directly, rather than this file
  // re-deriving its styling and risking drift from the real thing.
  const canMeasureOverflow = $derived(freeMode && element.type === "text" && !!stageRatio);
  const stagePx = $derived(stageRatio ? stageSize(stageRatio) : null);
  const boxWidthPx = $derived(stagePx ? (placement.wPct / 100) * stagePx.width : 0);
  const boxHeightPx = $derived(stagePx ? (placement.hPct / 100) * stagePx.height : 0);

  // ── Intrinsic sizing ──────────────────────────────────
  //
  // The lock is offered only for the types that HAVE a natural size to lock
  // to. On a text or survey box there is nothing to follow, so the control
  // would be dead rather than merely off.
  const lockable = $derived(hasIntrinsicSize(element.type));
  const locked = $derived(aspectLocked(element));
  const mediaSrcUrl = $derived(mediaUrl(element));
  /** undefined = not measured yet, null = cannot be measured, else the size. */
  const measured = $derived(mediaSrcUrl ? $naturalSizes[mediaSrcUrl] : undefined);

  /**
   * What the lock is locking to, said honestly at every stage: a box can be
   * locked before its source is chosen, while the browser is still loading it,
   * and after a load that failed, and a readout that claimed a ratio in any of
   * those cases would be inventing one.
   */
  const naturalNote = $derived(
    !mediaSrcUrl
      ? "no source chosen yet — nothing to lock to"
      : measured === undefined
        ? "measuring the source…"
        : measured === null
          ? "the source could not be loaded, so its size is unknown"
          : `natural ${describeNaturalSize(measured)}`,
  );

  /**
   * The neighbour standing in the way of this element taking its media's
   * shape. Asked with the same function and the same neighbour set the canvas
   * conforms through, so the warning and the behaviour cannot disagree.
   */
  const conformBlockedBy = $derived.by(() => {
    const target = conformTarget(element, measured, stagePx);
    return target ? (firstOverlap(target, neighbours)?.name ?? null) : null;
  });

  /**
   * The size the media actually renders at inside an unlocked box, when that
   * box is not its shape — null whenever there are no bands to report.
   *
   * Unticking the lock is a legitimate choice, so this is a readout and not a
   * warning: nothing is lost, the stimulus is simply smaller than the area
   * drawn for it, and a researcher who sizes a box by hand should be able to
   * see that rather than infer it. It is deliberately silent while the lock is
   * on — a locked box either already conforms or has `conformBlockedBy` to
   * explain why it does not.
   *
   * `containSize` is the same fit the browser performs under
   * `FreeMediaFitClass`, so the numbers here are the participant's, not a
   * second estimate of them.
   */
  const letterbox = $derived.by(() => {
    if (!lockable || locked || !measured || !stagePx) return null;
    const scale = naturalAspectScale(measured, stagePx);
    if (scale === null || conformsToAspect(placement, scale)) return null;
    return containSize(measured, { width: boxWidthPx, height: boxHeightPx });
  });

  let overflowProbe: HTMLDivElement | undefined = $state();
  let contentHeightPx = $state(0);

  $effect(() => {
    // Re-measure whenever the content or box width changes.
    void element.params;
    void boxWidthPx;
    contentHeightPx = overflowProbe ? overflowProbe.scrollHeight : 0;
  });

  const isOverflowingBox = $derived(canMeasureOverflow && isOverflowing(contentHeightPx, boxHeightPx));

  const RoleColors = ["#3b82f6", "#f97316", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4"];

  const ElementTypes: { value: ElementType; label: string }[] = [
    { value: "text", label: "Text" },
    { value: "image", label: "Image" },
    { value: "video", label: "Video" },
    { value: "audio", label: "Audio" },
    { value: "button", label: "Button" },
    { value: "recorder", label: "Recorder" },
    { value: "input-textfield", label: "Text Field" },
    { value: "input-select", label: "Select" },
    { value: "input-slider", label: "Slider" },
    { value: "timer", label: "Timer" },
    { value: "body-detector", label: "Body Detector" },
    { value: "volume-check", label: "Volume Check" },
    { value: "speech-recognizer", label: "Speech Recognizer" },
    { value: "video-chat", label: "Video Chat" },
    { value: "keyboard", label: "Keyboard" },
    { value: "input-option-group", label: "Option Group" },
    { value: "input-file-picker", label: "File Picker" },
    { value: "survey", label: "Survey" },
    { value: "facial-expression-detector", label: "Facial Expression" },
  ];

  /** Triggers each element type can fire. Types absent here have no events. */
  const TriggersByType: Partial<Record<ElementType, EventTrigger[]>> = {
    button: ["click"],
    keyboard: ["press"],
    "body-detector": ["detection"],
    "facial-expression-detector": ["detection"],
    "input-option-group": ["change"],
    survey: ["change"],
    timer: ["timeout"],
    "input-textfield": ["change"],
    "input-select": ["change"],
    "input-slider": ["change"],
    "speech-recognizer": ["keyword"],
    "volume-check": ["detection"],
  };

  const eventTriggers = $derived(TriggersByType[element.type] ?? []);

  function updateEl(patch: Partial<ElementConfig>) {
    experiment.updateElement(routineIndex, elementIndex, patch);
  }

  // ── Reference picker host ─────────────────────────────
  //
  // The Inspector is the unrestricted host (spec §7.2): it cannot know where
  // the routine will run, so nothing is disabled here and the Progress tab
  // validates the result per step. Content rows are fetched lazily, on the
  // first open, rather than on every Inspector mount.
  let pickerRequest = $state<RefPickerRequest | null>(null);
  let contentRows = $state<SequenceRow[] | null>(null);

  // Two opens before the first fetch resolves must not race: caching the
  // in-flight promise makes every concurrent open() await the SAME fetch,
  // and assigning `pickerRequest` before the await means the latest request
  // always wins, regardless of which open's fetch settles last.
  let contentRowsLoad: Promise<SequenceRow[]> | null = null;
  const loadContentRows = (): Promise<SequenceRow[]> =>
    (contentRowsLoad ??= listContent($experiment.id).then((rows) => rows as SequenceRow[]).catch(() => []));

  provideRefPicker({
    open: async (request) => {
      pickerRequest = request;
      if (contentRows === null) contentRows = await loadContentRows();
    },
  });

  const pickerInput = $derived<RefOptionsInput | null>(
    pickerRequest && contentRows
      ? {
          rows: contentRows,
          condition: $experiment.conditions[0] ?? "Basic",
          routines: $experiment.routines,
          ranges: $experiment.randomizationConfig?.[$experiment.conditions[0] ?? "Basic"] ?? [],
          from: null,
          kind: pickerRequest.kind,
        }
      : null,
  );
</script>

<div class="inspector">
  <div class="inspector-header">
    <h4><FamilyMark family={familyOf(element.type)} /> {element.name}</h4>
    <button class="btn-danger" onclick={() => experiment.removeElement(routineIndex, elementIndex)}>Delete</button>
  </div>

  <label>
    <span>Name</span>
    <input type="text" value={element.name} oninput={(e) => updateEl({ name: e.currentTarget.value })} />
  </label>

  <label>
    <span>Type</span>
    <select value={element.type} onchange={(e) => updateEl({ type: e.currentTarget.value as ElementType })}>
      {#each ElementTypes as et}
        <option value={et.value}>{et.label}</option>
      {/each}
    </select>
  </label>

  <label>
    <span>Onset (ms)</span>
    <input type="number" value={element.onsetTime ?? 0} oninput={(e) => updateEl({ onsetTime: parseInt(e.currentTarget.value) })} min="0" />
  </label>

  <label>
    <span>Duration (ms, 0 = persist)</span>
    <input type="number" value={element.duration ?? 0} oninput={(e) => { const v = parseInt(e.currentTarget.value); updateEl({ duration: v > 0 ? v : null }); }} min="0" />
  </label>

  <fieldset>
    <legend>Parameters</legend>
    <!-- Editors keep local UI state (e.g. TextParamsEditor's "Custom… chosen,
         nothing typed yet" flag). This remount is what scopes that state to
         one element — keyed on the indices, not the element object (the
         store spreads a new object on every keystroke) and not the name
         (two routines may share one). -->
    {#key `${routineIndex}:${elementIndex}`}
      <ParamsEditor
        {element}
        {freeMode}
        experimentId={$experiment.id}
        onchange={(params) => updateEl({ params })}
      />
    {/key}
  </fieldset>

  {#if eventTriggers.length > 0}
    <fieldset>
      <legend>Events</legend>
      {#each element.events ?? [] as ev, evIdx}
        <div class="event-row">
          <select value={ev.trigger} onchange={(e) => {
            const events = [...(element.events ?? [])];
            events[evIdx] = { ...events[evIdx], trigger: e.currentTarget.value as import("ame-shared").EventTrigger };
            updateEl({ events });
          }}>
            {#each eventTriggers as trigger}
              <option value={trigger}>{trigger}</option>
            {/each}
          </select>
          <span class="event-arrow">→</span>
          <select value={ev.type} onchange={(e) => {
            const events = [...(element.events ?? [])];
            events[evIdx] = { ...events[evIdx], type: e.currentTarget.value as import("ame-shared").EventType };
            updateEl({ events });
          }}>
            <option value="proceed">proceed</option>
            <option value="data">data</option>
            <option value="complete">complete</option>
            <option value="alert">alert</option>
          </select>
          <button class="btn-remove" onclick={() => {
            const events = (element.events ?? []).filter((_, i) => i !== evIdx);
            updateEl({ events: events.length > 0 ? events : undefined });
          }}>×</button>
        </div>
        {#if ev.type === "data"}
          <label class="event-option">
            <span>Answers</span>
            <select
              value={ev.params?.multiple === undefined ? "replace" : ev.params.multiple ? "many" : "one"}
              onchange={(e) => {
                const choice = e.currentTarget.value;
                const events = [...(element.events ?? [])];
                const params = { ...events[evIdx].params };
                if (choice === "replace") delete params.multiple;
                else params.multiple = choice === "many";
                events[evIdx] = { ...events[evIdx], params };
                updateEl({ events });
              }}
            >
              <option value="replace">Replace — each answer overwrites the last</option>
              <option value="many">Allow multiple — every answer is kept, in order</option>
              <option value="one">One only — the first answer is locked in</option>
            </select>
          </label>
        {/if}
      {/each}
      <button class="btn-add-event" onclick={() => {
        const events = [...(element.events ?? []), { trigger: eventTriggers[0], type: "proceed" as const }];
        updateEl({ events });
      }}>+ Add Event</button>
    </fieldset>
  {/if}

  <fieldset>
    <legend>Surface</legend>
    <select
      value={element.surface ?? "screen"}
      onchange={(e) => {
        const surface = e.currentTarget.value as "screen" | "device";
        updateEl({ surface: surface === "screen" ? undefined : surface });
      }}
    >
      <option value="screen">Desktop screen</option>
      <option value="device" disabled={!canRenderOnHandset(element.type)}>
        Supplementary device
      </option>
    </select>
    <p class="hint">
      {element.surface === "device"
        ? "On the participant's phone. A control here reports to their desktop, which applies the event."
        : "On the participant's desktop screen."}
    </p>
  </fieldset>

  {#if routine.roles?.length}
    <fieldset>
      <legend>Role Visibility</legend>
      <div class="role-checkboxes">
        {#each routine.roles as role, rIdx}
          <label class="role-checkbox">
            <input
              type="checkbox"
              checked={element.showForRoles?.includes(role) ?? false}
              onchange={(e) => {
                const checked = e.currentTarget.checked;
                const current = element.showForRoles ?? [];
                const updated = checked
                  ? [...current, role]
                  : current.filter((r) => r !== role);
                updateEl({ showForRoles: updated.length > 0 ? updated : undefined });
              }}
            />
            <span class="role-dot" style="background:{RoleColors[rIdx % RoleColors.length]}"></span>
            {role}
          </label>
        {/each}
      </div>
      <span class="hint">Unchecked = visible to everyone</span>
    </fieldset>
  {/if}

  <fieldset>
    <legend>Show When</legend>
    <PropertyFilterEditor
      filters={element.showWhen ?? []}
      allowReferences
      onchange={(filters) => updateEl({ showWhen: filters.length > 0 ? filters : undefined })}
    />
    <span class="hint">
      Every condition must hold. A property is a participant property, or an earlier answer via "ref".
      Numbers compare as numbers; put a value in double quotes to compare it as text (e.g. "18" for
      a text-field answer). With no conditions the element is always shown.
    </span>
  </fieldset>

  {#if freeMode}
    <fieldset>
      <legend>Free Placement</legend>
      <!--
        onchange (blur/Enter), not oninput: a value is clamped and reformatted
        to one decimal on commit, and doing that on every keystroke would
        fight a researcher mid-type. Typing 50 and leaving the field has to
        show exactly 50.0 and put the element at exactly 50% — that
        round-trip is the point of this control.
      -->
      <div class="placement-fields">
        <label>
          <span>X (%)</span>
          <input
            type="number"
            step="0.1"
            value={formatPct(placement.xPct)}
            onchange={(e) => commitPlacementField("xPct", e.currentTarget)}
          />
        </label>
        <label>
          <span>Y (%)</span>
          <input
            type="number"
            step="0.1"
            value={formatPct(placement.yPct)}
            onchange={(e) => commitPlacementField("yPct", e.currentTarget)}
          />
        </label>
        <label>
          <span>W (%)</span>
          <input
            type="number"
            step="0.1"
            value={formatPct(placement.wPct)}
            onchange={(e) => commitPlacementField("wPct", e.currentTarget)}
          />
        </label>
        <label>
          <span>H (%)</span>
          <input
            type="number"
            step="0.1"
            value={formatPct(placement.hPct)}
            onchange={(e) => commitPlacementField("hPct", e.currentTarget)}
          />
        </label>
      </div>
      <p class="hint">
        Values are a percentage of the stage. Click the element on the stage, then arrow
        keys nudge it {NudgeStepPct}% at a time; Shift+Arrow nudges {NudgeStepFastPct}%.
        Hover a box to reveal its corner handles.
      </p>
      {#if lockable}
        <!--
          Ticked, the box takes its media's shape: H follows W, here and on a
          corner drag. Unticked, W and H are independent and the media
          letterboxes inside whatever box it is given — the `FreeMediaFitClass`
          rule, which the canvas and the runtime both apply, so nothing about
          the participant's screen changes either way. Before that rule existed
          this sentence was false: unticking the lock cropped the stimulus.
        -->
        <label class="lock-row">
          <input
            type="checkbox"
            checked={locked}
            onchange={(e) => updateEl({ lockAspect: e.currentTarget.checked })}
          />
          <span>Lock aspect ratio</span>
        </label>
        <span class="hint">{naturalNote}</span>
        {#if letterbox}
          <p class="config-hint">
            This box is not the {element.type}'s shape, so the {element.type} is
            letterboxed inside it — shown at {Math.round(letterbox.width)}×{Math.round(
              letterbox.height,
            )}px in a {Math.round(boxWidthPx)}×{Math.round(boxHeightPx)}px box, with
            empty space around it. Nothing is cut off. Tick the lock to fit the box to
            the {element.type}.
          </p>
        {/if}
        {#if locked && conformBlockedBy}
          <p class="config-hint warn">
            This box cannot take the {element.type}'s shape without landing on
            "{conformBlockedBy}", so it was left as it is. Move one of them, or untick
            the lock.
          </p>
        {/if}
      {/if}
      {#if placementConflict}
        <p class="config-hint warn">
          That value would put this element on top of "{placementConflict}", so it was not
          applied — elements may not overlap. Move one of them first.
        </p>
      {/if}
      {#if isOverflowingBox}
        <p class="config-hint warn">
          Content is taller than this box ({Math.round(contentHeightPx)}px of {Math.round(boxHeightPx)}px) —
          it will be clipped for participants. Increase H or shorten the content.
        </p>
      {/if}
    </fieldset>

    {#if canMeasureOverflow}
      <div
        class="overflow-probe"
        style="width: {boxWidthPx}px;"
        bind:this={overflowProbe}
        aria-hidden="true"
      >
        <ElText {element} />
      </div>
    {/if}
  {:else}
    <div class="position-info">
      <span class="caption">Position: Row {(element.position?.row ?? 0) + 1}, Col {(element.position?.column ?? 0) + 1}</span>
    </div>
  {/if}
</div>

{#if pickerRequest && pickerInput}
  <ReferencePicker input={pickerInput} onpick={pickerRequest.onpick} onclose={() => (pickerRequest = null)} />
{/if}

<style>
  .inspector {
    padding: 1rem;
    overflow-y: auto;
    height: 100%;
  }
  .inspector-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
  .inspector-header h4 { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; margin: 0; }
  label { display: block; margin-bottom: 0.5rem; }
  label span { display: block; font-size: 12px; font-weight: 500; margin-bottom: 0.15rem; color: var(--gray-700); }
  input[type="text"], input[type="number"], select { width: 100%; padding: 0.35rem 0.5rem; border: 1px solid var(--gray-200); border-radius: var(--radius); font-size: 13px; box-sizing: border-box; }
  input:focus, select:focus { outline: none; border-color: var(--black); }
  fieldset { border: 1px solid var(--gray-200); border-radius: var(--radius); padding: 0.75rem; margin-top: 0.75rem; }
  legend { font-size: 12px; font-weight: 500; padding: 0 0.25rem; }
  .btn-danger { font-size: 11px; padding: 0.2rem 0.4rem; border: 1px solid var(--danger); color: var(--danger); border-radius: var(--radius); background: var(--white); cursor: pointer; }
  .role-checkboxes { display: flex; flex-direction: column; gap: 0.25rem; }
  .role-checkbox { display: flex; align-items: center; gap: 0.35rem; font-size: 12px; cursor: pointer; margin-bottom: 0; }
  .role-checkbox input[type="checkbox"] { width: auto; margin: 0; }
  .role-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .hint { font-size: 10px; color: var(--gray-400); display: block; margin-top: 0.25rem; }
  .position-info { margin-top: 0.75rem; }
  .caption { font-size: 11px; color: var(--gray-400); }
  .placement-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; }
  .placement-fields label { margin-bottom: 0; }
  .lock-row { display: flex; align-items: center; gap: 0.35rem; font-size: 12px; cursor: pointer; margin: 0.5rem 0 0; }
  .lock-row input[type="checkbox"] { width: auto; margin: 0; }
  .lock-row span { display: inline; margin: 0; font-weight: 500; }
  .config-hint { font-size: 12px; color: var(--gray-600); margin: 0.5rem 0 0; }
  .config-hint.warn { color: var(--accent); }
  /* Off-screen, unstyled-by-the-viewport probe used only to measure content
     height for the overflow warning above — never shown to a researcher. */
  .overflow-probe {
    position: fixed;
    top: 0;
    left: -9999px;
    visibility: hidden;
    box-sizing: border-box;
  }
  .event-row { display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.35rem; }
  .event-row select { flex: 1; padding: 0.25rem; border: 1px solid var(--gray-200); border-radius: var(--radius); font-size: 12px; }
  .event-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 0.5rem 0.5rem;
    font-size: 12px;
  }
  .event-option select {
    flex: 1;
  }
  .event-arrow { font-size: 12px; color: var(--gray-400); flex-shrink: 0; }
  .btn-remove { background: none; border: 1px solid var(--danger); color: var(--danger); border-radius: var(--radius); cursor: pointer; font-size: 12px; padding: 0.15rem 0.35rem; flex-shrink: 0; }
  .btn-add-event { background: var(--white); border: 1px solid var(--black); color: var(--black); border-radius: var(--radius); cursor: pointer; font-size: 12px; padding: 0.3rem 0.6rem; margin-top: 0.25rem; width: 100%; }
</style>
