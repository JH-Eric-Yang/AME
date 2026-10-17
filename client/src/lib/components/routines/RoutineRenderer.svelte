<script lang="ts">
  import { runner } from "$lib/stores/runner";
  import RoutineBorderless from "./RoutineBorderless.svelte";
  import RoutineCard from "./RoutineCard.svelte";
  import RoutineConsent from "./RoutineConsent.svelte";
  import RoutineEnd from "./RoutineEnd.svelte";
  import RoutineEndMatching from "./RoutineEndMatching.svelte";
  import RoutineMatching from "./RoutineMatching.svelte";
  import RoutinePosCheck from "./RoutinePosCheck.svelte";
  import RoutineVideoChat from "./RoutineVideoChat.svelte";
  import RoutineSurvey from "./RoutineSurvey.svelte";
  import CohortSyncNotice from "./CohortSyncNotice.svelte";
  import UnresolvedRefsNotice from "./UnresolvedRefsNotice.svelte";
  import DevicePairing from "$lib/components/device/DevicePairing.svelte";
  import CallSessionHost from "$lib/components/video/CallSessionHost.svelte";
</script>

{#if $runner.routine}
  <!-- Above the routine rather than inside each one: every routine type in a
       session can hold at the proceed barrier. -->
  <CohortSyncNotice />
  <!-- Also above the routine: a controller-mode routine is unusable until the
       phone is paired, so the prompt must not be buried inside routine markup
       some routine types don't share. -->
  <DevicePairing />
  <!-- Also above the routine: any routine type can reference earlier data. -->
  <UnresolvedRefsNotice />
  <!-- Above the routine, and never keyed by it: the call outlives any one
       routine, so consecutive video routines keep their connections. -->
  <CallSessionHost />
  {#if $runner.routine.type === "routine-borderless"}
    <RoutineBorderless />
  {:else if $runner.routine.type === "routine-card"}
    <RoutineCard />
  {:else if $runner.routine.type === "routine-consent"}
    <RoutineConsent />
  {:else if $runner.routine.type === "routine-end"}
    <RoutineEnd />
  {:else if $runner.routine.type === "routine-end-matching"}
    <RoutineEndMatching />
  {:else if $runner.routine.type === "routine-matching"}
    <RoutineMatching />
  {:else if $runner.routine.type === "routine-pos-check"}
    <RoutinePosCheck />
  {:else if $runner.routine.type === "routine-video-chat"}
    <RoutineVideoChat />
  {:else if $runner.routine.type === "routine-survey"}
    <RoutineSurvey />
  {:else}
    <p>Unknown routine type: {$runner.routine.type}</p>
  {/if}
{/if}
