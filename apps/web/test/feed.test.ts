import { expect, test } from 'vitest';
import { appliedParams, feedHref, feedParams, pageList } from '../src/lib/feed';

test('feedHref keeps the filters, drops empty ones and goes back to the first page', () => {
  expect(feedHref({ q: 'cats', category: 'science', page: 3 }, { tags: ['space'] })).toBe('/?q=cats&category=science&tag=space');
  expect(feedHref({ tags: ['a', 'b'], kind: 'live' }, { tags: ['a'] })).toBe('/?tag=a&kind=live');
  expect(feedHref({ tags: ['a', 'b'] }, { tags: [] })).toBe('/');
  expect(feedHref({ q: 'cats', category: 'science' }, { category: undefined })).toBe('/?q=cats');
  expect(feedHref({}, {})).toBe('/');
});

test('feedHref moves to a page, leaving out page 1', () => {
  expect(feedHref({ tags: ['remote work'] }, { page: 2 })).toBe('/?tag=remote+work&page=2');
  expect(feedHref({ tags: ['x'], page: 2 }, { page: 1 })).toBe('/?tag=x');
});

test('feedParams reads only the feed\'s own parameters, and a page only when it is a whole number above 1', () => {
  const url = new URL('https://x.test/?q=%20cats%20&category=science&page=2&utm=1&kind=batch&model=a%2Fb&tag=');
  expect(feedParams(url.searchParams)).toEqual({ q: 'cats', category: 'science', page: 2, kind: 'batch', model: 'a/b' });
  expect(feedParams(new URLSearchParams('tag=a&tag=%20b&tag=a&tag='))).toEqual({ tags: ['a', 'b'] });
  expect(feedParams(new URLSearchParams('page=0'))).toEqual({});
  expect(feedParams(new URLSearchParams('page=abc'))).toEqual({});
});

test('pageList shows the first, the last and the neighbours of the current page, with gaps between', () => {
  expect(pageList(1, 1)).toEqual([1]);
  expect(pageList(2, 3)).toEqual([1, 2, 3]);
  expect(pageList(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10]);
  expect(pageList(1, 10)).toEqual([1, 2, 'gap', 10]);
  expect(pageList(3, 10)).toEqual([1, 2, 3, 4, 'gap', 10]);
});

test('appliedParams turns the query the API applied into feed parameters, leaving out page 1', () => {
  expect(appliedParams({ q: 'cats', kind: 'live', page: 1 })).toEqual({ q: 'cats', kind: 'live' });
  expect(appliedParams({ tags: ['space'], page: 3 })).toEqual({ tags: ['space'], page: 3 });
});
