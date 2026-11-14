import { fireEvent, render, screen } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';
import AccountActions from '../src/islands/AccountActions.svelte';

function responder(responses: Record<string, Response>) {
  const paths: string[] = [];
  const fetcher = vi.fn(async (url: string) => {
    paths.push(url);
    const response = responses[url];
    if (!response) throw new Error(`unexpected ${url}`);
    return response;
  }) as unknown as typeof fetch;
  return { fetcher, paths };
}

async function confirmDelete() {
  await fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
  await fireEvent.click(screen.getByRole('checkbox', { name: /cannot be undone/i }));
  await fireEvent.click(screen.getByRole('button', { name: 'Delete my account permanently' }));
}

test('deletes after confirmation', async () => {
  const { fetcher, paths } = responder({ '/api/auth/delete-user': Response.json({ success: true }) });
  const navigate = vi.fn();
  render(AccountActions, { fetcher, navigate });
  await confirmDelete();
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
  expect(paths).toEqual(['/api/auth/delete-user']);
});

test('does not delete without confirmation', async () => {
  const { fetcher } = responder({});
  render(AccountActions, { fetcher, navigate: vi.fn() });
  await fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
  expect(screen.getByRole('button', { name: 'Delete my account permanently' })).toBeDisabled();
  expect(fetcher).not.toHaveBeenCalled();
});

test('asks to sign in again when the session is too old to delete', async () => {
  const { fetcher, paths } = responder({
    '/api/auth/delete-user': Response.json({ code: 'SESSION_EXPIRED', message: 'Session expired' }, { status: 400 }),
    '/api/auth/sign-in/social': Response.json({ url: 'https://github.com/login/oauth/authorize?x' }),
  });
  const navigate = vi.fn();
  render(AccountActions, { fetcher, navigate });
  await confirmDelete();
  expect(await screen.findByRole('alert')).toHaveTextContent(/sign in again/i);
  // The disabled delete button had focus: it moves on to the one way forward.
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sign in again' })));
  await fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?x'));
  expect(paths).toEqual(['/api/auth/delete-user', '/api/auth/sign-in/social']);
});

test('shows other deletion errors', async () => {
  const { fetcher } = responder({ '/api/auth/delete-user': Response.json({ code: 'X', message: 'Something broke' }, { status: 500 }) });
  render(AccountActions, { fetcher, navigate: vi.fn() });
  await confirmDelete();
  expect(await screen.findByRole('alert')).toHaveTextContent('Something broke');
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('alert')));
});

test('moves focus to the confirmation, and back to Delete on Cancel', async () => {
  render(AccountActions, { fetcher: responder({}).fetcher, navigate: vi.fn() });
  await fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
  // The button that had focus is gone: focus goes to the next decision, not the top of the page.
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: /cannot be undone/i })));
  await fireEvent.click(screen.getByRole('checkbox', { name: /cannot be undone/i }));
  await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete my account' })));
  // Starting again asks for the confirmation again.
  await fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
  expect(screen.getByRole('button', { name: 'Delete my account permanently' })).toBeDisabled();
});

test('the final delete is drawn as destructive', async () => {
  render(AccountActions, { fetcher: responder({}).fetcher, navigate: vi.fn() });
  await fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
  expect(screen.getByRole('button', { name: 'Delete my account permanently' })).toHaveClass('danger');
});
