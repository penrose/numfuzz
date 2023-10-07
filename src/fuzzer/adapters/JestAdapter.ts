import { FuzzPinnedTest, implicitOracle } from "../Fuzzer";
import * as JSON5 from "json5";
import * as os from "os";
import * as path from "path";

/**
 * Converts a set of NaNofuzz saved tests into a Jest test suite
 *
 * @param pinnedTests list of saved NaNofuzz tests for the module under test
 * @param module path to module under test
 * @param timeout timeout for each test in ms
 * @returns string containing the Jest test suite for this module
 */
export const toString = (
  pinnedTests: Record<string, Record<string, FuzzPinnedTest>>,
  module: string,
  timeout: number
): string => {
  const jestData: string[] = [];
  const moduleFn = path.basename(module).split(".").slice(0, -1).join("."); // remove .ts/.tsx

  // Auto-generated warning comment
  jestData.push(
    `/**`,
    ` * DO NOT MODIFY`,
    ` * This file is auto-generated and maintained by NaNofuzz,`,
    ` * which will overwrite any changes made to this file.`,
    ` */`
  );

  // Import the module under test
  jestData.push(`import * as themodule from './${moduleFn}';`, ``);

  // Generate the implicit oracle
  jestData.push(`// @ts-ignore`);
  jestData.push(`const implicitOracle = ${implicitOracle.toString()};`, ``);

  // Specify the timeout
  jestData.push(`jest.setTimeout(${timeout});`, ``);

  // Generate a Jest test for each saved test
  for (const fn in pinnedTests) {
    let i = 0;
    for (const testId in pinnedTests[fn]) {
      if (!pinnedTests[fn][testId].pinned) {
        continue; // Don't generate Jest tests for saved tests that have correct icons but aren't pinned
      }
      let x = 0;
      let inputStr = "";
      pinnedTests[fn][testId].input
        .map((e) => e.value)
        .forEach((e) => {
          inputStr += x++ ? "," : "";
          inputStr += JSON5.stringify(e);
        });

      // TODO Add logic to support custom validator functions !!!!

      // If we have an expected output, use that
      const expectedOutput = pinnedTests[fn][testId].expectedOutput;
      if (expectedOutput && expectedOutput.length) {
        if (expectedOutput[0].isTimeout) {
          // Expected timeouts
          // TODO: Not currently supported !!!!
          console.debug(`Expected timeouts not currently supported`);
        } else if (expectedOutput[0].isException) {
          // Expected exception
          jestData.push(
            `// Expecting thrown exception`,
            `test("${fn}.${i++}", () => {expect( () => {themodule.${fn}(${inputStr})}).toThrow();},${timeout});`,
            ``
          );
        } else {
          // Expected output value
          jestData.push(
            `// Expecteding output value`,
            `test("${fn}.${i++}", () => {expect(themodule.${fn}(${inputStr})).toStrictEqual(${JSON5.stringify(
              expectedOutput[0].value
            )});},${timeout});`,
            ``
          );
        }
      } else {
        // implicit oracle
        jestData.push(
          `// Expecting no timeout, exception, NaN, null, undefined, or infinity`,
          `test("${fn}.${i++}", () => {expect(implicitOracle(themodule.${fn}(${inputStr}))).toBe(true);},${timeout});`,
          ``
        );
      }
    }
  }

  return jestData.join(os.EOL);
}; // fn: toJest()

/**
 * Returns the filename where jest tests are persisted.
 *
 * @returns filename of jest tests
 */
export const getFilename = (module: string): string => {
  module = module.split(".").slice(0, -1).join(".") || module; // remove .ts/.tsx
  return module + ".nano.test.ts";
}; // fn: getFilename()
