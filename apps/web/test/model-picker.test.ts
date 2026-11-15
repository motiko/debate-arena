import { fireEvent, render, screen } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';
import ModelPicker from '../src/islands/ModelPicker.svelte';

const models = [
  { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', inputPerMTokUsd: 0.1, outputPerMTokUsd: 0.5 },
  { id: 'openai/gpt-6.1-terra', label: 'GPT-6.1 Terra', inputPerMTokUsd: 1, outputPerMTokUsd: 5 },
  { id: 'qwen/qwen3.8-flash', label: 'Qwen 3.8 Flash', inputPerMTokUsd: 0.15, outputPerMTokUsd: 0.47 },
];
const many = Array.from({ length: 342 }, (_, i) => ({ id: `p${i}/m${i}`, label: `Model ${i}`, inputPerMTokUsd: 1, outputPerMTokUsd: 1 }));

function setup(props: Record<string, unknown> = {}) {
  const onchange = vi.fn();
  render(ModelPicker, { id: 'pick', label: 'Debater For', models, value: 'openai/gpt-6.1-terra', onchange, ...props });
  return { input: screen.getByRole('combobox', { name: 'Debater For' }), onchange };
}

const optionNames = () => screen.queryAllByRole('option').map(o => o.querySelector('.name')?.textContent);

test('closed, it shows the chosen model', () => {
  const { input } = setup();
  expect(input).toHaveValue('GPT-6.1 Terra');
  expect(input).toHaveAttribute('aria-expanded', 'false');
  expect(input).toHaveAttribute('aria-autocomplete', 'list');
});

test('typing filters by name, id and provider; every word must match', async () => {
  const { input } = setup();
  await fireEvent.input(input, { target: { value: 'haiku' } });
  expect(input).toHaveAttribute('aria-expanded', 'true');
  expect(optionNames()).toEqual(['Claude Haiku 5.5']);
  await fireEvent.input(input, { target: { value: 'anthropic haiku' } });
  expect(optionNames()).toEqual(['Claude Haiku 5.5']);
  await fireEvent.input(input, { target: { value: 'openai haiku' } });
  expect(optionNames()).toEqual([]);
  expect(screen.getByText('No model matches “openai haiku”')).toBeInTheDocument();
});

test('each option shows its provider and price', async () => {
  const { input } = setup();
  await fireEvent.input(input, { target: { value: 'qwen' } });
  expect(screen.getByRole('option')).toHaveTextContent('Qwen · $0.15 / $0.47 per M tokens');
});

test('ArrowDown and Enter choose an option', async () => {
  const { input, onchange } = setup();
  await fireEvent.input(input, { target: { value: 'flash' } });
  await fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option').id);
  await fireEvent.keyDown(input, { key: 'Enter' });
  expect(onchange).toHaveBeenCalledWith('qwen/qwen3.8-flash');
  expect(input).toHaveAttribute('aria-expanded', 'false');
});

test('a click chooses an option', async () => {
  const { input, onchange } = setup();
  await fireEvent.input(input, { target: { value: 'haiku' } });
  await fireEvent.mouseDown(screen.getByRole('option'));
  expect(onchange).toHaveBeenCalledWith('anthropic/claude-haiku-5.5');
});

test('Escape closes and restores the chosen model', async () => {
  const { input, onchange } = setup();
  await fireEvent.input(input, { target: { value: 'haiku' } });
  await fireEvent.keyDown(input, { key: 'Escape' });
  expect(input).toHaveAttribute('aria-expanded', 'false');
  expect(input).toHaveValue('GPT-6.1 Terra');
  expect(onchange).not.toHaveBeenCalled();
});

test('with hundreds of models it lists 50, then says how many more', async () => {
  const { input } = setup({ models: many, value: 'p0/m0' });
  await fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(screen.getAllByRole('option')).toHaveLength(50);
  expect(screen.getByText('Type to narrow down 292 more models')).toBeInTheDocument();
  expect(input).toHaveAttribute('placeholder', 'Search 342 models');
});

test('the API choice comes first when allowed', async () => {
  const { input, onchange } = setup({ allowApi: true });
  await fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(screen.getAllByRole('option')[0]).toHaveTextContent('API — submit this side’s Turns yourself');
  await fireEvent.keyDown(input, { key: 'ArrowDown' });
  await fireEvent.keyDown(input, { key: 'Enter' });
  expect(onchange).toHaveBeenCalledWith('api');
});

test('a platform choice comes first for the Judge', async () => {
  const { input, onchange } = setup({ autoLabel: 'Let the platform choose (recommended)', value: '' });
  expect(input).toHaveValue('Let the platform choose (recommended)');
  await fireEvent.input(input, { target: { value: 'terra' } });
  await fireEvent.keyDown(input, { key: 'ArrowDown' });
  await fireEvent.keyDown(input, { key: 'Enter' });
  expect(onchange).toHaveBeenCalledWith('openai/gpt-6.1-terra');
});

test('the match count is announced politely after typing settles', async () => {
  const { input } = setup();
  const status = document.getElementById('pick-status');
  expect(status).toHaveAttribute('role', 'status');
  await fireEvent.input(input, { target: { value: 'a' } });
  await vi.waitFor(() => expect(status).toHaveTextContent(/^\d+ models? match$/));
});

test('invalid and described, like the other fields', () => {
  render(ModelPicker, { id: 'pick', label: 'Judge', models, value: '', invalid: true, describedBy: 'hint' });
  const input = screen.getByRole('combobox', { name: 'Judge' });
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAttribute('aria-describedby', 'hint');
});
