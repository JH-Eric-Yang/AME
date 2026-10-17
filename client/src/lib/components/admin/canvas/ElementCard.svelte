<script lang="ts">
  import type { ElementConfig } from "ame-shared";
  import ElementPreview from "./ElementPreview.svelte";
  import FamilyMark from "$lib/components/FamilyMark.svelte";
  import { familyOf } from "ame-shared/elementFamilies";

  interface Props {
    element: ElementConfig;
    elementIndex: number;
    selected: boolean;
    onselect: () => void;
    onremove: () => void;
    /**
     * Native HTML5 drag-and-drop, on by default for the flow grid's move/drop
     * path. FreeCanvas sets this false: it drives its own pointer-based move
     * and resize, and a live native drag on the same element would compete
     * with it for the pointer.
     */
    draggable?: boolean;
  }

  let { element, elementIndex, selected, onselect, onremove, draggable = true }: Props = $props();

  let dragging = $state(false);

  // Mirrors ElementConfig.showForRoles: empty/absent means everyone sees it.
  const roles = $derived(element.showForRoles ?? []);
  const audience = $derived(roles.length === 0 ? "both" : roles.join("+"));

  function handleDragStart(e: DragEvent) {
    const data = JSON.stringify({
      action: "move",
      elementIndex,
      fromRow: element.position?.row ?? 0,
      fromCol: element.position?.column ?? 0,
    });
    e.dataTransfer?.setData("application/json", data);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    dragging = true;
  }

  function handleDragEnd() {
    dragging = false;
  }

  function handleRemove(e: MouseEvent) {
    e.stopPropagation();
    onremove();
  }
</script>

<div
  class="element-card"
  class:selected
  class:dragging
  {draggable}
  ondragstart={draggable ? handleDragStart : undefined}
  ondragend={draggable ? handleDragEnd : undefined}
  onclick={onselect}
  role="button"
  tabindex="0"
  aria-label={element.name}
  title={element.name}
  onkeydown={(e) => { if (e.key === "Enter") onselect(); }}
>
  <div class="chrome">
    <FamilyMark family={familyOf(element.type)} />
    <span class="tag type-tag">{element.type}</span>
    <span class="tag audience-tag" class:shared={roles.length === 0}>{audience}</span>
  </div>
  <button type="button" class="remove" aria-label="Remove {element.type} element" onclick={handleRemove}>
    <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
      <path d="M6 6l12 12" /><path d="M18 6L6 18" />
    </svg>
  </button>

  <!--
    The participant's own component, mounted for real — see ElementPreview for
    which types are safe to mount, and for the panel the rest get instead. The
    "no source set" marker this card used to paint over media lives there too
    now, as one rule covering every unset content parameter rather than src
    alone.
  -->
  <div class="preview">
    <ElementPreview {element} />
  </div>
</div>

<style>
  .element-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.4rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    cursor: grab;
    background: var(--white);
    user-select: none;
    transition: opacity var(--transition), border-color var(--transition);
  }
  .element-card:hover { border-color: var(--black); }
  .element-card:hover .remove { opacity: 1; }
  .element-card.selected { border-color: var(--black); box-shadow: inset 0 0 0 0.5px var(--black); background: var(--gray-50); }
  .element-card.selected .type-tag { background: var(--black); color: var(--white); }
  .element-card.dragging { opacity: 0.3; }

  .chrome { display: flex; align-items: center; gap: 5px; }
  .tag {
    font-family: var(--font-display);
    font-size: 9px;
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    line-height: 1.5;
  }
  .type-tag { background: var(--gray-100); color: var(--gray-600); }
  .audience-tag { background: var(--accent-dim); color: var(--accent); }
  .audience-tag.shared { background: var(--gray-100); color: var(--gray-500); }

  .remove {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    padding: 0;
    background: var(--white);
    border: 1px solid var(--gray-200);
    border-radius: 50%;
    color: var(--gray-500);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--transition);
    z-index: 1;
  }
  .remove:hover { border-color: var(--black); color: var(--black); }

  /*
    The preview takes whatever room the card has left, and clips.

    Two callers want different things from "whatever room": in free mode the
    card is stretched to the participant's own box, so the preview must fill
    it exactly and clip exactly as `freeStyle`'s `overflow: hidden` does at
    runtime — FreeCanvas lifts the max-height for that. The flow grid has no
    such box, so an unclamped survey or a tall image would set the row height;
    there the clamp stands, as it did when these previews were hand-drawn.
  */
  .preview {
    flex: 1;
    min-width: 0;
    min-height: 0;
    max-height: 160px;
    overflow: hidden;
  }
</style>
