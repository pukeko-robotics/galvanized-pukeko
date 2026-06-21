# Development Guidelines of Gaunt Sloth Assistant

Galvanized Pukeko UI is a framework that allows LLM models (AI) to flexibly render forms and components when
getting information from users. It eliminates the need to render entire HTML pages while maintaining consistent
formatting and coherent branded interfaces.

## Technologies Used
- NodeJS 22 (LTS)
- Vue 3 for UI components
- MCP (Model Context Protocol) to connect AI client to Pukeko
- Websockets to connect the MCP server to a browser, allowing bidirectional communication
- Vitest 3 for tests
- Typescript 5

Please refer to package.json to check exact versions

## Core Development Principles

Vendor and system abstractions and wrappers should be used in most cases.

### Architecture and Flow
- Make sure proper separation of concerns
- Check for clear data flow between components
- Ensure proper state management workflows
- Validate error handling and fallback mechanisms

### Security
- Make sure API key handling and environment variables
- Make sure no personal data is present in code
- ** Make sure that API keys are accidentally not included into diff.**
- Check for proper input sanitization
- Verify output validation and sanitization

## Testing (Important)

- In spec files never import mocked files themselves, mock them, and a tested file should import them.
- Always import the tested file dynamically within the test.
- Mocks are hoisted, so it is better to simply place them at the top of the file to avoid confusion.
- Make sure that beforeEach is always present and always calls vi.resetAllMocks(); as a first thing.
- Create variables with vi.fn() without adding implementations to them, then apply these functions with vi.mock outside of the describe.
- Apply mock implementations and return values to mocks within individual tests.
- When mock implementations are common for all test cases, apply them in beforeEach.
- Make sure test actually testing a function, rather than simply testing the mock.

Example test

```typescript
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {writeFileSync} from "node:fs";

const consoleUtilsMock = {
  display: vi.fn(),
  displayError: vi.fn(),
  displayInfo: vi.fn(),
  displayWarning: vi.fn(),
  displaySuccess: vi.fn(),
  displayDebug: vi.fn(),
};
vi.mock('#src/consoleUtils.js', () => consoleUtilsMock);

let fsUtilsMock = {
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
};
vi.mock('node:fs', () => fsUtilsMock);

describe('specialUtil', () => {
  beforeEach(() => {
    vi.resetAllMocks(); // Always reset all mocks in beforeEach

    // Set up default mock values
    fsUtilsMock.existsSync.mockImplementation(() => true);
  });

  it('specialFunction should eventually write test contents to a file', async () => {
    fsMock.readFileSync.mockImplementation((path: string) => {
      if (path.includes('inputFile.txt')) return 'TEST CONTENT';
      return '';
    });

    const {specialFunction} = await import('#src/specialUtil.js'); // Always import tested file within the test
    
    // Function under test
    specialFunction();

    expect(fsUtilsMock.writeFileSync).toHaveBeenCalledWith('outputFile.txt', 'TEST CONTENT\nEXTRA CONTENT');
    expect(consoleUtilsMock.displayDebug).not.toHaveBeenCalled();
    expect(consoleUtilsMock.displayWarning).not.toHaveBeenCalled();
    expect(consoleUtilsMock.display).not.toHaveBeenCalled();
    expect(consoleUtilsMock.displayError).not.toHaveBeenCalled();
    expect(consoleUtilsMock.displayInfo).not.toHaveBeenCalled();
    expect(consoleUtilsMock.displaySuccess).toHaveBeenCalledWith('Successfully transferred to outputFile.txt');
  });
});
```

## Development Workflow

Please follow this workflow:

- Analyze requirements.
- Develop changes.
- Make sure all tests pass `pnpm run test` and fix if possible.
    - Request relevant documentation if some of the test failures are unclear.
- Once all tests are green check lint with `pnpm run lint`.
    - If any lint failures are present try fixing them with `pnpm run lint --fix`.
    - If autofix didn't help, try fixing them yourself.
    - Prefer testing all user outputs, including testing absence of unexpected outputs.

---

