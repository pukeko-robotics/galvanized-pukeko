import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e-tests',
    fullyParallel: true,
    // QA-40 — THIS EXAMPLE KEEPS ITS OWN OUTPUT DIRECTORY, and must go on stating one.
    // With no `outputDir`, Playwright resolves one to `<packageJsonDir>/test-results`. There is
    // no `package.json` in this directory, so that walk reaches the REPOSITORY ROOT and a run
    // from here silently shares `<repoRoot>/test-results` with the root config — which is where
    // the root config's json reporter writes `results.json`. Playwright CLEARS the output
    // directory in setup before every run, so without this key a run from this directory
    // destroys the root harness's `results.json` and any traces kept beside it. It fails in
    // silence: nothing errors, the file is simply absent afterwards, and whoever reads it next
    // reports that no rate could be computed rather than that its input was deleted.
    //
    // A relative path resolves against THIS config's directory. Do NOT instead add a
    // `package.json` here — it would also work, and it changes install and workspace semantics
    // for a reason that has nothing to do with where output goes.
    outputDir: './test-results',
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:8080',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
