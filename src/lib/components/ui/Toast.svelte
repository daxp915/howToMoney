<script lang="ts">
  import { toast } from '$lib/toast.svelte';

  async function undo() {
    const t = toast.current;
    toast.dismiss();
    await t?.undo?.();
  }
</script>

{#if toast.current}
  {#key toast.current.id}
    <div class="toast" role="status">
      <span>{toast.current.text}</span>
      {#if toast.current.undo}<button type="button" onclick={undo}>Undo</button>{/if}
    </div>
  {/key}
{/if}

<style>
  .toast {
    position: fixed;
    left: 50%;
    bottom: 32px;
    transform: translateX(-50%);
    z-index: 80;
    display: flex;
    align-items: center;
    gap: 14px;
    max-width: calc(100vw - 32px);
    padding: 10px 10px 10px 18px;
    border-radius: var(--r-pill);
    background: var(--tip-bg);
    color: var(--tip-ink);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
    font-size: 14px;
    font-weight: 500;
    line-height: normal;
    animation: up 200ms ease-out;
  }

  button {
    min-height: 0;
    padding: 6px 12px;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--tip-ink);
    color: var(--tip-bg);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  button:hover {
    background: var(--tip-ink);
    filter: brightness(0.92);
  }

  @keyframes up {
    from {
      transform: translate(-50%, 12px);
      opacity: 0;
    }
  }

  @media (max-width: 760px) {
    .toast {
      bottom: calc(96px + env(safe-area-inset-bottom));
    }
  }
</style>
