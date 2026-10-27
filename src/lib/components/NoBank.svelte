<script lang="ts">
  import Btn from '$lib/components/ui/Btn.svelte';
  import Card from '$lib/components/ui/Card.svelte';

  /**
   * A money page with no account linked yet: the page's own
   * shape with nothing in it, and the one button that fills it -- not a
   * generic "No accounts connected" paragraph.
   */
  let { figure = '$—', unit = '' }: { figure?: string; unit?: string } = $props();
</script>

<Card pad="hero">
  <div class="nb">
    <div class="fig"><span class="faint">{figure}</span>{#if unit}{' '}<span class="unit">{unit}</span>{/if}</div>
    <p>Connect a bank and this fills in within about a minute.</p>
    <div class="acts">
      <Btn variant="primary" full href="/settings/connections">Connect a bank</Btn>
      <a class="import" href="/settings/import">Import a file</a>
    </div>
  </div>
</Card>

<style>
  .nb {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
    line-height: normal;
  }

  .fig {
    font-size: var(--fs-hero);
    font-weight: 500;
    letter-spacing: var(--ls-hero);
  }

  .faint {
    color: var(--ink-3);
  }

  .unit {
    font-weight: 400;
    color: var(--ink-2);
  }

  p {
    margin: 0;
    max-width: 320px;
    font-size: 15px;
    color: var(--ink-2);
  }

  .acts {
    width: 100%;
    max-width: 320px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    margin-top: 12px;
    padding-top: 16px;
    border-top: 1px dashed var(--line);
  }

  /* A class, not `a:not([class])`: Svelte's scoping class is a class, so that
     selector never matched and the link fell back to the hero's size. */
  .import {
    font-size: 14px;
    font-weight: 500;
    color: var(--accent-text);
    text-decoration: none;
  }
</style>
