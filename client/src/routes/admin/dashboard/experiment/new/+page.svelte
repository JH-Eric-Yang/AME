<script lang="ts">
  import { goto } from "$app/navigation";
  import * as api from "$lib/api";

  let step = $state(1);
  let name = $state("");
  let description = $state("");
  let avCollection = $state(false);
  let bodyDetection = $state(false);
  let videoChat = $state(false);
  let supplementaryDevice = $state("NONE");
  let activeTime = $state(30);
  let rollBackTime = $state(60);
  let participantsPerSession = $state(1);
  let conditionsText = $state("");
  let randomization = $state(false);
  let matchingStrategy = $state("FIFO");
  let error = $state("");
  let loading = $state(false);

  async function handleCreate() {
    error = "";
    loading = true;
    try {
      const conditions = conditionsText
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);

      const result = await api.createExperiment({
        name,
        description,
        avCollection,
        bodyDetection,
        videoChat,
        supplementaryDevice,
        activeTime,
        rollBackTime,
        participantsPerSession,
        conditions,
        randomization,
        matchingStrategy,
        routines: [],
      });

      goto(`/admin/dashboard/experiment/${result.id}`);
    } catch (e) {
      error = e instanceof api.ApiError ? e.message : "Failed to create experiment";
    } finally {
      loading = false;
    }
  }
</script>

<div class="wizard">
  <h1>Create Experiment</h1>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if step === 1}
    <div class="step">
      <h2>Step 1: Basic Information</h2>
      <label>
        <span>Name *</span>
        <input type="text" bind:value={name} required />
      </label>
      <label>
        <span>Description</span>
        <textarea bind:value={description} rows="3"></textarea>
      </label>
      <button class="btn-primary" disabled={!name} onclick={() => (step = 2)}>Next →</button>
    </div>
  {:else if step === 2}
    <div class="step">
      <h2>Step 2: Capabilities</h2>
      <label class="checkbox">
        <input type="checkbox" bind:checked={avCollection} />
        <span>Audio/Video Collection</span>
      </label>
      <label class="checkbox">
        <input type="checkbox" bind:checked={bodyDetection} />
        <span>Body Detection</span>
      </label>
      <label class="checkbox">
        <input type="checkbox" bind:checked={videoChat} />
        <span>Video Chat</span>
      </label>
      <label>
        <span>Supplementary Device</span>
        <select bind:value={supplementaryDevice}>
          <option value="NONE">None</option>
          <option value="CAMERA">Camera</option>
          <option value="CONTROLLER">Controller</option>
        </select>
      </label>
      <div class="nav-buttons">
        <button onclick={() => (step = 1)}>← Back</button>
        <button class="btn-primary" onclick={() => (step = 3)}>Next →</button>
      </div>
    </div>
  {:else if step === 3}
    <div class="step">
      <h2>Step 3: Timing & Conditions</h2>
      <label>
        <span>Active Time (minutes)</span>
        <input type="number" bind:value={activeTime} min="1" />
      </label>
      <label>
        <span>Roll-Back Time (minutes)</span>
        <input type="number" bind:value={rollBackTime} min="1" />
      </label>
      <label>
        <span>Participants Per Session</span>
        <input type="number" bind:value={participantsPerSession} min="1" max="10" />
      </label>
      <label>
        <span>Conditions (comma-separated)</span>
        <input type="text" bind:value={conditionsText} placeholder="Control, Treatment A, Treatment B" />
      </label>
      <label class="checkbox">
        <input type="checkbox" bind:checked={randomization} />
        <span>Randomize routine order</span>
      </label>
      <label>
        <span>Default Matching Strategy</span>
        <select bind:value={matchingStrategy}>
          <option value="FIFO">FIFO</option>
          <option value="PROPERTY">Property-Based</option>
          <option value="MANUAL">Manual</option>
        </select>
      </label>
      <div class="nav-buttons">
        <button onclick={() => (step = 2)}>← Back</button>
        <button class="btn-primary" disabled={loading} onclick={handleCreate}>
          {loading ? "Creating..." : "Create Experiment"}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .wizard {
    max-width: 600px;
    margin: 0 auto;
    background: #fff;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
    padding: 2rem;
  }

  h1 {
    font-size: 24px;
    font-weight: 700;
    margin: 0 0 1.5rem;
  }

  h2 {
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 1rem;
    color: var(--gray-500);
  }

  .error {
    background: var(--danger-dim);
    border: 1px solid var(--danger);
    color: var(--danger);
    padding: 0.5rem;
    border-radius: var(--radius-sm);
    font-size: 14px;
    margin-bottom: 1rem;
  }

  label {
    display: block;
    margin-bottom: 1rem;
  }

  label span {
    display: block;
    font-size: 14px;
    font-weight: 500;
    margin-bottom: 0.25rem;
  }

  label.checkbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  label.checkbox span {
    margin-bottom: 0;
  }

  input[type="text"],
  input[type="number"],
  input[type="email"],
  textarea,
  select {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
    font-size: 14px;
    box-sizing: border-box;
  }

  input:focus,
  textarea:focus,
  select:focus {
    outline: none;
    border-color: var(--black);
  }

  .btn-primary {
    background: var(--black);
    color: #fff;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 14px;
    cursor: pointer;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .nav-buttons {
    display: flex;
    justify-content: space-between;
    margin-top: 1rem;
  }

  .nav-buttons button {
    padding: 0.5rem 1rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
    background: #fff;
    cursor: pointer;
    font-size: 14px;
  }
</style>
