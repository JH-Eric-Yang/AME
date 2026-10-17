<script module lang="ts">
  import type { Component } from "svelte";
  import type { ElementConfig } from "ame-shared";

  type RendererComponent = Component<{ element: ElementConfig }>;

  let rendererPromise: Promise<RendererComponent> | null = null;

  /**
   * ElementRenderer, loaded lazily and exactly once for the whole canvas.
   *
   * The import has to be dynamic. The admin app is server-rendered (only the
   * participant runner and the device page set `ssr = false`), and
   * ElementRenderer's module graph reaches surveyjs-widgets — a webpack UMD
   * bundle over inputmask/bootstrap-slider that touches `self` at module
   * scope — and @mediapipe/tasks-vision. A static import here would evaluate
   * all of that during SSR and 500 every admin page. A dynamic import inside
   * an $effect only ever runs in the browser.
   */
  function loadRenderer(): Promise<RendererComponent> {
    rendererPromise ??= import("$lib/components/elements/ElementRenderer.svelte").then(
      (m) => m.default as RendererComponent,
    );
    return rendererPromise;
  }
</script>

<script lang="ts">
  import {
    hasVisualFootprint,
    missingContentParam,
    previewElement,
    previewSafety,
  } from "ame-shared/visibility";

  /**
   * What goes inside a canvas element box.
   *
   * The canvas mounts the participant's **real** component, through the same
   * ElementRenderer the runtime dispatches with, for every type that is safe
   * to mount. It used to draw hand-written lookalikes instead — a second
   * implementation of twenty components that could, and did, disagree with the
   * one participants actually see.
   *
   * Four kinds of box never get a live mount, and say why instead:
   *  - an element with no visual footprint, which draws nothing at runtime;
   *  - a type whose `onMount` touches the camera, microphone or MediaPipe —
   *    mounting one would switch the researcher's webcam on while they are
   *    laying out a screen;
   *  - a type whose `onMount` installs a listener or interval that fires real
   *    experiment events;
   *  - an element whose content parameter is still unset, which the real
   *    component correctly renders as an empty box, and which on a canvas is
   *    indistinguishable from a failed drop.
   * All of those rules live in `ame-shared/visibility`, stated once and tested.
   */
  let { element }: { element: ElementConfig } = $props();

  const safety = $derived(previewSafety(element.type));
  const footprint = $derived(hasVisualFootprint(element));
  const missing = $derived(missingContentParam(element));
  const live = $derived(footprint && safety === "safe" && missing === null);

  /** Why this box shows a panel rather than the element. */
  const NotMountedNote: Record<string, string> = {
    hardware: "needs camera or mic",
    "runtime-only": "runs during the experiment",
  };

  /** How each unset parameter reads to a researcher. */
  const MissingNote: Record<string, string> = {
    content: "no content yet",
    src: "no source yet",
    surveyJson: "no survey yet",
    options: "no options yet",
  };

  let Renderer = $state<RendererComponent | null>(null);
  $effect(() => {
    if (!live || Renderer) return;
    loadRenderer().then((c) => {
      Renderer = c;
    });
  });
</script>

{#if !footprint}
  <div class="panel">
    <span class="panel-type">{element.type}</span>
    <span class="panel-note">runs invisibly</span>
  </div>
{:else if safety !== "safe"}
  <div class="panel">
    <span class="panel-type">{element.type}</span>
    <span class="panel-note">{NotMountedNote[safety]}</span>
  </div>
{:else if missing}
  <div class="panel panel-missing">
    <span class="panel-type">{element.type}</span>
    <span class="panel-note">{MissingNote[missing] ?? `no ${missing} yet`}</span>
  </div>
{:else if Renderer}
  <!--
    inert + pointer-events: none is the whole interaction block.

    The mounted components are the real ones: they import fireElementEvents
    and would record responses and fire proceed/complete on a click or a
    change. `pointer-events: none` keeps the pointer out — and is what lets
    the click land on the card behind, which is where selection lives — while
    `inert` keeps Tab, typing and the accessibility tree out. Neither alone is
    enough: inert would swallow the click the canvas needs, and
    pointer-events would leave the subtree focusable.
  -->
  <div class="live" inert>
    <Renderer element={previewElement(element)} />
  </div>
{/if}

<style>
  .panel {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px;
    border: 1px dashed var(--gray-300);
    border-radius: var(--radius);
    background: var(--gray-50);
  }
  .panel-type {
    font-family: var(--font-display);
    font-size: 10px;
    color: var(--gray-600);
  }
  .panel-note {
    font-size: 10.5px;
    color: var(--gray-400);
  }
  /* Unset content is something to go and fix, not a fact about the type. */
  .panel-missing {
    border-color: var(--accent);
    background: var(--accent-dim);
  }
  .panel-missing .panel-note {
    color: var(--accent);
  }

  .live {
    width: 100%;
    height: 100%;
    /* See the markup comment — this half of the block also lets the click
       through to the card. */
    pointer-events: none;
    /* The same clip freeStyle applies to a free placement at runtime, so a box
       too small for its content shows the researcher exactly the clipping a
       participant gets. */
    overflow: hidden;
  }
</style>
