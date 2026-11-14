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
