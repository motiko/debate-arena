import { fireEvent, render, screen } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';
import SignInButton from '../src/islands/SignInButton.svelte';
import { t } from '../src/i18n/t';

test('navigates to GitHub after click', async () => {
  const navigate = vi.fn();
  const fetcher = vi.fn(async () => Response.json({ url: 'https://github.com/login/oauth/authorize?x' })) as unknown as typeof fetch;
  render(SignInButton, { callbackPath: '/new', navigate, fetcher });
  await fireEvent.click(screen.getByRole('button', { name: t('auth.signIn') }));
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?x'));
});

test('shows an error and lets the Viewer retry', async () => {
  const fetcher = vi.fn(async () => Response.json({ message: 'down' }, { status: 500 })) as unknown as typeof fetch;
  render(SignInButton, { callbackPath: '/', navigate: vi.fn(), fetcher });
  const button = screen.getByRole('button', { name: t('auth.signIn') });
  await fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent(t('auth.signInFailed'));
  expect(button).toBeEnabled();
});
