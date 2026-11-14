// The quality bar (ADR 0004): a mid-range phone on slow 4G. URLs come from scripts/lighthouse.mjs.
module.exports = {
  ci: {
    collect: {
      numberOfRuns: 3,
      settings: {
        formFactor: 'mobile',
        screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
        // Lighthouse's slow-4G mobile profile, spelled out so it cannot drift with Lighthouse defaults.
        throttlingMethod: 'simulate',
        throttling: { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4, requestLatencyMs: 562.5, downloadThroughputKbps: 1474.56, uploadThroughputKbps: 675 },
        chromeFlags: '--no-sandbox --headless=new',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:seo': ['error', { minScore: 1 }],
        'categories:accessibility': ['error', { minScore: 1 }],
      },
    },
    // Reports stay on the runner (uploaded as a CI artifact), never on a public server.
    upload: { target: 'filesystem', outputDir: '.lighthouseci/reports' },
  },
};
