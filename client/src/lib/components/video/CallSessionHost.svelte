<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { runner } from "$lib/stores/runner";
  import { callSession } from "$lib/webrtc/callSession";
  import { chatThread } from "$lib/chat/chatThread";
  import { EmptyPlan, planFor, tilesFor } from "$lib/webrtc/callPlan";

  /**
   * Feeds the routine on screen to the call session and the chat thread.
   * Mounted once above the routines, so consecutive routines that plan the same
   * call keep it: nothing is torn down between them, and a rotation arrives
   * as a new plan the session diffs against the live mesh.
   */

  const LiveStates = new Set(["RUNNING", "MATCHING"]);

  const live = $derived(LiveStates.has($runner.state));

  $effect(() => {
    callSession.setPlan(live ? planFor($runner) : EmptyPlan, $runner.participantId);
  });

  // A primitive per delivery, so the thread reopens (and re-asks for history)
  // exactly when a routine with a text tile is delivered — including a
  // re-delivery after a reconnect — and not on unrelated runner writes.
  const threadKey = $derived(
    live && tilesFor($runner).some((tile) => tile.text)
      ? `${$runner.progress}:${$runner.trial}:${$runner.routineStartTime}`
      : null,
  );

  $effect(() => {
    // untrack: the thread reopens on a new threadKey, not on any runner write.
    if (threadKey) chatThread.open(untrack(() => $runner.progress));
    else chatThread.close();
  });

  onDestroy(() => {
    callSession.stop();
    chatThread.close();
  });
</script>
