// Who runs the site (Impressum, § 5 DDG; controller in the privacy policy). Fill in every REPLACE_ME value before
// launch: `node scripts/check-release.mjs` refuses a production deploy while any remain.
export const OPERATOR = {
  name: 'REPLACE_ME_OPERATOR_NAME',
  street: 'REPLACE_ME_OPERATOR_STREET',
  postcode: 'REPLACE_ME_OPERATOR_POSTCODE',
  city: 'REPLACE_ME_OPERATOR_CITY',
  country: 'Germany',
  email: 'REPLACE_ME_OPERATOR_EMAIL',
  // Optional under § 5 DDG when another fast, direct way of contact exists; leave empty to omit.
  phone: '',
  // Responsible for content (§ 18 (2) MStV): usually the operator.
  responsibleForContent: 'REPLACE_ME_OPERATOR_NAME',
} as const;
