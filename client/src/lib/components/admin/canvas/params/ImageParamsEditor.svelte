<script lang="ts">
  import type { ImageParams } from "ame-shared";
  import MediaSourceField from "../MediaSourceField.svelte";
  import TextField from "../fields/TextField.svelte";
  import SelectField from "../fields/SelectField.svelte";

  interface Props {
    params: ImageParams;
    experimentId: string;
    /** In free layout the box sets the size, so width/height are not offered. */
    freeMode: boolean;
    onchange: (patch: Partial<ImageParams>) => void;
  }

  let { params, experimentId, freeMode, onchange }: Props = $props();

  const FitOptions = [
    { value: "contain", label: "Contain" },
    { value: "cover", label: "Cover" },
    { value: "fill", label: "Fill" },
  ];
</script>

<MediaSourceField src={params.src} {experimentId} accept="image" onchange={(src) => onchange({ src })} />
<TextField label="Alt text" value={params.alt} onchange={(alt) => onchange({ alt: alt || undefined })} />
{#if !freeMode}
  <TextField label="Width (CSS, e.g. 300px or 50%)" value={params.width} onchange={(width) => onchange({ width: width || undefined })} />
  <TextField label="Height (CSS, e.g. 200px)" value={params.height} onchange={(height) => onchange({ height: height || undefined })} />
{/if}
<SelectField
  label="Fit"
  value={params.objectFit ?? "contain"}
  options={FitOptions}
  hint="Applies only when a width or height is set — an image at its natural size has nothing to fit."
  onchange={(objectFit) => onchange({ objectFit })}
/>
