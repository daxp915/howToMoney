<script lang="ts">
  /**
   * A 44x26 on/off switch, accent when on. With `name` it posts like a
   * checkbox ("on" or nothing) from inside a form.
   */
  let {
    checked = $bindable(false),
    label,
    name,
    disabled = false,
    onchange
  }: {
    checked?: boolean;
    label: string;
    name?: string;
    disabled?: boolean;
    onchange?: (checked: boolean) => void;
  } = $props();

  function flip() {
    if (disabled) return;
    checked = !checked;
    onchange?.(checked);
  }
</script>

<button type="button" class="tg" class:on={checked} role="switch" aria-checked={checked} aria-label={label} {disabled} onclick={flip}
  ><span class="knob"></span></button
>{#if name && checked}<input type="hidden" {name} value="on" />{/if}

<style>
  .tg {
    position: relative;
    flex: 0 0 auto;
    width: 44px;
    height: 26px;
    min-height: 0;
    padding: 0;
    margin: 0;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--toggle-off);
    cursor: pointer;
    transition: background var(--step);
  }

  .tg:hover {
    background: var(--toggle-off);
  }

  .tg.on,
  .tg.on:hover {
    background: var(--accent);
  }

  .tg:active {
    transform: none;
  }

  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    transition: transform var(--step);
  }

  .on .knob {
    transform: translateX(18px);
  }

  .tg:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
