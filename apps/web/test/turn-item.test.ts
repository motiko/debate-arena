import { render, screen } from '@testing-library/svelte';
import { expect, test } from 'vitest';
import TurnItem from '../src/islands/TurnItem.svelte';

// A greeting, a one-line promise, then three paragraphs of argument (40 words each).
const argument = Array.from({ length: 40 }, () => 'word').join(' ');
const five = ['Madam Chair, judges.', 'Let me set out why.', argument, argument, argument].join('\n\n');

test('an API Turn is labelled as submitted via API, never as AI-generated', () => {
  render(TurnItem, { phase: 'Opening', speaker: 'API Debater', side: 'for', text: 'A speech.', truncated: false, submitted: true });
  expect(screen.getByText('Submitted via API')).toBeInTheDocument();
  expect(screen.queryByText('AI-generated')).toBeNull();
});

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

test('a long speech shows all of its text, no disclosure', () => {
  const { container } = render(TurnItem, { phase: 'Opening', speaker: 'Fake A', side: 'for', text: five, truncated: false });
  expect(container.querySelector('details')).toBeNull();
  expect(container.querySelectorAll('article > p')).toHaveLength(5);
});

test('a draft cut off inside emphasis shows it emphasised, never a stray asterisk', () => {
  const { container } = render(TurnItem, { phase: 'Opening', speaker: 'Fake A', side: 'for', text: 'Nuclear is **the only ro', truncated: false, draft: true });
  expect(container.querySelector('article strong')?.textContent).toBe('the only ro');
  expect(container.querySelector('article > p')?.textContent).not.toContain('*');
});

test('renders *emphasis* and **strong** text, never the asterisks', () => {
  const { container } = render(TurnItem, { phase: 'Rebuttal', speaker: 'Fake A', side: 'for', text: 'Nuclear is the *only* route, **firmly**.', truncated: false });
  expect(container.querySelector('article em')?.textContent).toBe('only');
  expect(container.querySelector('article strong')?.textContent).toBe('firmly');
  expect(container.querySelector('article > p')?.textContent).toBe('Nuclear is the only route, firmly.');
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

test('notes a Turn cut off at the word limit, under the speech', () => {
  const { container } = render(TurnItem, { phase: 'Closing', speaker: 'Fake B', side: 'against', text: five, truncated: true });
  const note = screen.getByText(/cut off at the word limit/i);
  expect(note.parentElement).toBe(container.querySelector('article'));
});
