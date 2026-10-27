/**
 * Every email the app sends, drawn one way -- one shared renderer. Each email is a Home hero in miniature: the
 * wordmark, a card with a status-tinted hero tile (icon, pill, heading, the
 * duration as a figure, a day or half-hour strip), then the body (lead, item
 * rows, a numbered "What to do", one button) and a quiet footer.
 *
 * Built from fields, never from pre-written text, so the HTML and the text
 * part cannot say different things. Imported by the app (`$lib/alertPlan`)
 * *and* by the relay Worker (`workers/feedback/`), so it imports nothing.
 *
 * Email HTML is its own dialect: tables for layout, every style inline, hex
 * colours (no oklch), no web fonts, images only as hosted PNGs. The card keeps
 * a 1px border because Gmail drops the shadow.
 *
 * `npm run email:preview` writes every kind to an HTML file to look at.
 */

export type MailTone = 'over' | 'watch' | 'ok' | 'neutral';
type Tick = 'ok' | 'over' | 'watch';

export interface MailLink {
  label: string;
  url: string;
}

export interface MailItem {
  title: string;
  /** "Since Oct 5 · 2 days" */
  meta?: string;
  detail?: string;
  /** A bank's initials tile, as in Settings › Connections. */
  monogram?: string;
  /** Or a numbered circle. */
  num?: string;
  /** Right-hand status pill (or the tick's alt text). */
  pill?: string;
  tone?: MailTone;
  /** A tick image instead of the pill. */
  tick?: Tick;
  /** A mono chip under the detail: `docker ps`. */
  code?: string;
}

export type MailTimeline =
  | {
      kind: 'days';
      /** Oldest first; `miss` takes the email's tone, `good` is neutral. */
      cells: ('good' | 'miss' | 'ok' | 'gap' | 'today')[];
      labels: string[];
      caption?: string;
    }
  | {
      kind: 'hours';
      /** Half-hour blocks, oldest first. */
      cells: ('heard' | 'quiet' | 'back')[];
      start: string;
      end: string;
      caption?: string;
    };

export interface MailNote {
  lead?: string;
  text: string;
  tone?: Tick;
}

export interface MailDoc {
  /** The inbox preview line. */
  preheader: string;
  tone: MailTone;
  /** Header label, right: "Connections", "Server watch", "Help report". */
  eyebrow: string;
  /** The hero's pill: "Needs you", "Fixed". */
  status?: string;
  /** Otherwise the icon follows the tone. */
  icon?: 'server-quiet' | 'server-back';
  heading: string;
  /** The hero number: "2 days" + "since Oct 5". */
  figure?: { value: string; unit: string };
  /** Shown when there is no figure, and the text part's fallback. */
  meta?: string;
  timeline?: MailTimeline;
  lead?: string;
  /** A Help report's message, in a tile. */
  message?: string;
  items?: MailItem[];
  itemsLabel?: string;
  /** Numbered "What to do". */
  steps?: string[];
  stepsLabel?: string;
  /** Key/value rows: a report's page and sender. */
  context?: [string, string][];
  /** Monospace block: a report's JSON context. */
  code?: string;
  /** The one button. */
  action?: MailLink;
  /** A text link beside it, or the only action. */
  secondary?: MailLink;
  note?: MailNote;
  /** Why this arrived and how often. */
  footer: string;
  /** "Email settings" in the footer. */
  settingsUrl?: string;
}

export interface RenderOptions {
  /** `<title>`: the subject. */
  subject?: string;
  /** Where the icons are hosted, ending in a slash. */
  assetBase?: string;
}

/** The relay Worker serves `workers/feedback/public/email/`. Point this at your
 *  own Worker's URL after deploying it (see workers/feedback/README.md). */
export const EMAIL_ASSET_BASE = 'https://howtomoney-feedback.example.workers.dev/email/';

/* v2 tokens as hex, light. */
const C = {
  bg: '#f5f5f3',
  surface: '#ffffff',
  line: '#e6e6e2',
  ink: '#141518',
  ink2: '#55575e',
  ink3: '#6f7178',
  pill: '#f0f0ed',
  field: '#f5f5f3',
  track: '#dcdcd8',
  accent: '#4758d4',
  accentInk: '#ffffff',
  accentText: '#3d4bc6'
};
/* ...and dark (Apple Mail, iPhone Mail), applied by the <style> block below. */
const D = {
  bg: '#0c0d10',
  surface: '#16171b',
  line: '#2a2b31',
  ink: '#f3f3f5',
  ink2: '#b4b6bd',
  ink3: '#90939a',
  pill: '#22232a',
  field: '#0c0d10',
  track: '#34363c',
  accent: '#7e96fb',
  accentInk: '#0c0d10',
  accentText: '#94abff'
};
const TONE_D: Record<MailTone, { solid: string; text: string; soft: string }> = {
  over: { solid: '#f66d67', text: '#ffa8a0', soft: '#542523' },
  watch: { solid: '#f8c655', text: '#fcd176', soft: '#46350d' },
  ok: { solid: '#51c672', text: '#7cdd93', soft: '#193b22' },
  neutral: { solid: '#90939a', text: '#b4b6bd', soft: '#22232a' }
};
const TONE: Record<MailTone, { solid: string; text: string; soft: string }> = {
  over: { solid: '#de3b3d', text: '#9b1e22', soft: '#ffe5e1' },
  watch: { solid: '#ecae30', text: '#784900', soft: '#ffecc1' },
  ok: { solid: '#36a558', text: '#005725', soft: '#d8f9dd' },
  neutral: { solid: '#6f7178', text: '#55575e', soft: '#f0f0ed' }
};

const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Roboto Mono',monospace";

const ICON: Record<MailTone | 'server-quiet' | 'server-back', { file: string; alt: string }> = {
  over: { file: 'icon-over.png', alt: 'Needs you' },
  watch: { file: 'icon-watch.png', alt: 'Reminder' },
  ok: { file: 'icon-ok.png', alt: 'Fixed' },
  neutral: { file: 'icon-report.png', alt: 'Report' },
  'server-quiet': { file: 'icon-server-quiet.png', alt: 'Server quiet' },
  'server-back': { file: 'icon-server-back.png', alt: 'Server back' }
};
const TICK: Record<Tick, string> = { ok: 'tick-ok.png', over: 'tick-over.png', watch: 'tick-watch.png' };

export const escapeHtml = (s: string | null | undefined) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const esc = escapeHtml;

const TABLE = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';
/*
 * Every coloured or phone-sized element carries a class. Light values are
 * inline (all Gmail sees); the one <style> block re-colours for dark mode in
 * the clients that honour prefers-color-scheme, and resizes below 480px.
 * Gmail ignores the dark query and shows the light email: that is expected.
 */
const TONES: MailTone[] = ['over', 'watch', 'ok', 'neutral'];

function styleBlock(): string {
  const dark = [
    `.e-bg{background:${D.bg}!important}`,
    `.e-card{background:${D.surface}!important;border-color:${D.line}!important;box-shadow:0 1px 2px rgba(0,0,0,.4)!important}`,
    `.e-ink{color:${D.ink}!important}`,
    `.e-ink2{color:${D.ink2}!important}`,
    `.e-ink3{color:${D.ink3}!important}`,
    `.e-line{border-color:${D.line}!important}`,
    `.e-pill{background:${D.pill}!important}`,
    `.e-field{background:${D.field}!important}`,
    `.e-surface{background:${D.surface}!important}`,
    `.e-step{background:${D.ink}!important;color:${D.surface}!important}`,
    `.e-btn{background:${D.accent}!important}`,
    `.e-btn-a{color:${D.accentInk}!important}`,
    `.e-link{color:${D.accentText}!important}`,
    `.e-good{background:${D.ink3}!important}`,
    `.e-gap{background:${D.track}!important}`,
    `.e-ok{background:${TONE_D.ok.solid}!important}`,
    ...TONES.flatMap((k) => [
      `.e-soft-${k}{background:${TONE_D[k].soft}!important}`,
      `.e-text-${k}{color:${TONE_D[k].text}!important}`,
      `.e-solid-${k}{background:${TONE_D[k].solid}!important}`,
      `.e-ring-${k}{border-color:${TONE_D[k].solid}!important}`
    ])
  ];
  const phone = [
    '.e-page{padding:20px 16px 32px!important}',
    '.e-cardpad{padding:6px!important}',
    '.e-hero{padding:24px 20px 22px!important}',
    '.e-body{padding:24px 20px 26px!important}',
    '.e-icon-td{width:48px!important}',
    '.e-icon{width:48px!important;height:48px!important}',
    '.e-g22{height:18px!important}',
    '.e-g26{height:22px!important}',
    '.e-h1{font-size:24px!important}',
    '.e-figwrap{margin-top:14px!important}',
    '.e-fig{font-size:40px!important}',
    '.e-unit{font-size:16px!important}',
    '.e-dot{width:12px!important;height:12px!important}',
    '.e-dot-today{width:8px!important;height:8px!important}',
    '.e-blk{height:20px!important}',
    '.e-msg{padding:16px 18px!important}'
  ];
  return `@media (prefers-color-scheme: dark){${dark.join('')}}@media (max-width: 480px){${phone.join('')}}`;
}

const label = (s: string) =>
  `<div class="e-ink3" style="font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:${C.ink3};">${esc(s)}</div>`;

/** A status pill: tone text on the tone's soft colour, or on the surface (the hero's). */
const pillTag = (s: string, tone: MailTone, onSurface = false) =>
  `<span class="e-text-${tone} ${onSurface ? 'e-surface' : `e-soft-${tone}`}" style="display:inline-block;font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;color:${TONE[tone].text};background:${onSurface ? C.surface : TONE[tone].soft};border-radius:999px;padding:4px 10px;white-space:nowrap;">${esc(s)}</span>`;

const gap = (n: number, cls = '') =>
  `<div${cls ? ` class="${cls}"` : ''} style="height:${n}px;line-height:0;font-size:0;">&nbsp;</div>`;

function timeline(tl: MailTimeline, tone: MailTone): string {
  const t = TONE[tone];
  if (tl.kind === 'days') {
    // miss = this email's tone; good = neutral ink-3 (or green on fixed emails)
    // Equal columns: left to the table, "Today" widens its own.
    const w = `width="${(100 / tl.cells.length).toFixed(2)}%"`;
    const dot = (s: string) => {
      if (s === 'today')
        return `<td align="center" ${w} style="padding:0;"><div class="e-dot-today e-ring-${tone}" style="width:10px;height:10px;border-radius:999px;background:transparent;border:2px solid ${t.solid};font-size:0;line-height:0;">&nbsp;</div></td>`;
      const [cls, bg] =
        s === 'miss' ? [`e-solid-${tone}`, t.solid] : s === 'ok' ? ['e-ok', TONE.ok.solid] : s === 'gap' ? ['e-gap', C.track] : ['e-good', C.ink3];
      return `<td align="center" ${w} style="padding:0;"><div class="e-dot ${cls}" style="width:14px;height:14px;border-radius:999px;background:${bg};font-size:0;line-height:0;">&nbsp;</div></td>`;
    };
    const last = tl.labels.length - 1;
    return (
      gap(26, 'e-g26') +
      `<table ${TABLE}><tr>${tl.cells.map(dot).join('')}</tr>` +
      `<tr>${tl.labels
        .map(
          (l, i) =>
            `<td align="center" ${w} class="${i === last ? 'e-ink' : 'e-ink3'}" style="padding-top:8px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:${i === last ? 600 : 400};color:${i === last ? C.ink : C.ink3};">${esc(l)}</td>`
        )
        .join('')}</tr></table>` +
      (tl.caption
        ? `<div class="e-ink2" style="padding-top:12px;font-family:${FONT};font-size:13px;line-height:1.45;color:${C.ink2};">${esc(tl.caption)}</div>`
        : '')
    );
  }
  // Hours: a segmented strip. Quiet is the tone's red, or the track on "back".
  const n = tl.cells.length;
  const block = (s: string) =>
    s === 'quiet' ? (tone === 'ok' ? ['e-gap', C.track] : [`e-solid-${tone}`, t.solid]) : s === 'back' ? ['e-ok', TONE.ok.solid] : ['e-good', C.ink3];
  const cells = tl.cells
    .map((s, i) => {
      const [cls, bg] = block(s);
      return `<td width="${(100 / n).toFixed(2)}%" style="padding:0 ${i === n - 1 ? 0 : 2}px 0 0;"><div class="e-blk ${cls}" style="height:24px;border-radius:4px;background:${bg};font-size:0;line-height:0;">&nbsp;</div></td>`;
    })
    .join('');
  return (
    gap(26, 'e-g26') +
    `<table ${TABLE}><tr>${cells}</tr></table>` +
    `<table ${TABLE}><tr><td class="e-ink3" style="padding-top:8px;font-family:${FONT};font-size:12px;line-height:16px;color:${C.ink3};">${esc(tl.start)}</td>` +
    `<td align="right" class="e-ink" style="padding-top:8px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;color:${C.ink};">${esc(tl.end)}</td></tr></table>` +
    (tl.caption
      ? `<div class="e-ink2" style="padding-top:10px;font-family:${FONT};font-size:13px;line-height:1.45;color:${C.ink2};">${esc(tl.caption)}</div>`
      : '')
  );
}

function items(doc: MailDoc, img: string): string {
  const rows = (doc.items ?? []).map((it, i) => {
    const bt = i ? `border-top:1px solid ${C.line};` : '';
    const line = i ? ' class="e-line"' : '';
    const lead = it.monogram
      ? `<td width="36"${line} style="width:36px;vertical-align:top;padding:14px 0 14px 14px;${bt}"><div class="e-pill e-ink2" style="width:36px;height:36px;line-height:36px;border-radius:10px;background:${C.pill};text-align:center;font-family:${FONT};font-size:12px;font-weight:600;color:${C.ink2};">${esc(it.monogram)}</div></td>`
      : it.num
        ? `<td width="28"${line} style="width:28px;vertical-align:top;padding:15px 0 14px 16px;${bt}"><div class="e-pill e-ink" style="width:26px;height:26px;line-height:26px;border-radius:999px;background:${C.pill};text-align:center;font-family:${FONT};font-size:13px;font-weight:600;color:${C.ink};">${esc(it.num)}</div></td>`
        : '';
    const right = it.pill
      ? `<td align="right"${line} style="vertical-align:top;padding:16px 14px 14px 8px;${bt}">${
          it.tick
            ? `<img src="${img}${TICK[it.tick]}" width="20" height="20" alt="${esc(it.pill)}" style="display:inline-block;border:0;vertical-align:middle;">`
            : pillTag(it.pill, it.tone ?? doc.tone)
        }</td>`
      : '';
    return (
      `<tr>${lead}<td${line} style="vertical-align:top;padding:14px 4px 14px 12px;${bt}font-family:${FONT};">` +
      `<div class="e-ink" style="font-size:16px;line-height:1.35;font-weight:500;color:${C.ink};">${esc(it.title)}</div>` +
      (it.meta ? `<div class="e-ink3" style="margin-top:2px;font-size:13px;line-height:1.4;color:${C.ink3};">${esc(it.meta)}</div>` : '') +
      (it.detail ? `<div class="e-ink2" style="margin-top:6px;font-size:14px;line-height:1.5;color:${C.ink2};">${esc(it.detail)}</div>` : '') +
      (it.code
        ? `<div style="margin-top:8px;"><span class="e-pill e-ink" style="display:inline-block;font-family:${MONO};font-size:13px;line-height:18px;color:${C.ink};background:${C.pill};border-radius:6px;padding:2px 8px;">${esc(it.code)}</span></div>`
        : '') +
      `</td>${right}</tr>`
    );
  });
  return `<table ${TABLE} class="e-line" style="border:1px solid ${C.line};border-radius:14px;border-collapse:separate;">${rows.join('')}</table>`;
}

function body(doc: MailDoc, img: string): string {
  let b = '';
  if (doc.lead)
    b += `<p class="e-ink" style="margin:0;font-family:${FONT};font-size:16px;line-height:1.6;color:${C.ink};">${esc(doc.lead)}</p>`;
  if (doc.message)
    b += `<div class="e-msg e-field e-ink" style="background:${C.field};border-radius:14px;padding:20px 22px;font-family:${FONT};font-size:17px;line-height:1.55;color:${C.ink};white-space:pre-wrap;">${esc(doc.message)}</div>`;
  if (doc.items?.length) {
    if (b) b += gap(20);
    if (doc.itemsLabel) b += label(doc.itemsLabel) + gap(10);
    b += items(doc, img);
  }
  if (doc.steps?.length) {
    // 24px under whatever is above; nothing when the steps open the body (a reminder).
    b += (b ? gap(24) : '') + label(doc.stepsLabel ?? 'What to do') + gap(12);
    b +=
      `<table ${TABLE}>` +
      doc.steps
        .map(
          (s, i) =>
            `<tr><td width="26" style="width:26px;vertical-align:top;padding:${i ? 12 : 0}px 0 0 0;"><div class="e-step" style="width:26px;height:26px;line-height:26px;border-radius:999px;background:${C.ink};text-align:center;font-family:${FONT};font-size:13px;font-weight:600;color:${C.surface};">${i + 1}</div></td>` +
            `<td class="e-ink" style="vertical-align:top;padding:${i ? 14 : 2}px 0 0 12px;font-family:${FONT};font-size:16px;line-height:1.5;color:${C.ink};">${esc(s)}</td></tr>`
        )
        .join('') +
      `</table>`;
  }
  if (doc.context?.length) {
    b +=
      gap(20) +
      `<table ${TABLE}>` +
      doc.context
        .map(
          ([k, v]) =>
            `<tr><td width="64" class="e-line e-ink3" style="width:64px;vertical-align:top;padding:8px 0;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:14px;line-height:1.45;color:${C.ink3};">${esc(k)}</td>` +
            `<td class="e-line e-ink" style="vertical-align:top;padding:8px 0 8px 12px;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:14px;line-height:1.45;color:${C.ink};word-break:break-word;">${esc(v)}</td></tr>`
        )
        .join('') +
      `</table>`;
  }
  if (doc.code)
    b +=
      gap(16) +
      `<div class="e-field e-line e-ink2" style="background:${C.field};border:1px solid ${C.line};border-radius:12px;padding:14px 16px;font-family:${MONO};font-size:12px;line-height:1.6;color:${C.ink2};white-space:pre-wrap;word-break:break-word;">${esc(doc.code)}</div>`;
  if (doc.action || doc.secondary) {
    b += gap(28);
    // A "bulletproof" button: the padded cell is the button. Inline, so the
    // secondary link sits beside it on desktop and wraps under on a phone.
    if (doc.action)
      b +=
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;vertical-align:middle;margin:0 20px 12px 0;"><tr>` +
        `<td class="e-btn" style="background:${C.accent};border-radius:999px;"><a href="${esc(doc.action.url)}" class="e-btn-a" style="display:inline-block;padding:14px 24px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:${C.accentInk};text-decoration:none;border-radius:999px;">${esc(doc.action.label)}</a></td></tr></table>`;
    if (doc.secondary)
      b += `<a href="${esc(doc.secondary.url)}" class="e-link" style="display:inline-block;vertical-align:middle;margin:0 0 12px 0;padding:0;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:${C.accentText};text-decoration:none;">${esc(doc.secondary.label)}&nbsp;›</a>`;
  }
  if (doc.note)
    b +=
      gap(doc.action || doc.secondary ? 12 : 20) +
      `<table ${TABLE}><tr><td class="e-field" style="background:${C.field};border-radius:12px;padding:12px 14px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td width="20" style="width:20px;vertical-align:top;padding-top:1px;"><img src="${img}${TICK[doc.note.tone ?? 'watch']}" width="20" height="20" alt="" style="display:block;border:0;"></td>` +
      `<td class="e-ink2" style="padding-left:10px;font-family:${FONT};font-size:14px;line-height:1.5;color:${C.ink2};">${doc.note.lead ? `<span class="e-ink" style="font-weight:600;color:${C.ink};">${esc(doc.note.lead)}</span> ` : ''}${esc(doc.note.text)}</td>` +
      `</tr></table></td></tr></table>`;
  return b;
}

function html(doc: MailDoc, opts: RenderOptions): string {
  const img = opts.assetBase ?? EMAIL_ASSET_BASE;
  const tone: MailTone = TONE[doc.tone] ? doc.tone : 'neutral';
  const t = TONE[tone];
  const icon = ICON[doc.icon ?? tone];

  let hero =
    `<table ${TABLE}><tr>` +
    `<td width="56" class="e-icon-td" style="width:56px;vertical-align:middle;"><img src="${img}${icon.file}" width="56" height="56" alt="${esc(icon.alt)}" class="e-icon" style="display:block;width:56px;height:56px;border:0;"></td>` +
    `<td style="vertical-align:middle;padding-left:14px;">${doc.status ? pillTag(doc.status, tone, true) : ''}</td></tr></table>` +
    gap(22, 'e-g22') +
    `<h1 class="e-h1 e-ink" style="margin:0;font-family:${FONT};font-size:28px;line-height:1.22;font-weight:600;letter-spacing:-.01em;color:${C.ink};">${esc(doc.heading)}</h1>`;
  if (doc.figure)
    hero +=
      `<div class="e-figwrap e-ink" style="margin-top:18px;font-family:${FONT};color:${C.ink};">` +
      `<span class="e-fig" style="font-size:52px;line-height:1.05;font-weight:500;letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap;">${esc(doc.figure.value)}</span>` +
      `<span class="e-unit e-ink2" style="font-size:18px;line-height:1.3;font-weight:400;color:${C.ink2};">&nbsp; ${esc(doc.figure.unit)}</span></div>`;
  else if (doc.meta)
    hero += `<div class="e-ink2" style="margin-top:12px;font-family:${FONT};font-size:15px;line-height:1.45;color:${C.ink2};">${esc(doc.meta)}</div>`;
  if (doc.timeline) hero += timeline(doc.timeline, tone);

  let rows = `<tr><td class="e-hero e-soft-${tone}" style="background:${t.soft};border-radius:14px;padding:32px 32px 28px;">${hero}</td></tr>`;
  const b = body(doc, img);
  if (b) rows += `<tr><td class="e-body" style="padding:28px 32px 32px;">${b}</td></tr>`;

  const card =
    `<table ${TABLE} class="e-card" style="background:${C.surface};border:1px solid ${C.line};border-radius:18px;border-collapse:separate;box-shadow:0 1px 2px rgba(20,21,24,.05),0 8px 24px rgba(20,21,24,.06);">` +
    `<tr><td class="e-cardpad" style="padding:8px;"><table ${TABLE}>${rows}</table></td></tr></table>`;
  const header =
    `<table ${TABLE}><tr>` +
    `<td class="e-ink" style="padding:0 6px 14px;font-family:${FONT};font-size:18px;line-height:24px;font-weight:600;letter-spacing:-.01em;color:${C.ink};">HTMFD</td>` +
    `<td align="right" style="padding:0 6px 14px;">${label(doc.eyebrow)}</td></tr></table>`;
  const footer =
    `<div class="e-ink3" style="padding:22px 8px 0;font-family:${FONT};font-size:13px;line-height:1.55;color:${C.ink3};">${esc(doc.footer)}` +
    (doc.settingsUrl
      ? ` <a href="${esc(doc.settingsUrl)}" class="e-link" style="color:${C.accentText};text-decoration:none;font-weight:500;white-space:nowrap;">Email settings</a>`
      : '') +
    `</div>`;
  // The inbox preview; the spacers stop the client pulling body text in after it.
  const pre = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(doc.preheader)}${'&#8199;&#847; '.repeat(40)}</div>`;

  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">` +
    `<title>${esc(opts.subject ?? doc.heading)}</title><style>${styleBlock()}</style></head>` +
    `<body class="e-bg" style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%;">${pre}` +
    `<table ${TABLE} class="e-bg" style="background:${C.bg};"><tr><td align="center" class="e-page" style="padding:32px 24px 48px;">` +
    `<table ${TABLE} style="max-width:560px;"><tr><td>${header}${card}${footer}</td></tr></table>` +
    `</td></tr></table></body></html>`
  );
}

function text(doc: MailDoc): string {
  const L: string[] = [doc.heading];
  if (doc.figure) L.push(`${doc.figure.value} ${doc.figure.unit}`);
  else if (doc.meta) L.push(doc.meta);
  L.push('');
  if (doc.lead) L.push(doc.lead, '');
  if (doc.message) L.push(doc.message, '');
  for (const it of doc.items ?? []) {
    L.push(`- ${it.title}${it.pill ? ` (${it.pill})` : ''}`);
    if (it.meta) L.push(`  ${it.meta}`);
    if (it.detail) L.push(`  ${it.detail}`);
    if (it.code) L.push(`  ${it.code}`);
  }
  if (doc.items) L.push('');
  if (doc.steps) {
    L.push(`${doc.stepsLabel ?? 'What to do'}:`);
    doc.steps.forEach((s, i) => L.push(`${i + 1}. ${s}`));
    L.push('');
  }
  for (const [k, v] of doc.context ?? []) L.push(`${k}: ${v}`);
  if (doc.code) L.push('', doc.code, '');
  if (doc.action) L.push(`${doc.action.label}: ${doc.action.url}`);
  if (doc.secondary) L.push(`${doc.secondary.label}: ${doc.secondary.url}`);
  if (doc.note) L.push('', `${doc.note.lead ? `${doc.note.lead} ` : ''}${doc.note.text}`);
  L.push('', '--', doc.footer + (doc.settingsUrl ? `\nEmail settings: ${doc.settingsUrl}` : ''));
  return L.join('\n');
}

export function renderEmail(doc: MailDoc, opts: RenderOptions = {}): { html: string; text: string } {
  return { html: html(doc, opts), text: text(doc) };
}
