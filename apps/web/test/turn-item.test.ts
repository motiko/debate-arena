import { render, screen } from '@testing-library/svelte';
import { expect, test } from 'vitest';
import TurnItem from '../src/islands/TurnItem.svelte';

test('renders Motion and Turn text literally', () => {
  const { container } = render(TurnItem, {
    heading: 'Opening · For',
    text: '<script>alert(1)</script> &amp;\n\nSecond <b>para</b>',
    truncated: false,
  });
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('b')).toBeNull();
  const paras = container.querySelectorAll('article p');
  expect(paras).toHaveLength(2);
  expect(paras[0]?.textContent).toBe('<script>alert(1)</script> &amp;');
  expect(screen.getByRole('heading', { name: 'Opening · For' })).toBeInTheDocument();
  expect(screen.getByText('AI-generated')).toBeInTheDocument();
});

test('notes a Turn cut off at the word limit', () => {
  render(TurnItem, { heading: 'Closing · Against', text: 'Short', truncated: true });
  expect(screen.getByText(/cut off at the word limit/i)).toBeInTheDocument();
});
