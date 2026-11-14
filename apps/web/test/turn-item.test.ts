import { render, screen } from '@testing-library/svelte';
import { expect, test } from 'vitest';
import TurnItem from '../src/islands/TurnItem.svelte';

const five = 'One\n\nTwo\n\nThree\n\nFour\n\nFive';

test('renders Motion and Turn text literally', () => {
  const { container } = render(TurnItem, {
    phase: 'Opening',
    speaker: 'Fake A',
    side: 'for',
    text: '<script>alert(1)</script> &amp;\n\nSecond <b>para</b>',
    truncated: false,
  });
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('b')).toBeNull();
  const paras = container.querySelectorAll('article p');
  expect(paras).toHaveLength(2);
  expect(paras[0]?.textContent).toBe('<script>alert(1)</script> &amp;');
  expect(screen.getByText('AI-generated')).toBeInTheDocument();
});

test('names the speech by phase, speaker and Side', () => {
  render(TurnItem, { phase: 'Opening', speaker: 'Fake A', side: 'for', text: 'Short', truncated: false });
  expect(screen.getByRole('heading', { level: 3, name: 'Opening: Fake A, For' })).toBeInTheDocument();
});

test('shows two paragraphs and keeps the rest behind "Read the full speech"', () => {
  const { container } = render(TurnItem, { phase: 'Opening', speaker: 'Fake A', side: 'for', text: five, truncated: false });
  expect(container.querySelectorAll('article > p')).toHaveLength(2);
  const more = container.querySelector('details.more');
  expect(more?.querySelector('summary .when-closed')?.textContent).toBe('Read the full speech');
  expect(more?.querySelectorAll('p')).toHaveLength(3);
});

test('the summary stays in place once open, offering to show less', () => {
  const { container } = render(TurnItem, { phase: 'Opening', speaker: 'Fake A', side: 'for', text: five, truncated: false });
  expect(container.querySelector('details.more summary .when-open')?.textContent).toBe('Show less');
});

test('no "Read the full speech" for a short speech', () => {
  const { container } = render(TurnItem, { phase: 'Opening', speaker: 'Fake A', side: 'for', text: 'One\n\nTwo', truncated: false });
  expect(container.querySelector('details.more')).toBeNull();
});

test('notes a Turn cut off at the word limit outside the collapsed part', () => {
  const { container } = render(TurnItem, { phase: 'Closing', speaker: 'Fake B', side: 'against', text: five, truncated: true });
  const note = screen.getByText(/cut off at the word limit/i);
  expect(note.closest('details')).toBeNull();
  expect(note.parentElement).toBe(container.querySelector('article'));
});
