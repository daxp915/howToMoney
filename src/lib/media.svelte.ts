/**
 * Phone or desktop, by the app's one breakpoint (760px). For choosing between
 * components (Sheet vs DetailPanel), not for styling -- CSS media queries do
 * that. False on the server and until hydration: render the desktop shape,
 * then correct.
 */
import { MediaQuery } from 'svelte/reactivity';

export const phone = new MediaQuery('max-width: 760px', false);
