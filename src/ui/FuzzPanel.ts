import * as vscode from "vscode";
import * as fuzzer from "../fuzzer/Fuzzer";
import { htmlEscape } from "escape-goat";

/**
 * FuzzPanel displays fuzzer options, actions, and the last results for a
 * given FuzzEnvironment within a VS Code Webview.
 *
 * This class follows the Singleton pattern in that it keeps track of all
 * FuzzPanels created so that no more than onw panel exists at a time for
 * each FuzzEnvironment.
 *
 * For its user interface, this extension relies on the VS Code Webview
 * API and WebView controls.  Client-side Javascript is contained in
 * a separate FuzzPanelMain.js.
 */
export class FuzzPanel {
  // Static variables
  public static currentPanels: Record<string, FuzzPanel> = {}; // Map of panels indeved by the result of getFnRefKey()
  public static readonly viewType = "FuzzPanel"; // The name of this panel type

  // Instance variables
  private readonly _panel: vscode.WebviewPanel; // The WebView panel for this FuzzPanel instance
  private readonly _extensionUri: vscode.Uri; // Current Uri of the extension
  private _disposables: vscode.Disposable[] = []; // !!!
  private _fuzzEnv: fuzzer.FuzzEnv; // The Fuzz environment this panel represents
  private _state: FuzzPanelState = FuzzPanelState.init; // The current state of the fuzzer.

  // State-dependent instance variables
  private _results?: fuzzer.FuzzTestResults; // done state: the fuzzer output
  private _errorMessage?: string; // error state: the error message

  // ------------------------ Static Methods ------------------------ //

  /**
   * This method either (a) creates a new FuzzPanel if one does not yet
   * exist for the given FuzzEnv, or (b) displays the existing FuzzPanel
   * for the given FuzzEnv, if it exists.
   *
   * @param extensionUri Extension Uri
   * @param env FuzzEnv for which to display or create the FuzzPanel
   */
  public static render(extensionUri: vscode.Uri, env: fuzzer.FuzzEnv): void {
    const fnRef = JSON.stringify(env.function.getRef());

    // If we already have a panel for this fuzz env, show it.
    if (fnRef in FuzzPanel.currentPanels) {
      FuzzPanel.currentPanels[fnRef]._panel.reveal();
    } else {
      // Otherwise, create a new panel.
      const panel = vscode.window.createWebviewPanel(
        FuzzPanel.viewType, // FuzzPanel view type
        `AutoTest: ${env.function.getName()}()`, // webview title
        vscode.ViewColumn.Beside, // open beside the editor
        FuzzPanel.getWebviewOptions(extensionUri) // options
      );

      // Register the new panel
      FuzzPanel.currentPanels[fnRef] = new FuzzPanel(panel, extensionUri, env);
    }
  }

  /**
   * Determine the options to use when creating the FuzzPanel WebView
   *
   * @param extensionUri The Uri of the extension
   * @returns The options to use when creating the FuzzPanel WebView
   */
  public static getWebviewOptions(
    extensionUri: vscode.Uri
  ): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return {
      // Enable javascript in the webview
      enableScripts: true,

      // Enable searching on this panel
      enableFindWidget: true,

      // And restrict the webview to only loading content from our extension's `media` directory.
      // !!! localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
    };
  }

  // ------------------------ Instance Methods ------------------------ //

  /**
   * Creates a new instance of FuzzPanel.
   *
   * @param panel The WebView panel for this FuzzPanel instance
   * @param extensionUri Extension Uri
   * @param env FuzzEnv for which to create the FuzzPanel
   */
  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    env: fuzzer.FuzzEnv
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._fuzzEnv = env;

    // Listen for when the panel is disposed.  This happens when the
    // user closes the panel or when it is closed programmatically
    this._panel.onDidDispose(
      () => {
        this.dispose();
      },
      null,
      this._disposables
    );

    // Handle messages from the webview
    this._setWebviewMessageListener(this._panel.webview);

    // Set the webview's initial html content
    this._updateHtml();
  } // fn: constructor

  /**
   * Provides a key string that represents the fuzz environment
   * and is suitable for looking up a FuzzPanel in the
   * currentPanels map.
   *
   * @returns A key string that represents the fuzz environment
   */
  public getFnRefKey(): string {
    return JSON.stringify(this._fuzzEnv.function.getRef());
  }

  // ----------------------- Message Handling ----------------------- //

  /**
   * Registers the message handler that allows the client side of
   * the WebView to communicate back with this extension.
   *
   * @param webview WebView instance
   */
  private _setWebviewMessageListener(webview: vscode.Webview) {
    webview.onDidReceiveMessage(
      async (message: FuzzPanelMessage) => {
        const { command, json } = message;

        switch (command) {
          case "fuzz.start":
            this._doFuzzStartCmd(json);
            break;
        }
      },
      undefined,
      this._disposables
    );
  } // fn: _setWebviewMessageListener

  /**
   * Message handler for the `fuzz.start` command.
   *
   * This handler:
   *  1. Accepts a JSON object containing an updated set
   *     of fuzzer and argument options as input
   *  2. Updates the fuzzer environment accordingly (note:
   *     logical validation of these options takes place
   *     within the Fuzzer and ArgDef classes)
   *  3. Runs the fuzzer
   *  4. Updates the WebView with the results
   *
   * @param json JSON input
   */
  private async _doFuzzStartCmd(json: string): Promise<void> {
    const panelInput: {
      fuzzer: Record<string, any>; // !!! Improve typing
      args: Record<string, any>; // !!! Improve typing
    } = JSON.parse(json);
    const argsFlat = this._fuzzEnv.function.getArgDefsFlat();

    // Apply numeric fuzzer option changes
    ["suiteTimeout", "maxTests", "fnTimeout"].forEach((e) => {
      if (
        panelInput.fuzzer[e] !== undefined &&
        typeof panelInput.fuzzer[e] === "number"
      ) {
        this._fuzzEnv.options[e] = panelInput.fuzzer[e];
      }
    });

    // Apply argument option changes
    for (const i in panelInput.args) {
      const thisOverride = panelInput.args[i];
      const thisArg: fuzzer.ArgDef<fuzzer.ArgType> = argsFlat[i];
      if (Number(i) + 1 > argsFlat.length)
        throw new Error(
          `FuzzPanel input has ${panelInput.args.length} but the function has ${argsFlat.length}`
        );

      // Min and max values
      if (thisOverride.min !== undefined && thisOverride.max !== undefined) {
        switch (thisArg.getType()) {
          case fuzzer.ArgTag.NUMBER:
            thisArg.setIntervals([
              {
                min: Number(thisOverride.min),
                max: Number(thisOverride.max),
              },
            ]);
            break;
          case fuzzer.ArgTag.BOOLEAN:
            thisArg.setIntervals([
              {
                min: !!thisOverride.min,
                max: !!thisOverride.max,
              },
            ]);
            break;
          case fuzzer.ArgTag.STRING:
            thisArg.setIntervals([
              {
                min: thisOverride.min.toString(),
                max: thisOverride.max.toString(),
              },
            ]);
            break;
        }
      }

      // Number is integer
      if (thisOverride.numInteger !== undefined) {
        thisArg.setOptions({
          numInteger: !!thisOverride.numInteger,
        });
      }

      // String length min and max
      if (
        thisOverride.minStrLen !== undefined &&
        thisOverride.maxStrLen !== undefined
      ) {
        thisArg.setOptions({
          strLength: {
            min: Number(thisOverride.minStrLen),
            max: Number(thisOverride.maxStrLen),
          },
        });
      } // !!! validation

      // Array dimensions
      if (
        thisOverride.dimLength !== undefined &&
        thisOverride.dimLength.length
      ) {
        thisOverride.dimLength.forEach((e: fuzzer.Interval<number>) => {
          if (typeof e === "object" && "min" in e && "max" in e) {
            e = { min: Number(e.min), max: Number(e.max) };
          } else {
            throw new Error(
              `Invalid interval for array dimensions: ${JSON.stringify(e)}`
            );
          }
        });
        thisArg.setOptions({
          dimLength: thisOverride.dimLength,
        });
      }
    } // for: each argument

    // Update the UI
    this._results = undefined;
    this._state = FuzzPanelState.busy;
    this._updateHtml();

    // Fuzz the function & store the results
    try {
      this._results = await fuzzer.fuzz(this._fuzzEnv);
      this._errorMessage = undefined;
      this._state = FuzzPanelState.done;
    } catch (e: any) {
      this._state = FuzzPanelState.error;
      this._errorMessage = e.message ?? "Unknown error";
    }

    // Update the UI
    this._updateHtml();
  } // fn: _doFuzzStartCmd()

  /**
   * Disposes all objects used by this instance
   */
  public dispose(): void {
    // Remove this panel from the list of current panels.
    delete FuzzPanel.currentPanels[this.getFnRefKey()];

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  } // fn: dispose()

  // ------------------------- Webview HTML ------------------------- //

  /**
   * Updates the WebView HTML with the current state of the FuzzPanel
   *
   * TODO: Move styles to CSS !!!
   */
  private _updateHtml(): void {
    const webview: vscode.Webview = this._panel.webview; // Current webview
    const extensionUri: vscode.Uri = this._extensionUri; // Extension URI
    const disabledFlag =
      this._state === FuzzPanelState.busy ? ` disabled ` : ""; // Disable inputs if busy
    const resultSummary = {
      passed: 0,
      failed: 0,
      timeout: 0,
      exception: 0,
      badOutput: 0,
    }; // Summary of fuzzing results
    const toolkitUri = getUri(webview, extensionUri, [
      "node_modules",
      "@vscode",
      "webview-ui-toolkit",
      "dist",
      "toolkit.js",
    ]); // URI to the VS Code webview ui toolkit
    const scriptUrl = getUri(webview, extensionUri, [
      "assets",
      "ui",
      "FuzzPanelMain.js",
    ]); // URI to client-side panel script
    const env = this._fuzzEnv; // Fuzzer environment
    const fnRef = env.function.getRef(); // Reference to function under test
    const counter = { id: 0 }; // Unique counter for argument ids
    let argDefHtml = ""; // HTML representing argument definitions

    // If fuzzer results are available, calculate how many tests passed, failed, etc.
    if (this._state === FuzzPanelState.done && this._results !== undefined) {
      for (const result of this._results.results) {
        if (result.passed) resultSummary.passed++;
        else {
          resultSummary.failed++;
          if (result.exception) resultSummary.exception++;
          else if (result.timeout) resultSummary.timeout++;
          else resultSummary.badOutput++;
        }
      }
    } // if: results are available

    // Render the HTML for each argument
    env.function
      .getArgDefs()
      .forEach((arg) => (argDefHtml += this._argDefToHtmlForm(arg, counter)));

    // Prettier abhorrently butchers this HTML, so disable prettier here
    // prettier-ignore
    let html = /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <script type="module" src="${toolkitUri}"></script>
          <script type="module" src="${scriptUrl}"></script>
          <title>AutoTest Panel</title>
        </head>
        <body>
          <h2 style="margin-bottom:.5em;margin-top:.1em;">AutoTest ${htmlEscape(
            fnRef.name
          )}() w/inputs:</h2>

          <!-- Function Arguments -->
          <div id="argDefs">${argDefHtml}</div>

          <!-- Fuzzer Options -->
          <div id="fuzzOptions" style="display:none">
            <vscode-divider></vscode-divider>
            <p>These settings control how long the fuzzer runs.  It stops when either limit is reached.</p>
            <vscode-text-field ${disabledFlag} id="fuzz-suiteTimeout" name="fuzz-suiteTimeout" value="${this._fuzzEnv.options.suiteTimeout}">
              Max runtime (ms)
            </vscode-text-field>
            <vscode-text-field ${disabledFlag} id="fuzz-maxTests" name="fuzz-maxTests" value="${this._fuzzEnv.options.maxTests}">
              Max number of tests
            </vscode-text-field>

            <vscode-divider></vscode-divider>
            <p>To ensure the fuzzer completes, it stops long-running function calls. Define how long a function may run until marked as a timeout failure.</p>
            <vscode-text-field ${disabledFlag} id="fuzz-fnTimeout" name="fuzz-fnTimeout" value="${this._fuzzEnv.options.fnTimeout}">
              Stop function call after (ms)
            </vscode-text-field>
            <vscode-divider></vscode-divider>
          </div>

          <!-- Button Bar -->
          <div style="padding-top: .25em;">
            <vscode-button ${disabledFlag} id="fuzz.start"  appearance="primary">Test</vscode-button>
            <vscode-button ${disabledFlag} id="fuzz.options" appearance="secondary">More options</vscode-button>
          </div>

          <!-- Fuzzer Errors -->
          <div class="fuzzErrors" ${
            this._state === FuzzPanelState.error
              ? ""
              : /*html*/ `style="display:none;"`
          }>
            <h3>The fuzzer stopped with this error:</h3>
            <p>${this._errorMessage ?? "Unknown error"}</p>
          </div>

          <!-- Fuzzer Output -->
          <div class="fuzzResults" ${
            this._state === FuzzPanelState.done
              ? ""
              : /*html*/ `style="display:none;"`
          }>
            <vscode-panels>`;

    // If we have results, render the output tabs to display the results.
    const tabs = [
      {
        id: "timeout",
        name: "Timeouts",
        description: `These inputs did not terminate within ${this._fuzzEnv.options.fnTimeout}ms`,
      },
      {
        id: "exception",
        name: "Exceptions",
        description: `The inputs resulted in a runtime exception`,
      },
      {
        id: "badOutput",
        name: "Invalid Outputs",
        description: `These outputs contain: null, NaN, Infinity, or undefined`,
      },
      {
        id: "passed",
        name: "Passed",
        description: `Passed: no timeout, exception, null, NaN, Infinity, or undefined`,
      },
    ];
    tabs.forEach((e) => {
      if (resultSummary[e.id] > 0)
        // prettier-ignore
        html += /*html*/ `
              <vscode-panel-tab id="tab-${e.id}">
                ${e.name}<vscode-badge appearance="secondary">${
                  resultSummary[e.id]
                }</vscode-badge>
              </vscode-panel-tab>`;
    });
    tabs.forEach((e) => {
      if (resultSummary[e.id] > 0)
        html += /*html*/ `
              <vscode-panel-view id="view-${e.id}">
                <section>
                  <h4 style="margin-bottom:.25em;margin-top:.25em;">${e.description}</h4>
                  <vscode-data-grid id="fuzzResultsGrid-${e.id}" generate-header="sticky" aria-label="Basic" />
                </section>
              </vscode-panel-view>`;
    });
    html += /*html*/ `
            </vscode-panels>
          </div>
          <div id="fuzzResultsData" style="display:none">
            ${
              this._results === undefined
                ? "{}"
                : htmlEscape(JSON.stringify(this._results))
            }
          </div>
        </body>
      </html>
    `;

    // Update the webview with the new HTML
    this._panel.webview.html = html;
  } // fn: _updateHtml()

  /**
   * Returns an HTML form representing an argument definition.  The counter
   * is passed by reference so it can be unique across the entire tree of
   * arguments: objects can be nested arbitrarily.
   *
   * @param arg Argument definition to render
   * @param counter Counter internally incremented for each argument
   * @returns html string of the argument definition form
   */
  private _argDefToHtmlForm(
    arg: fuzzer.ArgDef<fuzzer.ArgType>,
    counter: { id: number } // pass counter by reference
  ): string {
    const id = counter.id++; // unique id for each argument
    const idBase = `argDef-${id}`; // base HTML id for this argument
    const argType = arg.getType(); // type of argument
    const disabledFlag =
      this._state === FuzzPanelState.busy ? ` disabled ` : ""; // Disable inputs if busy
    const dimString = "[]".repeat(arg.getDim()); // Text indicating array dimensions
    const typeString =
      argType === fuzzer.ArgTag.OBJECT ? "Object" : argType.toLowerCase(); // Text indicating arg type
    const optionalString = arg.isOptional() ? "?" : ""; // Text indication arg optionality

    let html = /*html*/ `
    <!-- Argument Definition -->
    <div class="argDef" id="${idBase}">
      <!-- Argument Name -->
      <div class="argDef-name" style="font-size:1.25em;">
        <strong>${htmlEscape(
          arg.getName()
        )}</strong>${optionalString}: ${typeString}${dimString} =
      </div>`;

    html += /*html*/ `
      <!-- Argument Type -->
      <div class="argDef-type-${htmlEscape(
        arg.getType()
      )}" id="${idBase}-${argType}" style="padding-left: 1em;">
      <!-- Argument Options -->`;

    // Argument options
    switch (arg.getType()) {
      // Number-specific Options
      case fuzzer.ArgTag.NUMBER: {
        // TODO: validate for ints and floats !!!
        html += /*html*/ `<vscode-text-field ${disabledFlag} id="${idBase}-min" name="${idBase}-min" value="${htmlEscape(
          Number(arg.getIntervals()[0].min).toString()
        )}">Minimum value</vscode-text-field>`;
        html += " ";
        html += /*html*/ `<vscode-text-field ${disabledFlag} id="${idBase}-max" name="${idBase}-max" value="${htmlEscape(
          Number(arg.getIntervals()[0].max).toString()
        )}">Maximum value</vscode-text-field>`;
        html += " ";
        html += /*html*/ `<vscode-checkbox ${disabledFlag} id="${idBase}-numInteger" name="${idBase}-numInteger"${
          arg.getOptions().numInteger ? "checked" : ""
        }>Integers</vscode-checkbox>`;
        break;
      }

      // String-specific Options
      case fuzzer.ArgTag.STRING: {
        // TODO: validate for ints > 0 !!!
        html += /*html*/ `<vscode-text-field ${disabledFlag} id="${idBase}-minStrLen" name="${idBase}-min" value="${htmlEscape(
          arg.getOptions().strLength.min.toString()
        )}">Minimum string length</vscode-text-field>`;
        html += " ";
        html += /*html*/ `<vscode-text-field ${disabledFlag} id="${idBase}-maxStrLen" name="${idBase}-max" value="${htmlEscape(
          arg.getOptions().strLength.max.toString()
        )}">Maximum string length</vscode-text-field>`;
        break;
      }

      // Boolean-specific Options
      case fuzzer.ArgTag.BOOLEAN: {
        let intervals = arg.getIntervals();
        if (intervals.length === 0) {
          intervals = [{ min: false, max: true }];
        }
        html +=
          /*html*/
          `<vscode-radio-group>
            <label slot="label">Values</label>
            <vscode-radio ${disabledFlag} id="${idBase}-trueFalse" name="${idBase}-trueFalse" ${
            intervals[0].min !== intervals[0].max ? " checked " : ""
          }>True and false</vscode-radio>
            <vscode-radio ${disabledFlag} id="${idBase}-trueOnly" name="${idBase}-trueOnly" ${
            intervals[0].min && intervals[0].max ? " checked " : ""
          }>True</vscode-radio>
            <vscode-radio ${disabledFlag} id="${idBase}-falseOnly" name="${idBase}-falseOnly" ${
            !intervals[0].min && !intervals[0].max ? " checked " : ""
          }>False</vscode-radio>
          </vscode-radio-group>`;
        break;
      }

      // Object-specific Options
      case fuzzer.ArgTag.OBJECT: {
        // Only for objects: output the array form prior to the child arguments.
        // This seems odd, but the screen reads better to the user this way.
        html += this._argDefArrayToHtmlForm(arg, idBase, disabledFlag);
        html += `<div>`;
        arg
          .getChildren()
          .forEach((child) => (html += this._argDefToHtmlForm(child, counter)));
        html += `</div>`;
        break;
      }
    }

    // For objects: output any sub-arguments.
    if (argType !== fuzzer.ArgTag.OBJECT) {
      html += this._argDefArrayToHtmlForm(arg, idBase, disabledFlag);
    }

    html += `</div>`;
    // For objects: output the end of object character ("}") here
    if (argType === fuzzer.ArgTag.OBJECT) {
      html += /*html*/ `<span style="font-size:1.25em;">}</span>`;
    }
    html += `</div>`;

    // Return the argument's HTML
    return html;
  } // fn: _argDefToHtmlForm()

  /**
   * Returns an HTML form representing an array argument definition.
   *
   * @param arg Argument definition to render as an array
   * @param idBase The arg id base of the parent argument form
   * @param disabledFlag Indicates whether controls are disabled
   * @returns html string representing an argument's array form
   */
  private _argDefArrayToHtmlForm(
    arg: fuzzer.ArgDef<fuzzer.ArgType>,
    idBase: string,
    disabledFlag: string
  ): string {
    let html = "";

    // Array dimensions
    for (let dim = 0; dim < arg.getDim(); dim++) {
      const arrayBase = `${idBase}-array-${dim}`;

      // TODO: validate for ints > 0 !!!
      html += /*html*/ ``;
      html +=
        /*html*/
        `<div>
          <vscode-text-field ${disabledFlag} id="${arrayBase}-min" name="${arrayBase}-min" value="${htmlEscape(
          arg.getOptions().dimLength[dim].min.toString()
        )}">Array${"[]".repeat(dim + 1)}: min length
          </vscode-text-field>
          <vscode-text-field ${disabledFlag} id="${arrayBase}-max" name="${arrayBase}-max" value="${htmlEscape(
          arg.getOptions().dimLength[dim].max.toString()
        )}">Array${"[]".repeat(dim + 1)}: max length
          </vscode-text-field>
        </div>`;
    }

    return html;
  } // fn: _arraySizeHtmlForm()
} // class: FuzzPanel

// ------------------------ Helper Functions ----------------------- //

/**
 * Convenience function to build a uri to a project file at runtime.
 *
 * @param webview webview object
 * @param extensionUri uri of extension
 * @param pathList list of paths to concatenate
 * @returns A vscode uri to the requested path
 */
export function getUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  pathList: string[]
): vscode.Uri {
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...pathList));
} // fn: getUri()

// ----------------------------- Types ----------------------------- //

/**
 * Represents a message from the WebView client to its FuzzPanel.
 */
export type FuzzPanelMessage = {
  command: string;
  json: string; // !!! Better typing here
};

/**
 * Represents the possible states of the FuzzPanel
 */
export enum FuzzPanelState {
  init = "init", // Nothing has been fuzzed yet
  busy = "busy", // Fuzzing is in progress
  done = "done", // Fuzzing is done
  error = "error", // Fuzzing stopped due to an error
}
