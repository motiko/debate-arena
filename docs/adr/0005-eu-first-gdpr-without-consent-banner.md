# EU-first data and GDPR without a consent banner

The platform is operated from the EU, so Member data is stored under D1's EU jurisdiction and stays in the EU; moving data location after launch would be costly. We set only essential session cookies and use cookieless analytics, which means no consent banner is required. That also protects the Lighthouse and accessibility bar (ADR 0004), since consent banners hurt first load and are a common accessibility failure.

## Consequences

- No third-party marketing or tracking scripts; any analytics must work without cookies or personal identifiers.
- The site needs an Impressum and a privacy policy, and Members can export and delete their account data.
- Every AI-generated Turn, Verdict and AI Audience Result is visibly labeled as AI-generated, to meet EU AI Act transparency obligations.
- A Turn submitted through the API by an API Debater is labeled as submitted via API, not as AI-generated: the platform did not generate it and cannot know how it was written.
