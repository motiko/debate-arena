import { render, screen } from '@testing-library/svelte';
import { expect, test } from 'vitest';
import TurnItem from '../src/islands/TurnItem.svelte';

// A greeting, a one-line promise, then three paragraphs of argument (40 words each).
const argument = Array.from({ length: 40 }, () => 'word').join(' ');
const five = ['Madam Chair, judges.', 'Let me set out why.', argument, argument, argument].join('\n\n');

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

test('shows the speech up to its first argument and keeps the rest behind "Read the full speech"', () => {
  const { container } = render(TurnItem, { phase: 'Opening', speaker: 'Fake A', side: 'for', text: five, truncated: false });
  // Greeting, promise and two paragraphs of argument: about 60 words in view.
  expect(container.querySelectorAll('article > p')).toHaveLength(4);
  const more = container.querySelector('details.more');
  expect(more?.querySelector('summary .when-closed')?.textContent).toBe('Read the full speech');
  expect(more?.querySelectorAll('p')).toHaveLength(1);
});

test('renders *emphasis* and **strong** text, never the asterisks', () => {
  const { container } = render(TurnItem, { phase: 'Rebuttal', speaker: 'Fake A', side: 'for', text: 'Nuclear is the *only* route, **firmly**.', truncated: false });
  expect(container.querySelector('article em')?.textContent).toBe('only');
  expect(container.querySelector('article strong')?.textContent).toBe('firmly');
  expect(container.querySelector('article > p')?.textContent).toBe('Nuclear is the only route, firmly.');
});

test('the summary stays in place once open, offering to show less', () => {
  const { container } = render(TurnItem, { phase: 'Opening', speaker: 'Fake A', side: 'for', text: five, truncated: false });
  expect(container.querySelector('details.more summary .when-open')?.textContent).toBe('Show less');
});

test('no "Read the full speech" for a short speech', () => {
  const { container } = render(TurnItem, { phase: 'Opening', speaker: 'Fake A', side: 'for', text: 'One\n\nTwo', truncated: false });
  expect(container.querySelector('details.more')).toBeNull();
});

test('a draft shows all of its text, no disclosure, no cut note, and a caret', () => {
  const { container } = render(TurnItem, { phase: 'Opening', speaker: 'Fake A', side: 'for', text: five, truncated: false, draft: true });
  const article = container.querySelector('article')!;
  expect(article).toHaveClass('speech-draft');
  expect(container.querySelector('details')).toBeNull();
  expect(container.querySelectorAll('article > p')).toHaveLength(5);
  expect(screen.queryByText(/cut off/i)).toBeNull();
  const caret = article.querySelector('.caret');
  expect(caret).not.toBeNull();
  expect(caret).toHaveAttribute('aria-hidden', 'true');
  // The caret sits at the end of the last paragraph.
  expect(container.querySelectorAll('article > p')[4]?.lastElementChild).toBe(caret);
});

test('notes a Turn cut off at the word limit outside the collapsed part', () => {
  const { container } = render(TurnItem, { phase: 'Closing', speaker: 'Fake B', side: 'against', text: five, truncated: true });
  const note = screen.getByText(/cut off at the word limit/i);
  expect(note.closest('details')).toBeNull();
  expect(note.parentElement).toBe(container.querySelector('article'));
});
