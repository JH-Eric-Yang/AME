<script lang="ts">
  import { page } from "$app/stores";
  import { experiment } from "$lib/stores/experiment";
  import { participantLink, idParamHint, linkWarnings } from "$lib/admin/participantLink";
  import CopyLinkButton from "./CopyLinkButton.svelte";

  const link = $derived(participantLink($page.url.origin, $experiment.id));
  const hint = $derived(idParamHint($experiment.participantIdParam));
  const warnings = $derived(
    linkWarnings({ visible: $experiment.visible, allowNew: $experiment.allowNew, dirty: $experiment.dirty }),
  );
</script>

<section class="link-bar" aria-label="Participant link">
  <div class="row">
    <span class="label">Participant link</span>
    <code class="link">{link}</code>
    <CopyLinkButton text={link} />
    <a class="open" href={link} target="_blank" rel="noopener">Open</a>
  </div>
  {#if hint}<p class="note">{hint}</p>{/if}
  {#each warnings as warning (warning)}
    <p class="note warning" role="status">{warning}</p>
  {/each}
</section>

<style>
  .link-bar { border: 1px solid var(--gray-200); border-radius: var(--radius); padding: 8px 12px; margin-bottom: 1rem; font-size: 12px; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .label { font-family: var(--font-display); font-weight: 600; color: var(--gray-600); }
  .link { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 12px; }
  .open { font-size: 12px; padding: 0.25rem 0.6rem; border: 1px solid var(--gray-200); border-radius: var(--radius); color: var(--black); text-decoration: none; }
  .open:hover { border-color: var(--black); }
  .note { margin: 6px 0 0; color: var(--gray-600); }
  .note.warning { color: var(--black); font-weight: 600; }
  .note.warning::before { content: "⚠ "; }
</style>
