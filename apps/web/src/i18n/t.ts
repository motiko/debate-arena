import { en } from './en';

export type MessageKey = keyof typeof en;
export type Params = Record<string, string | number>;

/** Fills `{name}` placeholders; unknown ones stay visible so a missing param is easy to spot. */
export function format(template: string, params: Params = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : match));
}

/** UI copy. Every string a Viewer sees comes from here, so a second language is a new dictionary. */
export function t(key: MessageKey, params?: Params): string {
  return format(en[key], params);
}

/** A key with both plural forms in the dictionary: `{base}.one` and `{base}.other`. */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}.one` ? (`${Base}.other` extends MessageKey ? Base : never) : never;
}[MessageKey];

const pluralRules = new Intl.PluralRules('en');

/** Copy that depends on a count: picks the plural form by the language's rules and fills `{count}`. */
export function tn(key: PluralKey, count: number, params: Params = {}): string {
  const form = pluralRules.select(count) === 'one' ? 'one' : 'other';
  return t(`${key}.${form}` as MessageKey, { ...params, count });
}
