// Who runs the site (Impressum, § 5 DDG; controller in the privacy policy). Fill in every REPLACE_ME value before
// launch: `node scripts/check-release.mjs` refuses a production deploy while any remain.
export const OPERATOR = {
  name: 'Moti Koritz',
  street: 'Lietzenburger Straße 56',
  postcode: '10719',
  city: 'Berlin',
  country: 'Germany',
  email: 'support@motik.org',
  // Optional under § 5 DDG when another fast, direct way of contact exists; leave empty to omit.
  phone: '',
  // Responsible for content (§ 18 (2) MStV): usually the operator.
  responsibleForContent: 'Moti Koritz',
} as const;
