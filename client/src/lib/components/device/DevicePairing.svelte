<script lang="ts">
  import QRCode from "qrcode";
  import { runner } from "$lib/stores/runner";
  import { shouldPromptForPairing, buildControllerPairingUrl } from "$lib/device/pairingPrompt";

  const show = $derived(
    shouldPromptForPairing($runner.routine?.device, $runner.deviceConnected),
  );
  const url = $derived(
    buildControllerPairingUrl(
      window.location.origin,
      $runner.experimentId,
      $runner.participantId,
    ),
  );

  let qrDataUrl = $state("");

  $effect(() => {
    if (!show) return;
    // url is read inside so the effect re-runs (and regenerates) if it changes.
    QRCode.toDataURL(url, { width: 200, margin: 1 }).then((data) => {
      qrDataUrl = data;
    });
  });
</script>

{#if show}
  <div class="device-pairing" role="status">
    <p class="instructions">
      This routine uses your phone as a controller. Scan the code below with
      your phone to connect it, or open the link on your phone.
    </p>
    {#if qrDataUrl}
      <div class="qr-container">
        <img src={qrDataUrl} alt="Scan to pair your phone" />
      </div>
    {/if}
    <p class="url" aria-label="Pairing link">{url}</p>
  </div>
{/if}

<style>
  .device-pairing {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    padding: 1rem;
    border: 1px solid var(--black);
    border-radius: 6px;
    text-align: center;
  }
  .instructions {
    margin: 0;
    font-size: 14px;
    max-width: 28rem;
  }
  .qr-container img {
    width: 160px;
    height: 160px;
  }
  .url {
    margin: 0;
    font-size: 12px;
    font-family: monospace;
    word-break: break-all;
    user-select: all;
  }
</style>
