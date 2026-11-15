<script lang="ts">
  // API tokens (GLOSSARY) for the CLI: create (the key is shown once), list and revoke.
  import { onMount, tick } from 'svelte';
  import { t } from '../i18n/t';
  import { formatDate } from '../lib/format';
  import {
    createToken,
    listTokens,
    MAX_TOKEN_NAME_LENGTH,
    revokeToken,
    TOKEN_EXPIRY_DAYS,
    type ApiToken,
    type TokenExpiryDays,
  } from '../lib/tokens';

  interface Props {
    fetcher?: typeof fetch;
  }

  let { fetcher = fetch }: Props = $props();

  let tokens = $state<ApiToken[]>([]);
  let loaded = $state(false);
  let name = $state('');
  let days = $state<TokenExpiryDays>(90);
  let newKey = $state('');
  let confirmingId = $state<string | null>(null);
  let pending = $state(false);
  let error = $state('');
  let nameInput: HTMLInputElement | undefined = $state();
  let keyInput: HTMLInputElement | undefined = $state();
  let errorLine: HTMLElement | undefined = $state();

  const message = (e: unknown) => (e instanceof Error && e.message ? e.message : t('tokens.failed'));

  async function refresh() {
    tokens = await listTokens(fetcher);
    loaded = true;
  }

  // Runs a request; on failure shows its message and moves focus to it.
  async function attempt(action: () => Promise<void>) {
    pending = true;
    error = '';
    try {
      await action();
    } catch (e) {
      error = message(e);
      await tick();
      errorLine?.focus();
    }
    pending = false;
  }

  // The first load does not block creating a token.
  onMount(() => {
    refresh().catch(e => {
      error = message(e);
    });
  });

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim() || pending) return;
    await attempt(async () => {
      const created = await createToken(name.trim(), days, fetcher);
      newKey = created.key;
      name = '';
      await tick();
      keyInput?.select();
      keyInput?.focus();
      await refresh();
    });
  }

  async function done() {
    newKey = '';
    await tick();
    nameInput?.focus();
  }

  async function revoke(id: string) {
    await attempt(async () => {
      await revokeToken(id, fetcher);
      confirmingId = null;
      await refresh();
      await tick();
      nameInput?.focus();
    });
  }
</script>

<section class="tokens panel stack" aria-labelledby="tokens-title">
  <h2 id="tokens-title">{t('tokens.title')}</h2>
  <p class="muted">{t('tokens.explain')}</p>

  {#if loaded && tokens.length === 0}
    <p>{t('tokens.none')}</p>
  {:else if tokens.length > 0}
    <ul class="list">
      {#each tokens as token (token.id)}
        <li class="token">
          <div>
            <strong>{token.name}</strong>
            {#if token.start}<code>{t('tokens.start', { start: token.start })}</code>{/if}
            <span class="muted">
              {token.expiresAt ? t('tokens.expires', { date: formatDate(token.expiresAt) }) : t('tokens.neverExpires')} ·
              {token.lastRequest ? t('tokens.lastUsed', { date: formatDate(token.lastRequest) }) : t('tokens.neverUsed')}
            </span>
          </div>
          <div class="actions">
            {#if confirmingId === token.id}
              <button
                type="button"
                class="danger"
                aria-label={t('tokens.revokeFinalLabel', { name: token.name })}
                disabled={pending}
                onclick={() => revoke(token.id)}>{t('tokens.revokeFinal')}</button
              >
              <button type="button" class="secondary" disabled={pending} onclick={() => (confirmingId = null)}>{t('account.cancel')}</button>
            {:else}
              <button type="button" class="secondary" aria-label={t('tokens.revokeLabel', { name: token.name })} onclick={() => (confirmingId = token.id)}
                >{t('tokens.revoke')}</button
              >
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if newKey}
    <div class="new stack">
      <label for="new-token">{t('tokens.new')}</label>
      <input id="new-token" type="text" readonly value={newKey} bind:this={keyInput} spellcheck="false" autocomplete="off" />
      <p>{t('tokens.newHint')}</p>
      <p><button type="button" class="secondary" onclick={done}>{t('tokens.done')}</button></p>
    </div>
  {:else}
    <form class="stack" onsubmit={create}>
      <div class="field">
        <label for="token-name">{t('tokens.name')}</label>
        <input
          id="token-name"
          type="text"
          required
          maxlength={MAX_TOKEN_NAME_LENGTH}
          aria-describedby="token-name-hint"
          bind:value={name}
          bind:this={nameInput}
        />
        <p id="token-name-hint" class="muted">{t('tokens.nameHint')}</p>
      </div>
      <div class="field">
        <label for="token-expiry">{t('tokens.expiry')}</label>
        <select id="token-expiry" bind:value={days}>
          {#each TOKEN_EXPIRY_DAYS as option (option)}
            <option value={option}>{t('tokens.days', { count: option })}</option>
          {/each}
        </select>
      </div>
      <p><button type="submit" disabled={pending} aria-busy={pending}>{t('tokens.create')}</button></p>
    </form>
  {/if}

  {#if error}<p role="alert" class="error" tabindex="-1" bind:this={errorLine}>{error}</p>{/if}
</section>

<style>
  /* The island's wrapper is display: contents, so the page's flow spacing does not reach this section. */
  .tokens {
    margin-top: calc(var(--space) * 2);
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .token {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    padding-block: 0.75rem;
    border-bottom: 1px solid var(--rule, currentColor);
  }
  .token div:first-child {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: baseline;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .field {
    display: grid;
    gap: 0.25rem;
  }
  #new-token {
    font-family: var(--font-mono, monospace);
    width: 100%;
  }
</style>
