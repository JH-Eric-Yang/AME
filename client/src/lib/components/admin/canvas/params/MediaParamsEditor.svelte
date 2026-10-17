<script lang="ts">
  import type { VideoParams, AudioParams } from "ame-shared";
  import MediaSourceField from "../MediaSourceField.svelte";
  import ToggleField from "../fields/ToggleField.svelte";

  type Params = VideoParams | AudioParams;

  interface Props {
    params: Params;
    accept: "video" | "audio";
    experimentId: string;
    onchange: (patch: Partial<VideoParams>) => void;
  }

  let { params, accept, experimentId, onchange }: Props = $props();

  const video = $derived(accept === "video");
  const muted = $derived(video && ((params as VideoParams).muted ?? false));
  const autoplayHint = $derived(
    video
      ? "Browsers block autoplay with sound. Tick Muted, or the video will wait for a click."
      : "Browsers block autoplay with sound, so the audio will wait for a click.",
  );
</script>

<MediaSourceField src={params.src} {experimentId} {accept} onchange={(src) => onchange({ src })} />
<ToggleField
  label="Autoplay"
  hint={autoplayHint}
  checked={params.autoplay ?? false}
  onchange={(autoplay) => onchange({ autoplay })}
/>
<ToggleField label="Loop" checked={params.loop ?? false} onchange={(loop) => onchange({ loop })} />
<ToggleField label="Show controls" checked={params.controls ?? true} onchange={(controls) => onchange({ controls })} />
{#if video}
  <ToggleField label="Muted" checked={muted} onchange={(m) => onchange({ muted: m })} />
{/if}
