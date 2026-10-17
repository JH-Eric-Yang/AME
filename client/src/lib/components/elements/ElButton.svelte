<script lang="ts">
  import type { ElementConfig, ButtonParams } from "ame-shared";
  import { runner } from "$lib/stores/runner";
  import { recordAndFire } from "$lib/elements/fireEvents";
  import { answersExhausted, submitsRoutine } from "$lib/elements/elementEvents";

  /** justify-content for each authored alignment. */
  const AlignToJustify = { left: "flex-start", center: "center", right: "flex-end" } as const;

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as ButtonParams);
  const spent = $derived(answersExhausted(element, $runner.responses));
  // Once the routine has been handed in, this button has nothing left to do.
  // `proceedRequested` is set the moment the participant submits and cleared
  // when the next routine's content arrives, so in a matched session the button
  // stays inert for exactly as long as the cohort keeps them waiting.
  const submitted = $derived(submitsRoutine(element, "click") && $runner.proceedRequested);

  function handleClick() {
    const value = p.value ?? true;
    recordAndFire(element, "click", value);
  }
</script>

<div class="el-button" style="justify-content: {AlignToJustify[p.align ?? 'center']};">
  <button
    class="btn"
    class:primary={p.style === "primary" || !p.style}
    class:secondary={p.style === "secondary"}
    class:danger={p.style === "danger"}
    class:small={p.size === "small"}
    class:large={p.size === "large"}
    disabled={(p.disabled ?? false) || spent || submitted}
    onclick={handleClick}
  >
    {p.label ?? "Continue"}
  </button>
</div>

<style>
  .el-button { display: flex; justify-content: center; margin: 0.5rem 0; }
  .btn {
    padding: 0.75rem 2rem;
    border: none;
    border-radius: var(--radius);
    font-size: 14px;
    font-weight: 600;
    font-family: var(--font-body);
    cursor: pointer;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .small { padding: 0.5rem 1.25rem; font-size: 13px; }
  .large { padding: 1rem 2.75rem; font-size: 16px; }
  .primary { background: var(--black); color: var(--white); }
  .secondary { background: #fff; color: var(--black); border: 1.5px solid var(--black); }
  .danger { background: var(--danger); color: #fff; }
</style>
