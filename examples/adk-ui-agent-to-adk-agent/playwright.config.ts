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
    // QA-41 — THIS EXAMPLE KEEPS ITS OWN HTML REPORT FOLDER, and must go on stating one.
    // `outputFolder` is the only thing that anchors the html report to this config's directory:
    // `resolveReporterOutputPath` uses the config directory ONLY when this key is set, and
    // otherwise does the same walk up for a `package.json` that `outputDir` does above. There is
    // none in this directory, so without this key the report resolves to
    // `<repoRoot>/playwright-report` — the very folder the root config's own html reporter writes.
    //
    // That is worse than sharing a directory: the html reporter DELETES its output folder before
    // generating, so a run from here does not overwrite part of the root harness's report, it
    // removes the report and leaves this example's single test in its place. Nothing errors and
    // nothing warns, and whoever opens the root report next is reading this example's run with no
    // way to tell that is what they are looking at.
    //
    // Keep the basename `playwright-report`. `scripts/check-no-bare-launchers.mjs` skips
    // directories by BASENAME, so a more distinctive name would send that walker into live
    // Playwright output, whose text contains the one-shot-runner token it greps for — a red
    // `pnpm test` with no relation to where output goes.
    reporter: [['html', { outputFolder: './playwright-report' }]],
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
