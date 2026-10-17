<script lang="ts">
  import type {
    RoutineConfig,
    RoutineType,
    RoutineLayout,
    LayoutMode,
    StageRatio,
    MatchingConfig,
    DeviceConfig,
    NextButtonMode,
    RoutineCardConfig,
    RoutineConsentConfig,
    RoutineEndConfig,
    RoutinePosCheckConfig,
    RoutineVideoChatConfig,
    RoutineSurveyConfig,
    FinishMode,
  } from "ame-shared";
  import { resolveFinishMode } from "ame-shared";
  import { getDefaultLayout } from "ame-shared/defaultLayouts";
  import { resolveVideoLayout } from "ame-shared/videoChat";
  import {
    DefaultGap,
    defaultPadding,
    applyLayoutMode,
    supportsStage,
    stageUnavailableReason,
  } from "ame-shared/layout";
  import { resizeSlots, MinSlotCount, MaxSlotCount } from "$lib/admin/slotEditing";
  import { describeAssignment } from "$lib/admin/roleAssignmentCopy";
  import { validateRoleAssignment } from "ame-shared/roleAssignment";
  import { experiment } from "$lib/stores/experiment";
  import { findOwningDesign, describeOwnership } from "ame-shared/blockOwnership";
  import { openBlockRequest } from "$lib/stores/adminNav";
  import SurveyQuestionBuilder from "./SurveyQuestionBuilder.svelte";
  import SurveyJsonEditor from "./SurveyJsonEditor.svelte";

  interface Props {
    routine: RoutineConfig;
    routineIndex: number;
  }

  let { routine, routineIndex }: Props = $props();

  let showAddRole = $state(false);
  let newRoleName = $state("");

  const RoleColors = ["#3b82f6", "#f97316", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4"];

  /** matchingHandler multiplies this by 1000, so the stored unit is seconds. */
  const DefaultMatchingTimeoutSeconds = 300;
  const SecondsPerHour = 3600;
  /** Above an hour a stranded participant is effectively never timed out. */
  const MaxReasonableTimeoutSeconds = SecondsPerHour;

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

  const AlignOptions: { value: string; label: string }[] = [
    { value: "stretch", label: "Stretch" },
    { value: "start", label: "Start" },
    { value: "center", label: "Center" },
    { value: "end", label: "End" },
  ];

  const JustifyOptions: { value: string; label: string }[] = [
    { value: "start", label: "Start" },
    { value: "center", label: "Center" },
    { value: "end", label: "End" },
    { value: "between", label: "Space Between" },
    { value: "around", label: "Space Around" },
  ];

  const StageOptions: { value: "fluid" | StageRatio; label: string }[] = [
    { value: "fluid", label: "Fluid" },
    { value: "16:9", label: "16:9" },
    { value: "4:3", label: "4:3" },
    { value: "device", label: "Match device" },
  ];

  const ModeOptions: { value: LayoutMode; label: string }[] = [
    { value: "flow", label: "Flow" },
    { value: "free", label: "Free" },
  ];

  function updateRoutine(patch: Partial<RoutineConfig>) {
    experiment.updateRoutine(routineIndex, patch);
  }

  function handleTypeChange(newType: RoutineType) {
    updateRoutine({ type: newType, layout: getDefaultLayout(newType), config: {} });
  }

  function updateLayout(patch: Partial<RoutineLayout>) {
    experiment.updateLayout(routineIndex, { ...routine.layout, ...patch });
  }

  /**
   * Mode is the one layout field that changes more than the layout: flipping
   * to Free also seeds a placement for every element that lacks one (so
   * elements stay where the flow grid had them) and, if the stage was still
   * Fluid, locks one — all decided by `applyLayoutMode` and just applied here.
   */
  function handleModeChange(mode: LayoutMode) {
    const result = applyLayoutMode(routine.layout, routine.elements, mode);
    updateRoutine({ layout: result.layout, elements: result.elements });
  }

  function handleStageChange(stage: "fluid" | StageRatio) {
    updateLayout({ stage });
  }

  const stageValue = $derived(routine.layout.stage ?? "fluid");
  const modeValue = $derived(routine.layout.mode ?? "flow");
  // Free placement is a percentage of the stage box, so it is not
  // representable once the stage goes back to fluid — Fluid is disabled in
  // the Stage select while Free is active rather than silently allowing it.
  const freeRequiresLockedStage = $derived(modeValue === "free");

  /**
   * A stage is only offered where the routine's surface IS the stage — the
   * rule and the reason both live in ame-shared/layout, so the canvas and any
   * later consumer read one definition.
   *
   * A routine that already carries a stage or free mode on an unsupported type
   * (hand-edited, imported, or authored before this restriction) keeps the
   * controls, with the reason shown as a warning: hiding them would leave the
   * researcher no way to clear a setting that is producing a wrong layout.
   */
  const stageSupported = $derived(supportsStage(routine.type));
  const stageReason = $derived(stageUnavailableReason(routine.type));
  const carriesStageSettings = $derived(
    (routine.layout.stage !== undefined && routine.layout.stage !== "fluid") ||
      routine.layout.mode === "free",
  );
  const showStageControls = $derived(stageSupported || carriesStageSettings);

  function updateMatching(patch: Partial<MatchingConfig>) {
    const current: MatchingConfig = routine.matching ?? { strategy: "fifo", slots: [] };
    updateRoutine({ matching: { ...current, ...patch } });
  }

  function updateDevice(patch: Partial<DeviceConfig>) {
    const current: DeviceConfig = routine.device ?? { mode: null };
    updateRoutine({ device: { ...current, ...patch } });
  }

  function updateConfig(patch: Record<string, unknown>) {
    updateRoutine({ config: { ...(routine.config ?? {}), ...patch } });
  }

  const cardConfig = $derived((routine.config ?? {}) as RoutineCardConfig);
  const consentConfig = $derived((routine.config ?? {}) as RoutineConsentConfig);
  const endConfig = $derived((routine.config ?? {}) as RoutineEndConfig);
  const posCheckConfig = $derived((routine.config ?? {}) as RoutinePosCheckConfig);
  const videoChatConfig = $derived((routine.config ?? {}) as RoutineVideoChatConfig);
  const owningDesign = $derived(findOwningDesign(routine.name, $experiment.sessionDesigns));

  let surveyTab: "builder" | "json" = $state("builder");
  let surveyModalOpen = $state(false);
  let modalPortal: HTMLDivElement | undefined = $state();
  const surveyConfig = $derived((routine.config ?? {}) as RoutineSurveyConfig);

  // Teleport modal to document.body so it escapes any overflow/positioning context
  $effect(() => {
    if (modalPortal) {
      document.body.appendChild(modalPortal);
      return () => {
        modalPortal?.remove();
      };
    }
  });

  const surveyQuestionCount = $derived(() => {
    const json = surveyConfig.surveyJson;
    if (!json) return 0;
    const pages = json.pages as { elements?: unknown[] }[] | undefined;
    if (pages) return pages.reduce((sum, p) => sum + (p.elements?.length ?? 0), 0);
    const elements = json.elements as unknown[] | undefined;
    return elements?.length ?? 0;
  });

  function handleSurveyJsonChange(json: Record<string, unknown>) {
    updateConfig({ surveyJson: Object.keys(json).length > 0 ? json : null });
  }
</script>

<div class="inspector">
  <div class="inspector-header">
    <h4>{routine.name}</h4>
    <button class="btn-danger" onclick={() => experiment.removeRoutine(routineIndex)}>Delete</button>
  </div>
  {#if owningDesign}
    <div class="owned-strip">
      <svg class="owned-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" style="stroke: var(--gray-600)" stroke-width="1.5" aria-hidden="true">
        <path d="M13 8 A5 5 0 1 1 8 3" stroke-linecap="round" />
        <path d="M8 0.5 L8 5.5 L11 3" stroke-linejoin="round" stroke-linecap="round" />
      </svg>
      <span class="owned-text">{describeOwnership(owningDesign)}</span>
      <button class="owned-open" onclick={() => openBlockRequest.set(owningDesign.id)}>Open</button>
    </div>
  {/if}

  <label>
    <span>Name</span>
    <input type="text" value={routine.name} oninput={(e) => updateRoutine({ name: e.currentTarget.value })} />
  </label>

  <label>
    <span>Type</span>
    <select value={routine.type} onchange={(e) => handleTypeChange(e.currentTarget.value as RoutineType)}>
      {#each RoutineTypes as rt}
        <option value={rt.value}>{rt.label}</option>
      {/each}
    </select>
  </label>

  <fieldset>
    <legend>Container Layout</legend>
    {#if showStageControls}
      <label>
        <span>Stage</span>
        <select
          value={stageValue}
          onchange={(e) => handleStageChange(e.currentTarget.value as "fluid" | StageRatio)}
        >
          {#each StageOptions as opt}
            <option value={opt.value} disabled={opt.value === "fluid" && freeRequiresLockedStage}>
              {opt.label}
            </option>
          {/each}
        </select>
      </label>
      <label>
        <span>Mode</span>
        <select value={modeValue} onchange={(e) => handleModeChange(e.currentTarget.value as LayoutMode)}>
          {#each ModeOptions as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </label>
      {#if !stageSupported}
        <p class="config-hint warn">
          {stageReason} This routine carries one anyway — set Stage to Fluid and Mode to Flow
          to clear it.
        </p>
      {:else if freeRequiresLockedStage}
        <p class="config-hint">
          Free placement requires a locked stage, so Fluid is unavailable while Mode is Free —
          positions are stored as a percentage of the stage box, which a fluid, window-sized
          surface cannot represent.
        </p>
      {/if}
    {:else}
      <p class="config-hint">
        Stage and free placement are unavailable on this routine type. {stageReason}
      </p>
    {/if}
    <!-- The stand-in values come from the shared geometry module, so the field
         never shows a default that is not what renders: the grid's gap is 1rem,
         and a card-family routine's padding is 0 because the card supplies its
         own. -->
    <label>
      <span>Gap</span>
      <input type="text" value={routine.layout.gap ?? DefaultGap} oninput={(e) => updateLayout({ gap: e.currentTarget.value })} />
    </label>
    <label>
      <span>Padding</span>
      <input type="text" value={routine.layout.padding ?? defaultPadding(routine.type)} oninput={(e) => updateLayout({ padding: e.currentTarget.value })} />
    </label>
    <label>
      <span>Align Items</span>
      <select value={routine.layout.alignItems ?? "stretch"} onchange={(e) => updateLayout({ alignItems: e.currentTarget.value as RoutineLayout["alignItems"] })}>
        {#each AlignOptions as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    </label>
    <label>
      <span>Justify Content</span>
      <select value={routine.layout.justifyContent ?? "start"} onchange={(e) => updateLayout({ justifyContent: e.currentTarget.value as RoutineLayout["justifyContent"] })}>
        {#each JustifyOptions as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    </label>
  </fieldset>

  <fieldset>
    <legend>Roles</legend>
    {#each routine.roles ?? [] as role, rIdx}
      <div class="role-item">
        <span class="role-dot" style="background:{RoleColors[rIdx % RoleColors.length]}"></span>
        <span class="role-name">{role}</span>
        <button class="btn-remove" onclick={() => experiment.removeRole(routineIndex, rIdx)}>&times;</button>
      </div>
    {/each}
    {#if showAddRole}
      <div class="add-role-form">
        <input type="text" bind:value={newRoleName} placeholder="Role name" />
        <div class="add-role-actions">
          <button onclick={() => { if (newRoleName) { experiment.addRole(routineIndex, newRoleName); newRoleName = ''; showAddRole = false; } }}>Add</button>
          <button onclick={() => { showAddRole = false; newRoleName = ''; }}>Cancel</button>
        </div>
      </div>
    {:else}
      <button class="btn-add-role" onclick={() => (showAddRole = true)}>+ Add Role</button>
    {/if}
  </fieldset>

  <!--
    Both routine types that can form a cohort, plus any routine that already
    carries a config. `compileSessionDesign` puts `matching` on a
    `routine-matching`, so gating on `routine-video-chat` alone hid the whole
    fieldset — strategy, seats, assignment and all — for every study built in
    the Session Designer. The trailing `routine.matching` clause keeps a
    hand-authored or imported config visible on whatever type carries it,
    rather than editable only by hand-editing JSON.
  -->
  {#if routine.type === "routine-video-chat" || routine.type === "routine-matching" || routine.matching}
    <fieldset>
      <legend>Matching</legend>
      <label>
        <span>Strategy</span>
        <select
          value={routine.matching?.strategy ?? "fifo"}
          onchange={(e) => {
            const strategy = e.currentTarget.value as MatchingConfig["strategy"];
            updateMatching(
              strategy === "property" ? { strategy, assignment: undefined } : { strategy },
            );
          }}
        >
          <option value="fifo">FIFO</option>
          <option value="property">Property</option>
          <option value="manual">Manual</option>
        </select>
      </label>
      <label>
        <span>Group Size (slots)</span>
        <input type="number" value={routine.matching?.slots.length ?? 0} min={MinSlotCount} max={MaxSlotCount} step="1" onchange={(e) => updateMatching({ slots: resizeSlots(routine.matching?.slots ?? [], parseInt(e.currentTarget.value)) })} />
      </label>

      <div class="slot-list">
        {#each routine.matching?.slots ?? [] as slot, i}
          <div class="slot-row">
            <span class="slot-index">{i}</span>
            <input
              type="text"
              placeholder={`seat-${i}`}
              value={slot.name}
              oninput={(e) => {
                const slots = [...(routine.matching?.slots ?? [])];
                slots[i] = { ...slots[i], name: e.currentTarget.value };
                updateMatching({ slots });
              }}
            />
          </div>
        {/each}
      </div>

      {#if (routine.matching?.slots.length ?? 0) < MinSlotCount}
        <p class="config-hint warn">Matching needs at least {MinSlotCount} slots — the server rejects joins to this routine.</p>
      {/if}
      {#if (routine.roles?.length ?? 0) > 0 && (routine.roles?.length ?? 0) < (routine.matching?.slots.length ?? 0)}
        <p class="config-hint warn">
          {routine.matching?.slots.length} slots but only {routine.roles?.length} role names — participants past
          role {(routine.roles?.length ?? 1) - 1} resolve to no role, and role-scoped elements will not reach them.
        </p>
      {/if}

      {#if (routine.matching?.strategy ?? "fifo") !== "property"}
        <label>
          <span>Role assignment</span>
          <select
            value={routine.matching?.assignment?.mode ?? "random"}
            onchange={(e) =>
              updateMatching({
                assignment:
                  e.currentTarget.value === "random"
                    ? { mode: "random" }
                    : { mode: "counterbalanced", set: "rotation", order: "sequential" },
              })}
          >
            <option value="random">Random</option>
            <option value="counterbalanced">Counterbalanced</option>
          </select>
        </label>

        {#if routine.matching?.assignment?.mode === "counterbalanced"}
          {@const cb = routine.matching.assignment}
          <label>
            <span>Permutations</span>
            <select value={cb.set} onchange={(e) => updateMatching({ assignment: { ...cb, set: e.currentTarget.value as "rotation" | "permutation" } })}>
              <option value="rotation">Rotation (Latin square)</option>
              <option value="permutation">Complete (all orderings)</option>
            </select>
          </label>
          <label>
            <span>Order</span>
            <select value={cb.order} onchange={(e) => updateMatching({ assignment: { ...cb, order: e.currentTarget.value as "sequential" | "block-shuffled" } })}>
              <option value="sequential">Sequential</option>
              <option value="block-shuffled">Shuffled within blocks</option>
            </select>
          </label>
        {/if}
      {/if}

      {#if routine.matching}
        <p class="config-hint">{describeAssignment(routine.matching)}</p>
        {@const refusal = validateRoleAssignment(routine.matching)}
        {#if refusal}
          <p class="config-hint warn">{refusal}</p>
        {/if}
      {/if}

      <label>
        <span>Timeout (seconds)</span>
        <input type="number" value={routine.matching?.timeout ?? DefaultMatchingTimeoutSeconds} min="0" step="1" oninput={(e) => updateMatching({ timeout: parseInt(e.currentTarget.value) })} />
      </label>
      {#if (routine.matching?.timeout ?? DefaultMatchingTimeoutSeconds) > MaxReasonableTimeoutSeconds}
        <p class="config-hint warn">Over an hour — a stranded participant waits about {Math.round((routine.matching?.timeout ?? 0) / SecondsPerHour)}h before the timeout fires.</p>
      {/if}
    </fieldset>
  {/if}

  <fieldset>
    <legend>Device</legend>
    <label>
      <span>Mode</span>
      <select value={routine.device?.mode ?? ""} onchange={(e) => { const v = e.currentTarget.value; updateDevice({ mode: v === "" ? null : v as "camera" | "controller" }); }}>
        <option value="">None</option>
        <option value="camera">Camera</option>
        <option value="controller">Controller</option>
      </select>
    </label>
    {#if routine.device?.mode}
      <label>
        <span>Required</span>
        <select value={routine.device?.required ? "true" : "false"} onchange={(e) => updateDevice({ required: e.currentTarget.value === "true" })}>
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      </label>
      {#if routine.device?.mode === "camera"}
        <label>
          <span>Camera Facing</span>
          <select value={routine.device?.cameraFacing ?? "user"} onchange={(e) => updateDevice({ cameraFacing: e.currentTarget.value as "user" | "environment" })}>
            <option value="user">User</option>
            <option value="environment">Environment</option>
          </select>
        </label>
      {/if}
    {/if}
  </fieldset>

  {#if routine.type === "routine-card"}
    <fieldset>
      <legend>Card Settings</legend>
      <label>
        <span>Width</span>
        <input type="text" value={cardConfig.width ?? "600px"} oninput={(e) => updateConfig({ width: e.currentTarget.value })} />
      </label>
      <label>
        <span>Padding</span>
        <input type="text" value={cardConfig.padding ?? "2rem"} oninput={(e) => updateConfig({ padding: e.currentTarget.value })} />
      </label>
      <label>
        <span>Next Button</span>
        <select value={cardConfig.nextButtonMode ?? "visible"} onchange={(e) => updateConfig({ nextButtonMode: e.currentTarget.value as NextButtonMode })}>
          <option value="visible">Visible</option>
          <option value="disabled">Disabled</option>
          <option value="hidden">Hidden</option>
        </select>
      </label>
      <label>
        <span>Next Label</span>
        <input type="text" value={cardConfig.nextLabel ?? "Next →"} oninput={(e) => updateConfig({ nextLabel: e.currentTarget.value })} />
      </label>
      <label>
        <span>Collect Data on Next</span>
        <select value={cardConfig.collectData ? "true" : "false"} onchange={(e) => updateConfig({ collectData: e.currentTarget.value === "true" })}>
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      </label>
    </fieldset>
  {:else if routine.type === "routine-consent"}
    <fieldset>
      <legend>Consent Settings</legend>
      <label>
        <span>Agree Label</span>
        <input type="text" value={consentConfig.agreeLabel ?? "I Agree"} oninput={(e) => updateConfig({ agreeLabel: e.currentTarget.value })} />
      </label>
      <label>
        <span>Disagree Label</span>
        <input type="text" value={consentConfig.disagreeLabel ?? "I Disagree"} oninput={(e) => updateConfig({ disagreeLabel: e.currentTarget.value })} />
      </label>
      <label>
        <span>Withdraw on Disagree</span>
        <select value={consentConfig.withdrawOnDisagree ? "true" : "false"} onchange={(e) => updateConfig({ withdrawOnDisagree: e.currentTarget.value === "true" })}>
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      </label>
    </fieldset>
  {:else if routine.type === "routine-end"}
    {@const finishMode = resolveFinishMode(endConfig)}
    <fieldset>
      <legend>End Settings</legend>
      <label>
        <span>Finish behaviour</span>
        <select
          value={finishMode}
          onchange={(e) => updateConfig({ finishMode: e.currentTarget.value as FinishMode })}
        >
          <option value="debrief">Debrief only</option>
          <option value="debrief-redirect">Debrief, then redirect</option>
          <option value="redirect-only">Redirect without debrief</option>
        </select>
      </label>
      {#if finishMode !== "redirect-only"}
        <label>
          <span>Message</span>
          <textarea rows="3" value={endConfig.message ?? ""} oninput={(e) => updateConfig({ message: e.currentTarget.value })}></textarea>
        </label>
      {/if}
      {#if finishMode !== "debrief"}
        <label>
          <span>Redirect URL</span>
          <input type="text" placeholder="https://app.prolific.com/submissions/complete?cc=..." value={endConfig.redirectUrl ?? ""} oninput={(e) => updateConfig({ redirectUrl: e.currentTarget.value || null })} />
        </label>
        {#if !endConfig.redirectUrl}
          <p class="config-hint warn">A redirect URL is required for this mode.</p>
        {/if}
      {/if}
      {#if finishMode === "redirect-only"}
        <p class="config-hint">Participants go straight to the URL on reaching this routine. No debrief is shown.</p>
      {/if}
    </fieldset>
  {:else if routine.type === "routine-pos-check"}
    <fieldset>
      <legend>Position Check Settings</legend>
      <label>
        <span>Mode</span>
        <select
          value={posCheckConfig.mode ?? "legacy"}
          onchange={(e) => updateConfig({ mode: e.currentTarget.value })}
        >
          <option value="legacy">Legacy (hands raised)</option>
          <option value="preset">Preset</option>
          <option value="custom">Custom Landmarks</option>
          <option value="distance">Distance (face ratio)</option>
        </select>
      </label>

      {#if posCheckConfig.mode === "preset"}
        <label>
          <span>Preset</span>
          <select
            value={posCheckConfig.preset ?? "face"}
            onchange={(e) => updateConfig({ preset: e.currentTarget.value })}
          >
            <option value="face">Face</option>
            <option value="upper-body">Upper Body</option>
            <option value="full-body">Full Body</option>
          </select>
        </label>
      {/if}

      {#if posCheckConfig.mode === "custom"}
        <label>
          <span>Landmark Indices (comma-separated)</span>
          <input
            type="text"
            value={(posCheckConfig.targetLandmarks ?? []).join(", ")}
            oninput={(e) => {
              const indices = e.currentTarget.value
                .split(",")
                .map((s) => parseInt(s.trim()))
                .filter((n) => !isNaN(n) && n >= 0 && n <= 32);
              updateConfig({ targetLandmarks: indices });
            }}
          />
          <span class="hint">0-10: face, 11-12: shoulders, 13-14: elbows, 15-16: wrists, 23-24: hips, 25-26: knees, 27-28: ankles</span>
        </label>
      {/if}

      {#if posCheckConfig.mode === "distance"}
        <label>
          <span>Min Face Ratio</span>
          <input
            type="number"
            value={posCheckConfig.faceRatioMin ?? 0.15}
            min="0"
            max="1"
            step="0.05"
            oninput={(e) => updateConfig({ faceRatioMin: parseFloat(e.currentTarget.value) })}
          />
        </label>
        <label>
          <span>Max Face Ratio</span>
          <input
            type="number"
            value={posCheckConfig.faceRatioMax ?? 0.25}
            min="0"
            max="1"
            step="0.05"
            oninput={(e) => updateConfig({ faceRatioMax: parseFloat(e.currentTarget.value) })}
          />
          <span class="hint">Face height as fraction of frame height (e.g., 0.15 = 15%)</span>
        </label>
      {/if}

      <label>
        <span>Confidence Threshold</span>
        <input
          type="number"
          value={posCheckConfig.confidenceThreshold ?? 0.6}
          min="0"
          max="1"
          step="0.05"
          oninput={(e) => updateConfig({ confidenceThreshold: parseFloat(e.currentTarget.value) })}
        />
      </label>
      <label>
        <span>Required Duration (ms)</span>
        <input
          type="number"
          value={posCheckConfig.requiredDuration ?? 3000}
          min="0"
          step="500"
          oninput={(e) => updateConfig({ requiredDuration: parseInt(e.currentTarget.value) })}
        />
      </label>
    </fieldset>
  {:else if routine.type === "routine-video-chat"}
    <fieldset>
      <legend>Video Chat Options</legend>
      <label>
        <span>Video Layout</span>
        <select value={resolveVideoLayout(videoChatConfig)} onchange={(e) => updateConfig({ videoLayout: e.currentTarget.value })}>
          <option value="auto">Automatic panel</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {#if resolveVideoLayout(videoChatConfig) === "custom"}
      <p class="hint">
        Participants see only the Video Chat elements on the canvas. Add one element for each video: set "self" for
        the participant and "partner" for the other person.
      </p>
      {:else}
      <p class="hint">The routine shows the videos in a panel next to the elements.</p>
      <label>
        <span>Card Title</span>
        <input
          type="text"
          value={videoChatConfig.cardTitle ?? ""}
          placeholder="{'{role}'} task"
          oninput={(e) => updateConfig({ cardTitle: e.currentTarget.value })}
        />
      </label>
      <p class="hint">
        The title above the elements. Write {"{role}"} to show each participant's role. Leave it empty to show no title.
      </p>
      <label>
        <span>Show Local Video</span>
        <select value={videoChatConfig.showLocalVideo !== false ? "true" : "false"} onchange={(e) => updateConfig({ showLocalVideo: e.currentTarget.value === "true" })}>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
      <label>
        <span>Record Local</span>
        <select value={videoChatConfig.recordLocal ? "true" : "false"} onchange={(e) => updateConfig({ recordLocal: e.currentTarget.value === "true" })}>
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      </label>
      <label>
        <span>Element Position</span>
        <select value={videoChatConfig.elementPosition ?? "left"} onchange={(e) => updateConfig({ elementPosition: e.currentTarget.value })}>
          <option value="left">Left</option>
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
        </select>
      </label>
      {/if}
    </fieldset>
  {:else if routine.type === "routine-survey"}
    <fieldset>
      <legend>Survey Settings</legend>
      <label>
        <span>Submit Label</span>
        <input
          type="text"
          value={surveyConfig.submitLabel ?? "Complete"}
          oninput={(e) => updateConfig({ submitLabel: e.currentTarget.value })}
        />
      </label>
      <label>
        <span>Progress Bar</span>
        <select
          value={surveyConfig.showProgressBar ?? "off"}
          onchange={(e) => updateConfig({ showProgressBar: e.currentTarget.value })}
        >
          <option value="off">Off</option>
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
        </select>
      </label>
      <label>
        <span>Width</span>
        <input
          type="text"
          value={surveyConfig.width ?? "700px"}
          oninput={(e) => updateConfig({ width: e.currentTarget.value })}
        />
      </label>
    </fieldset>

    <fieldset>
      <legend>Survey Questions</legend>
      <div class="survey-summary">
        <span class="survey-count">{surveyQuestionCount()} question{surveyQuestionCount() === 1 ? "" : "s"}</span>
        <button class="btn-edit-survey" onclick={() => (surveyModalOpen = true)}>
          Edit Survey
        </button>
      </div>
    </fieldset>
  {/if}
</div>

<div bind:this={modalPortal} style="display: contents;">
{#if surveyModalOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={() => (surveyModalOpen = false)}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-content" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <h3>Edit Survey</h3>
        <button class="modal-close" onclick={() => (surveyModalOpen = false)}>&times;</button>
      </div>

      <div class="modal-tabs">
        <button
          class="tab-btn"
          class:active={surveyTab === "builder"}
          onclick={() => (surveyTab = "builder")}
        >
          Builder
        </button>
        <button
          class="tab-btn"
          class:active={surveyTab === "json"}
          onclick={() => (surveyTab = "json")}
        >
          JSON
        </button>
      </div>

      <div class="modal-body">
        {#if surveyTab === "builder"}
          <SurveyQuestionBuilder
            surveyJson={surveyConfig.surveyJson ?? null}
            onchange={handleSurveyJsonChange}
          />
        {:else}
          <SurveyJsonEditor
            surveyJson={surveyConfig.surveyJson ?? null}
            onchange={handleSurveyJsonChange}
          />
        {/if}
      </div>

      <div class="modal-footer">
        <button class="btn-done" onclick={() => (surveyModalOpen = false)}>Done</button>
      </div>
    </div>
  </div>
{/if}
</div>

<style>
  .inspector {
    padding: 1rem;
    overflow-y: auto;
    height: 100%;
  }
  .inspector-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
  .inspector-header h4 { font-size: 14px; font-weight: 600; margin: 0; }
  label { display: block; margin-bottom: 0.5rem; }
  label span { display: block; font-size: 12px; font-weight: 500; margin-bottom: 0.15rem; color: var(--gray-700); }
  input[type="text"], input[type="number"], textarea, select { width: 100%; padding: 0.35rem 0.5rem; border: 1px solid var(--gray-200); border-radius: var(--radius); font-size: 13px; box-sizing: border-box; }
  input:focus, textarea:focus, select:focus { outline: none; border-color: var(--black); }
  fieldset { border: 1px solid var(--gray-200); border-radius: var(--radius); padding: 0.75rem; margin-top: 0.75rem; }
  legend { font-size: 12px; font-weight: 500; padding: 0 0.25rem; }
  p.hint { font-size: 11px; color: var(--gray-600); margin: 0 0 0.5rem; }
  .btn-danger { font-size: 11px; padding: 0.2rem 0.4rem; border: 1px solid var(--danger); color: var(--danger); border-radius: var(--radius); background: var(--white); cursor: pointer; }
  .role-item { display: flex; align-items: center; gap: 0.35rem; padding: 0.2rem 0; font-size: 12px; }
  .role-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .role-name { flex: 1; }
  .btn-remove { border: none; background: none; color: var(--danger); cursor: pointer; font-size: 14px; padding: 0 0.25rem; line-height: 1; }
  .add-role-form { margin-top: 0.35rem; }
  .add-role-form input { margin-bottom: 0.25rem; }
  .add-role-actions { display: flex; gap: 0.25rem; }
  .add-role-actions button { font-size: 11px; padding: 0.2rem 0.4rem; border: 1px solid var(--gray-200); border-radius: var(--radius); background: var(--white); cursor: pointer; }
  .btn-add-role { font-size: 11px; border: none; background: none; color: var(--gray-600); cursor: pointer; padding: 0.25rem 0; }
  .btn-add-role:hover { color: var(--black); }
  .survey-summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .survey-count { font-size: 12px; color: var(--gray-600); }
  .btn-edit-survey {
    font-size: 12px;
    padding: 0.35rem 0.75rem;
    border: 1px solid var(--black);
    border-radius: var(--radius);
    background: var(--black);
    color: var(--white);
    cursor: pointer;
  }
  .btn-edit-survey:hover { background: var(--gray-700); }

  /* Modal — :global because portal moves it to document.body */
  :global(.modal-backdrop) {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  :global(.modal-content) {
    background: #fff;
    border-radius: 6px;
    width: 720px;
    max-width: 90vw;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
  }
  :global(.modal-header) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--gray-200);
  }
  :global(.modal-header h3) { margin: 0; font-size: 16px; font-weight: 600; }
  :global(.modal-close) {
    border: none;
    background: none;
    font-size: 20px;
    cursor: pointer;
    color: var(--gray-600);
    padding: 0 0.25rem;
    line-height: 1;
  }
  :global(.modal-close:hover) { color: var(--black); }
  :global(.modal-tabs) {
    display: flex;
    gap: 0;
    padding: 0 1.25rem;
    border-bottom: 1px solid var(--gray-200);
  }
  :global(.tab-btn) {
    font-size: 12px;
    padding: 0.5rem 1rem;
    border: 1px solid var(--gray-200);
    border-bottom: none;
    border-radius: var(--radius) var(--radius) 0 0;
    background: var(--gray-50);
    cursor: pointer;
    color: var(--gray-600);
    margin-bottom: -1px;
  }
  :global(.tab-btn.active) {
    background: #fff;
    color: var(--black);
    font-weight: 500;
    border-bottom: 1px solid var(--white);
  }
  :global(.modal-body) {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem;
  }
  :global(.modal-footer) {
    display: flex;
    justify-content: flex-end;
    padding: 0.75rem 1.25rem;
    border-top: 1px solid var(--gray-200);
  }
  :global(.btn-done) {
    font-size: 13px;
    padding: 0.5rem 1.5rem;
    border: none;
    border-radius: var(--radius);
    background: var(--black);
    color: var(--white);
    cursor: pointer;
  }
  :global(.btn-done:hover) { background: var(--gray-700); }
  .owned-strip { display: flex; align-items: center; gap: 0.4rem; padding: 0.35rem 0.5rem; background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: var(--radius); margin-bottom: 0.75rem; }
  .owned-icon { flex-shrink: 0; }
  .owned-text { font-size: 11px; color: var(--gray-600); flex: 1; }
  .owned-open { font-size: 11px; color: var(--gray-600); background: none; border: none; padding: 0; cursor: pointer; text-decoration: underline; font-family: inherit; }
  .owned-open:hover { color: var(--black); }
  .config-hint {
    font-size: 12px;
    color: var(--gray-600);
    margin: 0.25rem 0 0;
  }
  .config-hint.warn {
    color: var(--accent);
  }
  .slot-list { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.5rem; }
  .slot-row { display: flex; align-items: center; gap: 0.35rem; }
  .slot-index { font-size: 11px; color: var(--gray-400); width: 1rem; }
  .slot-row input { flex: 1; padding: 0.3rem 0.4rem; border: 1px solid var(--gray-200); border-radius: var(--radius); font-size: 12px; }
</style>
