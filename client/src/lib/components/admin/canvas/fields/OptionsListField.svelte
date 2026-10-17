<script lang="ts">
  import "./fields.css";
  import { untrack } from "svelte";
  import { parseOptionLines, formatOptionLines, keepOptionText, type OptionLine } from "$lib/admin/optionLines";

  interface Props {
    label: string;
    value: OptionLine[] | undefined;
    rows?: number;
    onchange: (options: OptionLine[]) => void;
  }

  let { label, value, rows = 5, onchange }: Props = $props();

  // The researcher's own text. It loads again only when `value` gives other
  // options, for example when another element is selected.
  let text = $state(untrack(() => formatOptionLines(value)));
  $effect(() => {
    const next = keepOptionText(untrack(() => text), value);
    if (next !== untrack(() => text)) text = next;
  });

  function onInput(e: Event & { currentTarget: HTMLTextAreaElement }): void {
    text = e.currentTarget.value;
    onchange(parseOptionLines(text));
  }
</script>

<div class="el-field">
  <label>
    <span>{label} (one per line, as value|label)</span>
    <textarea {rows} value={text} oninput={onInput}></textarea>
  </label>
</div>
