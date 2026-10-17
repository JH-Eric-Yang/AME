<script lang="ts">
  import type { ChatChannel, VideoChatParams } from "ame-shared";
  import { mediaChannels, tileChannels, tileMirror } from "ame-shared/videoChat";
  import { toggleChannel } from "$lib/admin/videoChatParams";
  import TextField from "../fields/TextField.svelte";
  import ToggleField from "../fields/ToggleField.svelte";

  let { params, onchange }: { params: VideoChatParams; onchange: (patch: Partial<VideoChatParams>) => void } = $props();

  const Channels: { value: ChatChannel; label: string }[] = [
    { value: "video", label: "Video" },
    { value: "audio", label: "Audio" },
    { value: "text", label: "Text chat" },
  ];

  const channels = $derived(tileChannels(params));
  const hasMedia = $derived(mediaChannels(params).length > 0);
</script>

<TextField
  label="Participant"
  value={params.participant}
  placeholder="partner"
  hint="self, partner, partner:2 or seat:3 — resolved per progress; checked in the Progress tab"
  onchange={(participant) => onchange({ participant: participant.trim() || undefined })}
/>
{#each Channels as channel (channel.value)}
  <ToggleField
    label={channel.label}
    checked={channels.includes(channel.value)}
    onchange={(on) => onchange({ channels: toggleChannel(channels, channel.value, on) })}
  />
{/each}
<ToggleField label="Mirror" checked={tileMirror(params)} onchange={(mirror) => onchange({ mirror })} />
<TextField label="Label (blank = hidden)" value={params.label} onchange={(label) => onchange({ label: label || undefined })} />
<ToggleField
  label="Record"
  checked={params.record ?? false}
  hint={hasMedia ? undefined : "Needs video or audio"}
  onchange={(record) => onchange({ record })}
/>
