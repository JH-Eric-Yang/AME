<script lang="ts">
  import type { ElementType } from "ame-shared";
  import { canRenderOnHandset } from "ame-shared/surfaces";
  import { Families, FamilyLabel, familyOf, type ElementFamily } from "ame-shared/elementFamilies";
  import FamilyMark from "$lib/components/FamilyMark.svelte";

  interface PaletteItem {
    type: ElementType;
    label: string;
  }

  let { surface = "screen" }: { surface?: "screen" | "device" } = $props();

  const barred = (type: ElementType) => surface === "device" && !canRenderOnHandset(type);

  /** Palette order inside each family. Labels are the short names on the tiles. */
  const PaletteItems: PaletteItem[] = [
    { type: "text", label: "Text" },
    { type: "image", label: "Image" },
    { type: "video", label: "Video" },
    { type: "audio", label: "Audio" },
    { type: "video-chat", label: "Video Chat" },
    { type: "button", label: "Button" },
    { type: "recorder", label: "Recorder" },
    { type: "multi-capture", label: "Multi-Capture" },
    { type: "input-textfield", label: "Text Field" },
    { type: "input-select", label: "Select" },
    { type: "input-slider", label: "Slider" },
    { type: "input-option-group", label: "Options" },
    { type: "input-file-picker", label: "File Picker" },
    { type: "keyboard", label: "Keyboard" },
    { type: "survey", label: "Survey" },
    { type: "timer", label: "Timer" },
    { type: "body-detector", label: "Body Detect" },
    { type: "volume-check", label: "Vol. Check" },
    { type: "speech-recognizer", label: "Speech Rec." },
    { type: "facial-expression-detector", label: "Face Expr." },
  ];

  const itemsOf = (family: ElementFamily) => PaletteItems.filter((item) => familyOf(item.type) === family);

  function handleDragStart(e: DragEvent, type: ElementType) {
    if (barred(type)) {
      e.preventDefault();
      return;
    }
    e.dataTransfer?.setData("application/json", JSON.stringify({ action: "new", elementType: type }));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
  }
</script>

<div class="palette">
  <h4 class="palette-title">Elements</h4>
  {#each Families as family}
    <div class="palette-group">
      <span class="group-label">{FamilyLabel[family]}</span>
      {#each itemsOf(family) as item}
        <div
          class="palette-item"
          class:barred={barred(item.type)}
          draggable={!barred(item.type)}
          title={barred(item.type) ? "The phone's camera is busy in capture mode" : item.label}
          ondragstart={(e) => handleDragStart(e, item.type)}
          role="listitem"
        >
          <FamilyMark {family} />
          <span>{item.label}</span>
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .palette { padding: 0.75rem; }
  .palette-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.5rem; color: var(--gray-600); }
  .palette-group { margin-bottom: 0.75rem; }
  .group-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--gray-400); display: block; margin-bottom: 0.25rem; }
  .palette-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.5rem;
    font-size: 12px;
    border-radius: var(--radius-sm);
    margin-bottom: 0.15rem;
    cursor: grab;
    color: var(--gray-700);
    user-select: none;
    transition: background var(--transition);
  }
  .palette-item:hover { background: var(--gray-50); color: var(--black); }
  .palette-item:active { cursor: grabbing; }
  .palette-item.barred { opacity: 0.4; cursor: not-allowed; }
  .palette-item.barred:hover { background: none; }
</style>
