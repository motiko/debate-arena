<script module lang="ts">
  /** How many matches the list shows; the rest are counted. */
  export const PICKER_MAX_OPTIONS = 50;
</script>

<script lang="ts">
  // A searchable model picker: an ARIA 1.2 combobox with a list box. Closed, it shows the chosen model; typing
  // filters by name, id and provider (every word must match). Up to PICKER_MAX_OPTIONS matches are listed.
  import { matchesSearch } from '@debate-arena/api-client';
  import { t, tn } from '../i18n/t';
  import { formatPrice, providerName } from '../lib/debate';

  interface PickerModel {
    id: string;
    label: string;
    inputPerMTokUsd?: number;
    outputPerMTokUsd?: number;
  }

  interface Props {
    id: string;
    label: string;
    models: PickerModel[];
    /** A model id, 'api' (an API Debater) or '' (the platform chooses). */
    value: string;
    /** Offer an API Debater first. */
    allowApi?: boolean;
    /** Offer "the platform chooses" (value '') first, with this label. */
    autoLabel?: string;
    invalid?: boolean;
    describedBy?: string;
    /** Shown for a chosen value that is not among `models` (e.g. not available for a Slow Debate). */
    labelOf?: (value: string) => string;
    onchange?: (value: string) => void;
    input?: HTMLInputElement | undefined;
  }

  let {
    id,
    label,
    models,
    value,
    allowApi = false,
    autoLabel,
    invalid = false,
    describedBy,
    labelOf = v => v,
    onchange,
    input = $bindable(),
  }: Props = $props();

  interface Choice {
    value: string;
    name: string;
    /** Shown next to the name: what the model costs. */
    price?: string;
    detail: string;
  }

  let open = $state(false);
  let editing = $state(false);
  let query = $state('');
  let active = $state(-1);
  let announced = $state('');

  const apiChoice = $derived<Choice>({ value: 'api', name: t('new.api'), detail: '' });
  const autoChoice = $derived<Choice | null>(autoLabel ? { value: '', name: autoLabel, detail: '' } : null);
  const toChoice = (m: PickerModel): Choice => ({
    value: m.id,
    name: m.label,
    ...(m.inputPerMTokUsd === undefined || m.outputPerMTokUsd === undefined
      ? {}
      : { price: t('new.price', { input: formatPrice(m.inputPerMTokUsd), output: formatPrice(m.outputPerMTokUsd) }) }),
    detail: providerName(m.id),
  });

  const search = $derived(editing ? query : '');
  const matching = $derived(models.filter(m => matchesSearch(m, search, providerName(m.id))));
  const specials = $derived(
    [allowApi ? apiChoice : null, autoChoice].filter((c): c is Choice => c !== null && matchesSearch({ id: c.value, label: c.name }, search, '')),
  );
  const choices = $derived([...specials, ...matching.slice(0, PICKER_MAX_OPTIONS).map(toChoice)]);
  const more = $derived(Math.max(0, matching.length - PICKER_MAX_OPTIONS));

  const chosenName = $derived(
    value === 'api' && allowApi
      ? t('new.api')
      : value === '' && autoLabel
        ? autoLabel
        : (models.find(m => m.id === value)?.label ?? labelOf(value)),
  );

  const listId = $derived(`${id}-list`);
  const optionId = (index: number) => `${id}-option-${index}`;

  // The count is announced once typing settles, not on every keystroke.
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const count = matching.length;
    const typing = editing;
    clearTimeout(timer);
    if (!typing) return;
    timer = setTimeout(() => (announced = tn('new.matches', count)), 300);
    return () => clearTimeout(timer);
  });

  function close() {
    open = false;
    editing = false;
    query = '';
    active = -1;
  }

  function choose(choice: Choice) {
    close();
    if (choice.value !== value) onchange?.(choice.value);
  }

  function oninput(event: Event) {
    query = (event.currentTarget as HTMLInputElement).value;
    editing = true;
    open = true;
    active = -1;
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) open = true;
      else active = Math.min(active + 1, choices.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (event.key === 'Enter' && open) {
      // Never submit the form from an open list.
      event.preventDefault();
      const choice = choices[active] ?? (editing && choices.length > 0 ? choices[0] : undefined);
      if (choice) choose(choice);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    }
  }
</script>

<div class="picker">
  <label for={id}>{label}</label>
  <input
    {id}
    bind:this={input}
    type="text"
    role="combobox"
    autocomplete="off"
    spellcheck="false"
    aria-autocomplete="list"
    aria-expanded={open ? 'true' : 'false'}
    aria-controls={listId}
    aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
    aria-invalid={invalid ? 'true' : undefined}
    aria-describedby={describedBy || undefined}
    placeholder={t('new.search', { count: models.length })}
    value={editing ? query : chosenName}
    {oninput}
    {onkeydown}
    onfocus={event => (event.currentTarget as HTMLInputElement).select()}
    onclick={() => (open = true)}
    onblur={close}
  />
  <ul id={listId} role="listbox" aria-label={label} hidden={!open}>
    {#each choices as choice, index (choice.value)}
      <!-- mousedown, not click: it lands before the input's blur closes the list. -->
      <li
        id={optionId(index)}
        role="option"
        aria-selected={choice.value === value ? 'true' : 'false'}
        class:active={index === active}
        onmousedown={event => {
          event.preventDefault();
          choose(choice);
        }}
      >
        <span class="head"><span class="name">{choice.name}</span>{#if choice.price}<span class="price">{choice.price}</span>{/if}</span>
        {#if choice.detail}<span class="detail">{choice.detail}</span>{/if}
      </li>
    {/each}
    {#if choices.length === 0}<li class="note" role="presentation">{t('new.noMatches', { query })}</li>{/if}
    {#if more > 0}<li class="note" role="presentation">{t('new.moreMatches', { count: more })}</li>{/if}
  </ul>
  <p class="visually-hidden" role="status" id={`${id}-status`}>{announced}</p>
</div>

<style>
  .picker {
    position: relative;
  }
  label {
    display: block;
  }
  input {
    width: 100%;
  }
  ul {
    position: absolute;
    z-index: 10;
    left: 0;
    right: 0;
    margin: 0.25rem 0 0;
    padding: 0.25rem 0;
    list-style: none;
    max-height: min(22rem, 60vh);
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--line);
    box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 0.12);
  }
  ul[hidden] {
    display: none;
  }
  li[role='option'] {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
  }
  li[role='option']:hover,
  li.active {
    background: var(--for-tint);
    outline: 2px solid var(--focus, currentColor);
    outline-offset: -2px;
  }
  li[aria-selected='true'] .name {
    font-weight: 700;
  }
  /* The name and its price share a line; on a narrow screen the price wraps below the name. */
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    column-gap: 0.75rem;
  }
  .price {
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .detail,
  .note {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .note {
    padding: 0.5rem 0.75rem;
  }
</style>
