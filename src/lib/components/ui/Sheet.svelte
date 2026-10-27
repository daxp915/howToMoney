<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * The phone's bottom sheet: scrim, radius 28, a 40x5 grip, two heights.
   * `medium` (~470px) keeps the list in view; `large` (~800px, never past the
   * status bar) holds the details. Drag the grip up for large, down to step
   * back down or close; Esc and the scrim close it. Slides in over 250ms.
   */
  let {
    open,
    detent = $bindable('medium'),
    onclose,
    label,
    children
  }: {
    open: boolean;
    detent?: 'medium' | 'large';
    onclose: () => void;
    label: string;
    children: Snippet;
  } = $props();

  let startY: number | null = null;
  let dy = $state(0);

  function down(e: PointerEvent) {
    startY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    if (startY === null) return;
    dy = e.clientY - startY;
  }

  function up() {
    if (startY === null) return;
    const d = dy;
    startY = null;
    dy = 0;
    if (d < -50) detent = 'large';
    else if (d > 60) {
      if (detent === 'large') detent = 'medium';
      else onclose();
    }
  }

  function key(e: KeyboardEvent) {
    if (open && e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={key} />

{#if open}
  <button class="scrim" type="button" aria-label="Close" onclick={onclose}></button>
  <div
    class="sheet {detent}"
    role="dialog"
    aria-modal="true"
    aria-label={label}
    style={dy ? `transform: translateY(${Math.max(dy, -40)}px); transition: none` : ''}
  >
    <div
      class="grip-zone"
      role="presentation"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
    >
      <span class="grip"></span>
    </div>
    <div class="content">{@render children()}</div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: var(--scrim);
    animation: fade 250ms ease-out;
  }

  .scrim:hover {
    background: var(--scrim);
  }

  .scrim:active {
    transform: none;
  }

  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 61;
    display: flex;
    flex-direction: column;
    background: var(--surface-sheet);
    border-radius: var(--r-phone-sheet) var(--r-phone-sheet) 0 0;
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.12);
    padding-bottom: env(safe-area-inset-bottom);
    animation: rise 250ms ease-out;
    transition:
      height 250ms ease-out,
      transform 250ms ease-out;
    line-height: normal;
  }

  .medium {
    height: min(470px, calc(100dvh - 60px));
  }

  .large {
    height: min(800px, calc(100dvh - 44px));
  }

  .grip-zone {
    flex: 0 0 auto;
    display: flex;
    justify-content: center;
    padding: 10px 0 8px;
    touch-action: none;
    cursor: grab;
  }

  .grip {
    width: 40px;
    height: 5px;
    border-radius: var(--r-pill);
    background: var(--grip);
  }

  .content {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 20px 20px;
    display: flex;
    flex-direction: column;
  }

  @keyframes rise {
    from {
      transform: translateY(100%);
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
