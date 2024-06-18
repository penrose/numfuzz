const vscode = acquireVsCodeApi();

// Attach main to the window onLoad() event
window.addEventListener("load", main);

// List of output grids that store fuzzer results
const gridTypes = [
  "failure",
  "disagree",
  "exception",
  "timeout",
  "badValue",
  "ok",
];

// Column name labels
const pinnedLabel = "pinned";
const idLabel = "id";
const correctLabel = "correct output?";
const expectedLabel = "expectedOutput";
const validatorLabel = "validator";
const allValidatorsLabel = "allValidators";
const implicitLabel = "implicit";
const elapsedTimeLabel = "running time (ms)";
const expandColumnLabel = "expandColumn";

// List of hidden columns
const hiddenColumns = [idLabel, expectedLabel, allValidatorsLabel];

// Mode labels
const exploreLabel = "Explore";
const fuzzLabel = "Fuzz";
const exampleLabel = "Example Test";
const propertyLabel = "Property Test";

// Mode ids
const exploreId = "mode.explore";
const fuzzId = "mode.fuzz";
const exampleId = "mode.example";
const propertyId = "mode.property";

// Pin button states
const pinState = {
  htmlPinned: `<span class="codicon codicon-pinned"></span>`,
  htmlPin: `<span class="codicon codicon-pin"></span>`,
  classPinned: "fuzzGridCellPinned",
  classPin: "fuzzGridCellPin",
};

// Implicit Oracle Validator Name
const implicitOracleValidatorName = "none";

// Correct icon states
const correctState = {
  htmlCheck: `<span class="codicon codicon-pass"></span>`, // check in circle
  htmlError: `<span class="codicon codicon-error"></span>`, // X in circle
  classCheckOn: "classCheckOn",
  classCheckOff: "classCheckOff",
  classErrorOn: "classErrorOn",
  classErrorOff: "classErrorOff",
};

const expandColumnState = {
  htmlHidden: `<span class="tooltipped tooltipped-nw" aria-label="Expand custom validator column">
                  <span class="codicon codicon-chevron-right" style=""></span>
                </span>`,
  htmlOpen: `<span class="tooltipped tooltipped-nw" aria-label="Collapse custom validator columns">
              <span class="codicon codicon-chevron-left" style=""></span>
            </span>`,
};

// Correct icon sorting validator results
const validatorResult = {
  true: 3,
  false: 2,
  undefined: 1,
};

// Sort order for each grid and column
const sortOrder = ["asc", "desc", "none"];
function getDefaultColumnSortOrder() {
  return {
    [pinnedLabel]: "desc",
    [correctLabel]: "desc",
    [expandColumnLabel]: "asc", // THISISME
  };
}
const defaultColumnSortOrders = {
  failure: {}, // no pinned column
  timeout: getDefaultColumnSortOrder(),
  exception: getDefaultColumnSortOrder(),
  badValue: getDefaultColumnSortOrder(),
  ok: getDefaultColumnSortOrder(),
  disagree: getDefaultColumnSortOrder(),
};

// Column sort orders (filled by main or handleColumnSort())
let columnSortOrders;
// Fuzzer Results (filled by main during load event)
let resultsData;
// Results grouped by type (filled by main during load event)
let data = {};
// Validator functions (filled by main during load event)
let validators;
// Mode (filled by main during load event)
let mode;

/**
 * Sets up the UI when the page is loaded, including setting up
 * event handlers and filling the output grids if data is available.
 */
function main() {
  // Add event listener for the fuzz.start button
  document
    .getElementById("fuzz.start")
    .addEventListener("click", (e) => handleFuzzStart(e.currentTarget));

  // Add event listener for the fuzz.options button
  document
    .getElementById("fuzz.options")
    .addEventListener("click", (e) => toggleFuzzOptions(e));

  // Add event listener for the fuzz.options close button
  document
    .getElementById("fuzzOptions-close")
    .addEventListener("click", (e) => toggleFuzzOptions(e));

  // Add event listener for the fuzz.changeMode button
  document
    .getElementById("fuzz.changeMode")
    .addEventListener("click", (e) => toggleChangeModePanel(e));

  // Add event listener for the fuzz.changeMode close button
  document
    .getElementById("changeMode-close")
    .addEventListener("click", (e) => toggleChangeModePanel(e));

  // Add event listener for the change mode push buttons
  document.getElementById(exploreId).addEventListener("click", (e) => {
    handleChangeMode(exploreId);
  });
  document.getElementById(fuzzId).addEventListener("click", (e) => {
    handleChangeMode(fuzzId);
  });
  document.getElementById(exampleId).addEventListener("click", (e) => {
    handleChangeMode(exampleId);
  });
  document.getElementById(propertyId).addEventListener("click", (e) => {
    handleChangeMode(propertyId);
  });

  //THISISME
  // Add event listener for the change mode dropdown options
  document.getElementById("dropdown.fuzz").addEventListener("click", (e) => {
    handleChangeMode(fuzzId);
  });
  document.getElementById("dropdown.example").addEventListener("click", (e) => {
    handleChangeMode(exampleId);
  });
  document
    .getElementById("dropdown.property")
    .addEventListener("click", (e) => {
      handleChangeMode(propertyId);
    });

  // Load the fuzzer results data from the HTML
  resultsData = JSON5.parse(
    htmlUnescape(document.getElementById("fuzzResultsData").innerHTML)
  );

  // Add event listener for the validator buttons
  document
    .getElementById("validator.add")
    .addEventListener("click", (e) => handleAddValidator(e));
  document
    .getElementById(`validator.getList`)
    .addEventListener("click", (e) => handleGetListOfValidators(e));

  // Load & display the validator functions from the HTML
  validators = JSON5.parse(
    htmlUnescape(document.getElementById("validators").innerHTML)
  );
  refreshValidators(validators);

  mode = JSON5.parse(
    htmlUnescape(document.getElementById("fuzzMode").innerHTML)
  );

  console.log("THIS IS THE mode: ", mode);

  // Load column sort orders from the HTML
  columnSortOrders = JSON5.parse(
    htmlUnescape(document.getElementById("fuzzSortColumns").innerHTML)
  );
  if (Object.keys(columnSortOrders).length === 0) {
    columnSortOrders = defaultColumnSortOrders;
  }

  // Listen for messages from the extension
  window.addEventListener("message", (event) => {
    const { command, json } = event.data;
    switch (command) {
      case "validator.list":
        refreshValidators(JSON5.parse(json));
        break;
      case "mode.retest":
        handleFuzzStart(document.getElementById(JSON5.parse(json)));
        break;
    }
  });

  // Load and save the state back to the webview.  There does not seem to be
  // an 'official' way to directly persist state within the extension itself,
  // at least as of vscode 1.69.2.  Hence, the roundtrip.
  vscode.setState(
    JSON5.parse(
      htmlUnescape(document.getElementById("fuzzPanelState").innerHTML)
    )
  );

  // Fill the result grids
  if (Object.keys(resultsData).length) {
    gridTypes.forEach((type) => {
      data[type] = [];
    });

    // Loop over each result
    let idx = 0;
    for (const e of resultsData.results) {
      // Indicate which tests are pinned
      const pinned = { [pinnedLabel]: !!(e.pinned ?? false) };
      const id = { [idLabel]: idx++ };

      // Implicit validation result
      const passedImplicit = resultsData.env.options.useImplicit
        ? { [implicitLabel]: e.passedImplicit }
        : {};

      // Human validation expectation and result
      const passedHuman = resultsData.env.options.useHuman
        ? { [correctLabel]: e.passedHuman }
        : {};
      const expectedOutput = resultsData.env.options.useHuman
        ? { [expectedLabel]: e.expectedOutput }
        : {};

      // Custom validator (bool, true if passed all custom validators)
      const passedValidator = resultsData.env.options.useProperty
        ? { [validatorLabel]: e.passedValidator }
        : {};

      // Custom validator (array of bools for all custom validators, true if passed)
      const allValidators = resultsData.env.options.useProperty
        ? { [allValidatorsLabel]: e.passedValidators }
        : {};

      // Custom validator result
      const validatorFns = {};
      for (const v in e.passedValidators) {
        validatorFns[validators.validators[v]] = e.passedValidators[v];
      }

      // Test case runtime
      const elapsedTime = {
        [elapsedTimeLabel]: e.elapsedTime.toFixed(3),
      };

      // Name each input argument and make it clear which inputs were not provided
      // (i.e., the argument was optional).  Otherwise, stringify the value for
      // display.
      const inputs = {};
      e.input.forEach((i) => {
        inputs[`input: ${i.name}`] =
          i.value === undefined ? "(no input)" : JSON5.stringify(i.value);
      });

      // There are 0-1 outputs: if an output is present, just name it `output`
      // and make it clear which outputs are undefined.  Otherwise, stringify
      // the value for display.
      const outputs = {};
      e.output.forEach((o) => {
        outputs[`output`] =
          o.value === undefined ? "undefined" : JSON5.stringify(o.value);
      });
      if (e.validatorException) {
        outputs[`output`] =
          "(validator exception) " + e.validatorExceptionMessage;
      } else if (e.exception) {
        outputs[`output`] = "(exception) " + e.exceptionMessage;
      }
      if (e.timeout) {
        outputs[`output`] = "(timeout)";
      }

      // Toss each result into the appropriate grid
      if (e.category === "failure") {
        data[e.category].push({
          ...id,
          ...inputs,
          ...outputs, // Exception message contained in outputs
        });
      } else {
        data[e.category].push({
          ...id,
          ...inputs,
          ...outputs,
          //...elapsedTimes,
          ...passedImplicit,
          ...passedValidator,
          ...allValidators,
          ...validatorFns,
          ...passedHuman,
          ...pinned,
          ...expectedOutput,
        });
      }
    } // for: each result

    console.log("data:", data);

    // Fill the grids with data
    gridTypes.forEach((type) => {
      if (data[type].length) {
        const thead = document.getElementById(`fuzzResultsGrid-${type}-thead`);
        const tbody = document.getElementById(`fuzzResultsGrid-${type}-tbody`);

        // Render the header row
        const hRow = thead.appendChild(document.createElement("tr"));
        Object.keys(data[type][0]).forEach((k) => {
          if (k === pinnedLabel) {
            const cell = hRow.appendChild(document.createElement("th"));
            cell.style = "text-align: center";
            cell.className = "fuzzGridCellPinned";
            cell.innerHTML = /* html */ `
              <span class="tooltipped tooltipped-nw" aria-label="Include in Jest test suite">
                <big>pin</big>
              </span>`;
            cell.addEventListener("click", () => {
              handleColumnSort(cell, hRow, type, k, tbody, true);
            });
          } else if (hiddenColumns.indexOf(k) !== -1) {
            // noop (hidden)
          } else if (k === implicitLabel) {
            if (resultsData.env.options.useImplicit) {
              // if mode === fuzz
              const cell = hRow.appendChild(document.createElement("th"));
              cell.style = "text-align: center";
              cell.classList.add("colorColumn");
              cell.innerHTML = /* html */ `
              <span class="tooltipped tooltipped-nw" aria-label="Heuristic validator. Fails: timeout, exception, null, undefined, Infinity, &amp; NaN">
                <span class="codicon codicon-debug"></span>
              </span>`;
              cell.addEventListener("click", () => {
                handleColumnSort(cell, hRow, type, k, tbody, true);
              });
            }
          } else if (k === validatorLabel) {
            if (resultsData.env.options.useProperty) {
              const cell = hRow.appendChild(document.createElement("th"));
              cell.style = "text-align: center;";
              cell.classList.add("colorColumn");
              cell.innerHTML = /* html */ `
                <span class="tooltipped tooltipped-nw" aria-label="Custom validators (summary)">
                  <span class="codicon codicon-hubot" style="font-size:1.4em;"></span>
                </span>`;
              cell.setAttribute("id", k);
              cell.addEventListener("click", () => {
                handleColumnSort(cell, hRow, type, k, tbody, true);
              });
              const expandCell = hRow.appendChild(document.createElement("th")); // twistie col
              expandCell.innerHTML =
                columnSortOrders[type][expandColumnLabel] === "asc"
                  ? expandColumnState.htmlHidden
                  : expandColumnState.htmlOpen;

              expandCell.setAttribute("id", type + "-" + expandColumnLabel);
              expandCell.addEventListener("click", () => {
                toggleExpandColumn(cell, expandCell, type);
              });
            }
          } else if (validators.validators.indexOf(k) !== -1) {
            if (resultsData.env.options.useProperty) {
              // if mode === property
              const cell = hRow.appendChild(document.createElement("th"));
              cell.style = "text-align: center";
              cell.classList.add("colorColumn");
              cell.innerHTML = /* html */ `
                <span class="tooltipped tooltipped-nw" aria-label="${k}">
                  <span class="codicon codicon-hubot" style="font-size: 1em;"></span> <!-- small -->
                </span>`;
              cell.setAttribute("id", type + "-" + k);
              // if (columnSortOrders[type][expandColumnLabel] === "asc") {
              const expandCell = document.getElementById(
                type + "-" + expandColumnLabel
              );
              if (expandCell.innerHTML === expandColumnState.htmlHidden) {
                cell.classList.add("hidden"); // Make hidden (collapsible columns)
              }
              cell.addEventListener("click", () => {
                handleColumnSort(cell, hRow, type, k, tbody, true);
              });
            }
          } else if (k === correctLabel) {
            if (
              mode === fuzzLabel ||
              mode === exampleLabel ||
              mode === propertyLabel
            ) {
              const cell = hRow.appendChild(document.createElement("th"));
              cell.style = "text-align: center";
              cell.classList.add("colorColumn");
              cell.innerHTML = /* html */ `
              <span class="tooltipped tooltipped-nw" aria-label="Human (manual) validation">
                <span class="codicon codicon-person" id="humanIndicator"></span>
              </span>`;
              cell.colSpan = 2;
              cell.addEventListener("click", () => {
                handleColumnSort(cell, hRow, type, k, tbody, true);
              });
            }
          } else {
            const cell = hRow.appendChild(document.createElement("th"));
            cell.innerHTML = `<big>${htmlEscape(k)}</big>`;
            cell.addEventListener("click", () => {
              handleColumnSort(cell, hRow, type, k, tbody, true);
            });
          }
        }); // for each column k

        // Render the data rows, set up event listeners
        drawTableBody(type, tbody, false);

        // Initial sort, according to columnSortOrders
        let hRowIdx = 0;
        for (let i = 0; i < Object.keys(data[type][0]).length; ++i) {
          const col = Object.keys(data[type][0])[i];
          let cell = hRow.cells[hRowIdx];
          if (hiddenColumns.indexOf(col) !== -1) {
            continue; // hidden column (id, expected, allValidators)
          }
          if (cell.id === type + "-" + expandColumnLabel) {
            cell = hRow.cells[++hRowIdx]; // displayed but blank column; not in data[type]
          }
          if (
            (col === implicitLabel && !resultsData.env.options.useImplicit) ||
            (validators.validators.indexOf(col) !== -1 &&
              !resultsData.env.options.useProperty)
          ) {
            // if mode === fuzz, or mode === property
            continue; // hidden depending on mode
          }
          // Otherwise, sort column
          handleColumnSort(cell, hRow, type, col, tbody, false);
          ++hRowIdx;
        } // for i
      } // if data[type].length
    }); // for each type (e.g. bad output, passed)
  }
} // fn: main()

/**
 * Toggles whether more fuzzer options are shown.
 *
 * @param e onClick() event
 */
function toggleFuzzOptions(e) {
  const fuzzOptions = document.getElementById("fuzzOptions");
  const fuzzOptionsButton = document.getElementById("fuzz.options");
  if (isHidden(fuzzOptions)) {
    toggleHidden(fuzzOptions);
    // fuzzOptionsButton.innerHTML = "Fewer options";
  } else {
    toggleHidden(fuzzOptions);
    // fuzzOptionsButton.innerHTML = "More options";
  }

  // Refresh the list of validators
  handleGetListOfValidators();
} // fn: toggleFuzzOptions()

/**
 * Toggles whether the NaNoguide 'change mode' panel is shown.
 *
 * @param e onClick() event
 */
function toggleChangeModePanel(e) {
  const changeModePane = document.getElementById("pane-nanoguide");
  const fuzzPane = document.getElementById("pane-nanofuzz");
  const changeModeButton = document.getElementById("fuzz.mode");
  console.log("toggleChangeMode:\n");
  toggleHidden(changeModePane);
  toggleHidden(fuzzPane);

  // if (isHidden(changeModePanel)) {
  //   fuzzOptionsButton.innerHTML = "Fewer options";
  // } else {
  //   toggleHidden(fuzzOptions);
  //   fuzzOptionsButton.innerHTML = "More options";
  // }
} // fn: toggleChangeModePanel()

/**
 * Toggles whether a test is pinned for CI and the next test run.
 *
 * @param id offset of test in resultsData
 * @param type grid type (e.g., passed, invalid)
 * @param data the back-end data structure
 */
function handlePinToggle(id, type) {
  const index = data[type].findIndex((element) => element.id == id);
  if (index <= -1) throw e("invalid id");

  // Get the control that was clicked
  const button = document.getElementById(`fuzzSaveToggle-${id}`);

  // Are we pinning or unpinning the test?
  const pinning = button.innerHTML === pinState.htmlPin;
  data[type][index][pinnedLabel] = pinning;

  // Get the test data for the test case
  const testCase = {
    input: resultsData.results[id].input,
    output: resultsData.results[id].output,
    pinned: data[type][index][pinnedLabel],
  };
  if (data[type][index][expectedLabel]) {
    testCase.expectedOutput = data[type][index][expectedLabel];
  }

  // Disable the control while we wait for the response
  button.disabled = true;

  // Send the request to the extension
  window.setTimeout(() => {
    vscode.postMessage({
      command: pinning ? "test.pin" : "test.unpin",
      json: JSON5.stringify(testCase),
    });

    // Update the control state
    if (pinning) {
      button.innerHTML = pinState.htmlPinned;
      button.className = pinState.classPinned;
      button.setAttribute("aria-label", "pinned");
    } else {
      button.innerHTML = pinState.htmlPin;
      button.className = pinState.classPin;
      button.setAttribute("aria-label", "pin");
    }

    // Disable the control while we wait for the response
    button.disabled = false;
  });
} // fn: handleSaveToggle()

/**
 * Toggles the correct icons on or off (check mark, X mark, question mark).
 *
 * @param button icon that was clicked
 * @param row current row
 * @param type e.g. bad output, passed
 * @param tbody table body for 'type'
 * @param cell1 check icon
 * @param cell2 error icon
 */
function handleCorrectToggle(button, row, type, tbody, cell1, cell2) {
  const id = row.getAttribute("id");
  const index = data[type].findIndex((element) => element.id == id);
  if (index <= -1) throw e("invalid id");

  // Change the state of the correct icon that was clicked
  // Only one icon should be selected at a time; if an icon is turned on, all
  // others should be turned off
  if (button.classList.contains(correctState.classCheckOn)) {
    // clicking check off
    button.className = correctState.classCheckOff;
    button.setAttribute("onOff", "false");
    data[type][index][correctLabel] = undefined;
    // delete saved expected value
    delete data[type][index][expectedLabel];
  } else if (button.classList.contains(correctState.classErrorOn)) {
    // clicking error off
    button.className = correctState.classErrorOff;
    button.setAttribute("onOff", "false");
    data[type][index][correctLabel] = undefined;
    // delete saved expected value
    delete data[type][index][expectedLabel];
  } else if (button.classList.contains(correctState.classCheckOff)) {
    // clicking check on
    button.className = correctState.classCheckOn;
    button.setAttribute("onOff", "true");
    data[type][index][correctLabel] = "true";
    // turn others off
    cell2.className = correctState.classErrorOff;
    cell2.setAttribute("onOff", "false");
    //save expected output value
    if (resultsData.results[id].timeout === true) {
      data[type][index][expectedLabel] = [
        { name: "0", offset: 0, isTimeout: true },
      ];
    } else if (resultsData.results[id].exception === true) {
      data[type][index][expectedLabel] = [
        { name: "0", offset: 0, isException: true },
      ];
    } else {
      data[type][index][expectedLabel] = resultsData.results[id].output;
    }
  } else if (button.classList.contains(correctState.classErrorOff)) {
    // clicking error on
    button.className = correctState.classErrorOn;
    button.setAttribute("onOff", "true");
    data[type][index][correctLabel] = "false";
    // turn others off
    cell1.className = correctState.classCheckOff;
    cell1.setAttribute("onOff", "false");
    // save expected output value
    data[type][index][expectedLabel] = resultsData.results[id].output;
  }

  // Redraw table !!!!! Do we need to do this?
  drawTableBody(type, tbody, true, button);

  const onOff = JSON.parse(button.getAttribute("onOff"));
  const pinCell = document.getElementById(`fuzzSaveToggle-${id}`);
  const isPinned = pinCell.className === pinState.classPinned;

  // Get the test data for the test case
  const testCase = {
    input: resultsData.results[id].input,
    output: resultsData.results[id].output,
    pinned: isPinned,
    expectedOutput: data[type][index][expectedLabel],
  };

  // Disable the control while we wait for the response
  button.disabled = true;

  // Send the request to the extension
  window.setTimeout(() => {
    vscode.postMessage({
      command: onOff ? "test.pin" : "test.unpin",
      json: JSON5.stringify(testCase),
    });
    // Disable the control while we wait for the response
    button.disabled = false;
  });
}

function toggleExpandColumn(cell, expandCell, type) {
  const thead = document.getElementById(`fuzzResultsGrid-${type}-thead`);
  const tbody = document.getElementById(`fuzzResultsGrid-${type}-tbody`);

  const valIdx = getIdxInTableHeader(
    type + "-" + validators.validators[0],
    thead.rows[0]
  );

  // Show or hide custom validator fn header
  for (const valName of validators.validators) {
    toggleHidden(document.getElementById(type + "-" + valName));
  }
  // Show or hide custom validator table cells
  for (const row of tbody.rows) {
    if (row.getAttribute("class") === "classErrorExpectedOutputRow") continue;
    for (let i = valIdx; i < valIdx + validators.validators.length; ++i)
      toggleHidden(row.cells[i]);
  }

  // Update frontend
  if (expandCell.innerHTML === expandColumnState.htmlHidden) {
    expandCell.innerHTML = expandColumnState.htmlOpen;
    // cell.classList.remove("hidden"); /// What do we want to do with the summary column????
  } else {
    expandCell.innerHTML = expandColumnState.htmlHidden;
  }

  // Send message to extension to retain whether columns are expanded or hidden
  columnSortOrders[type][expandColumnLabel] =
    expandCell.innerHTML === expandColumnState.htmlHidden ? "asc" : "desc";
  vscode.postMessage({
    command: "columns.sorted",
    json: JSON5.stringify(columnSortOrders),
  });
}

/**
 * Sorts table based on a column (each column toggles between asc, desc, none).
 * The most recent column clicked has the highest precedence.
 * Uses stable sort, so previously sorted rows will not change unless they have to.
 *
 * @param cell cell of hRow
 * @param hRow header row
 * @param type (timeout, exception, badValue, ok, etc.)
 * @param col (ex: input:a, output, pin)
 * @param tbody table body
 * @param isClicking true if user clicked a column; false if an 'initial sort'
 *
 * 'Initial sort' could be:
 *  - Making sure the pinned/correct columns are sorted at the beginning
 *  - Making sure we retain previous sort settings if you click 'Test' again
 */
function handleColumnSort(cell, hRow, type, column, tbody, isClicking) {
  // We are only explicitly sorting by one column at a time (with the pinned and correct
  // columns being special cases)
  // Reset the other column arrows to 'none'
  resetOtherColumnArrows(hRow, type, column, isClicking);

  // Update the sort arrow for this column (asc->desc etc, and frontend)
  updateColumnArrow(cell, type, column, isClicking);

  // Define sorting function:
  // Sort current column value based on sort order
  const sortFn = (a, b, thisCol) => {
    if (columnSortOrders[type][thisCol] == "none") {
      return 0; // no need to sort
    } else if (columnSortOrders[type][thisCol] == "desc") {
      const temp = a;
      (a = b), (b = temp); // swap a and b
    }
    // Determine type of object
    let aType;
    try {
      aType = typeof JSON.parse(a[thisCol]);
    } catch (error) {
      aType = "string";
    }
    // Save original strings (to break ties alphabetically)
    let aVal = (a[thisCol] ?? "undefined") + "";
    let bVal = (b[thisCol] ?? "undefined") + "";

    // How are we sorting?
    if (thisCol === correctLabel || thisCol === validatorLabel) {
      // Sort by numerical values in validatorResult map.
      a = validatorResult[(a[thisCol] ?? "undefined") + ""];
      b = validatorResult[(b[thisCol] ?? "undefined") + ""];
    } else {
      switch (aType) {
        case "number":
          // Sort numerically
          (a = Number(a[thisCol])), (b = Number(b[thisCol]));
          break;
        case "object":
          // Sort by length
          if (a[thisCol].length) {
            (a = a[thisCol].length), (b = b[thisCol].length);
            // If numerical values, break ties based on number
            try {
              (aVal = JSON.parse(a[thisCol])), (bVal = JSON.parse(b[thisCol]));
            } catch (error) {
              // noop; if not numerical, break ties alphabetically
            }
          } else {
            a = Object.keys(a[thisCol]).length;
            b = Object.keys(b[thisCol]).length;
          }
          break;
        default:
          // Sort as string by length, break ties alphabetically
          (a = (a[thisCol] ?? "").length), (b = (b[thisCol] ?? "").length);
          break;
      } // switch
    }
    // Compare values and sort
    if (a === b) {
      if (aVal === bVal) {
        return 0; // a = b
      } else if (aVal > bVal) {
        return 2; // break tie
      } else {
        return -2; // break tie
      }
    } else if (a > b) {
      return 2; // a > b
    } else {
      return -2; // a < b
    }
  }; // fn: sortFn()

  // Call sorting function:
  // Sort data in order of sort columns (next col is tiebreaker for current col)
  data[type].sort((a, b) => {
    for (const col of Object.keys(columnSortOrders[type])) {
      const result = sortFn(a, b, col);
      if (result !== 0) return result;
    }
    return 0; // a = b for all columns
  });

  // Sorting done, display table
  drawTableBody(type, tbody, false);

  // Send message to extension to retain sort order
  if (isClicking) {
    vscode.postMessage({
      command: "columns.sorted",
      json: JSON5.stringify(columnSortOrders),
    });
  }
} // fn: handleColumnSort

/**
 * For a given type, set columns arrows to 'none', unless the column is
 * the current column being sorted by. The 'pinned' column is a special case
 *
 * @param hRow header row
 * @param type (timeout, exception, badValue, ok)
 * @param thisCol the current column being sorted by
 * @param isClicking
 */
function resetOtherColumnArrows(hRow, type, thisCol, isClicking) {
  if (!isClicking) return;
  // For a given type, iterate over the columns (ex: input a, output, pin)
  let hRowIdx = 0;
  for (let i = 0; i < Object.keys(data[type][0]).length; ++i) {
    const col = Object.keys(data[type][0])[i];
    let cell = hRow.cells[hRowIdx];
    console.log("col,cell:", col, cell);

    if (hiddenColumns.indexOf(col) !== -1) {
      continue; // hidden column (id, expected, allValidators)
    }
    if (cell.id === type + "-" + expandColumnLabel) {
      cell = hRow.cells[++hRowIdx]; // displayed but blank column; not in data[type]
    }
    if (
      (col === implicitLabel && !resultsData.env.options.useImplicit) ||
      (validators.validators.indexOf(col) !== -1 &&
        !resultsData.env.options.useProperty)
    ) {
      continue; // hidden depending on checkboxes
    }
    if (col === thisCol || col === "pinned" || thisCol == "pinned") {
      ++hRowIdx;
      continue; // no need to reset
    }

    // Reset the column arrow to 'none'
    delete columnSortOrders[type][col];
    cell.classList.remove("columnSortAsc");
    cell.classList.remove("columnSortDesc");
    ++hRowIdx;
  } // for i
}

/**
 * Displays column arrow in header row, and updates columnSortOrders
 *
 * @param cell cell of hRow
 * @param type (timeout, exception, badValue, ok, etc.)
 * @param col (ex: input:a, output, pin)
 * @param isClicking bool determining if the initial sort is occurring, or if the function
 * is being called because the user clicked on a column
 * @returns
 */
function updateColumnArrow(cell, type, col, isClicking) {
  // Pinned column is a special case -- will always check at the end to see if it wants
  // the pinned column sorted in a certain way. That arrow should be displayed.
  let currOrder = columnSortOrders[type][col]; // 'asc', 'desc', or 'none'
  let currIndex = -1; // index in sortOrder array

  if (isClicking) {
    if (!currOrder) {
      // Set default if undefined
      currOrder = "asc";
      currIndex = 0; // index in [asc, desc, none]
    } else {
      // Update sorting direction (asc -> desc, desc -> none, none -> asc)
      const idx = sortOrder.indexOf(currOrder);
      currIndex = (idx + 1) % sortOrder.length;
      currOrder = sortOrder[currIndex];
    }
    // Update columnSortOrders
    columnSortOrders[type][col] = currOrder;
    if (currOrder === "none") delete columnSortOrders[type][col];
  }

  if (!isClicking && !currOrder) return;
  // Update frontend with appropriate arrow
  switch (currOrder) {
    case "asc":
      cell.classList.add("columnSortAsc");
      cell.classList.remove("columnSortDesc");
      break;
    case "desc":
      cell.classList.add("columnSortDesc");
      cell.classList.remove("columnSortAsc");
      break;
    case "none":
      cell.classList.remove("columnSortDesc");
      cell.classList.remove("columnSortAsc");
      break;
    default:
      assert(false); // shouldn't get here
  }
} //fn: updateColumnArrows

/**
 * Draw table body and fill in with values from data[type]. Add event listeners
 * for pinning, toggling correct icons
 *
 * @param data backend data structure
 * @param type e.g. bad output, passed, etc
 * @param tbody table body
 * @param isClicking bool true if user is clicking
 */
function drawTableBody(type, tbody, isClicking, button) {
  // console.log("resultsData.env.options:", resultsData.env.options);
  // Clear table
  while (tbody.rows.length > 0) tbody.deleteRow(0);

  // For each entry in data[type]
  data[type].forEach((e) => {
    let id = -1;
    const row = tbody.appendChild(document.createElement("tr"));
    Object.keys(e).forEach((k) => {
      if (k === pinnedLabel) {
        const cell = row.appendChild(document.createElement("td"));
        // Add pin icon
        cell.className = e[k] ? pinState.classPinned : pinState.classPin;
        cell.id = `fuzzSaveToggle-${id}`;
        cell.setAttribute("aria-label", e[k] ? "pinned" : "pin");
        cell.innerHTML = e[k] ? pinState.htmlPinned : pinState.htmlPin;
        cell.addEventListener("click", (e) =>
          handlePinToggle(
            e.currentTarget.parentElement.getAttribute("id"),
            type
          )
        );
      } else if (k === idLabel) {
        id = parseInt(e[k]);
        row.setAttribute("id", id);
      } else if (hiddenColumns.indexOf(k) !== -1) {
        // noop (hidden)
      } else if (k === implicitLabel) {
        if (resultsData.env.options.useImplicit) {
          // if mode === fuzz
          const cell = row.appendChild(document.createElement("td"));
          // Fade the indicator if overridden by another validator
          if (
            e[correctLabel] !== undefined ||
            e[validatorLabel] !== undefined
          ) {
            cell.style.opacity = "35%";
          }
          if (e[k] === undefined) {
            cell.innerHTML = "";
          } else if (e[k]) {
            cell.classList.add("classCheckOn", "colGroupStart", "colGroupEnd");
            const span = cell.appendChild(document.createElement("span"));
            span.classList.add("codicon", "codicon-pass");
          } else {
            cell.classList.add("classErrorOn", "colGroupStart", "colGroupEnd");
            const span = cell.appendChild(document.createElement("span"));
            span.classList.add("codicon", "codicon-error");
          }
        }
      } else if (k === validatorLabel) {
        if (resultsData.env.options.useProperty) {
          const cell = row.appendChild(document.createElement("td"));
          if (e[k] === undefined) {
            cell.innerHTML = "";
          } else if (e[k]) {
            cell.classList.add("classCheckOn", "colGroupStart", "colGroupEnd");
            const span = cell.appendChild(document.createElement("span"));
            span.classList.add("codicon", "codicon-pass");
          } else {
            cell.classList.add("classErrorOn", "colGroupStart", "colGroupEnd");
            const span = cell.appendChild(document.createElement("span"));
            span.classList.add("codicon", "codicon-error");
          }
          row.appendChild(document.createElement("td")); // empty (for expanded column)
        }
      } else if (validators.validators.indexOf(k) !== -1) {
        if (resultsData.env.options.useProperty) {
          // if mode === property
          const cell = row.appendChild(document.createElement("td"));
          if (e[k] === undefined) {
            cell.innerHTML = "";
          } else if (e[k]) {
            cell.classList.add("classCheckOn", "colGroupStart", "colGroupEnd");
            const span = cell.appendChild(document.createElement("span"));
            span.classList.add("codicon", "codicon-pass");
            // drawValidatorRow(data, type, row);

            if (!e[validatorLabel]) {
              // if check mark and not on passed tab (passed everything)
              // span.classList.add("codicon", "codicon-pass-filled");
              cell.style.opacity = "35%";
            }
          } else {
            cell.classList.add("classErrorOn", "colGroupStart", "colGroupEnd");
            const span = cell.appendChild(document.createElement("span"));
            span.classList.add("codicon", "codicon-error");
            // drawValidatorRow(data, type, row);
          }
          const expandCol = document.getElementById(
            type + "-" + expandColumnLabel
          );
          if (expandCol.innerHTML === expandColumnState.htmlHidden) {
            cell.classList.add("hidden"); // Make hidden (collapsible columns)
          } else {
            cell.classList.remove("hidden");
          }
        }
      } else if (k === correctLabel) {
        //if mode === fuzzLabel or exampleLabel or propertyLabel
        // Add check mark icon
        const cell1 = row.appendChild(document.createElement("td"));
        cell1.innerHTML = correctState.htmlCheck;
        cell1.setAttribute("correctType", "true");
        cell1.addEventListener("click", () =>
          handleCorrectToggle(cell1, row, type, tbody, cell1, cell2)
        );
        // Add X mark icon
        const cell2 = row.appendChild(document.createElement("td"));
        cell2.innerHTML = correctState.htmlError;
        cell2.setAttribute("correctType", "false");
        cell2.addEventListener("click", () =>
          handleCorrectToggle(cell2, row, type, tbody, cell1, cell2)
        );

        // Defaults here; override in the switch below
        cell1.className = correctState.classCheckOff;
        cell1.setAttribute("onOff", "false");
        cell2.className = correctState.classErrorOff;
        cell2.setAttribute("onOff", "false");

        // Update the front-end buttons to match the back-end state
        switch (e[k] + "") {
          case undefined:
            break;
          case "true":
            cell1.className = correctState.classCheckOn;
            cell1.setAttribute("onOff", "true");
            handleExpectedOutput(type, row, tbody, isClicking, button);
            break;
          case "false":
            cell2.className = correctState.classErrorOn;
            cell2.setAttribute("onOff", "true");
            handleExpectedOutput(type, row, tbody, isClicking, button);
            break;
        }
        cell1.classList.add("colGroupStart");
        cell2.classList.add("colGroupEnd");
      } else {
        const cell = row.appendChild(document.createElement("td"));
        cell.innerHTML = htmlEscape(e[k]);
      }
    });
  });
} //fn: drawTableBody()

/**
 * Draw row for custom validator functions (e.g. failed: 3  passed: 1)
 *
 * @param data backend data structure
 * @param type e.g. bad output, passed, disagree
 * @param row row of tbody
 */
function addValidatorColumn(type, row) {
  const id = row.getAttribute("id");
  const index = data[type].findIndex((element) => element.id == id);
  if (index <= -1) {
    throw new Error("invalid id");
  }
  // const correctType = data[type][index][validatorLabel];
  // const numInputs = resultsData.results[id].input.length;

  // If actual output does not match expected output, show expected/actual output
  const validatorRow = row.insertAdjacentElement(
    "afterend",
    document.createElement("tr")
  );
  const cell = validatorRow.appendChild(document.createElement("td"));
  cell.colSpan = getColCountForTable(type);

  const validatorsFailed = [];
  const validatorsPassed = [];
  for (let i in data[type][index].allValidators) {
    if (data[type][index].allValidators[i]) {
      validatorsPassed.push(validators.validators[i]);
    } else {
      validatorsFailed.push(validators.validators[i]);
    }
  }
  // prettier-ignore
  cell.innerHTML = /* html */ `
  <div class="slightFade">
    <span class="codicon codicon-hubot"></span>
  </div>
  <div>
    <span class="tooltipped tooltipped-ne" aria-label="failed:\n ${toNewLineList(validatorsFailed)}">
      <div class="slightFade"> 
        &nbsp; <u> failed</u>: ${validatorsFailed.length}
      </div>
    </span>
    <span class="tooltipped tooltipped-ne" aria-label="passed:\n ${toNewLineList(validatorsPassed)}">
      <div class="slightFade">  
        &nbsp; <u> passed</u>: ${validatorsPassed.length}
      </div>
    </span>
  </div>
  `;
  // Marked X but not currently being edited; display expected output
  // row.cells[numInputs].className = "classErrorCell"; // red wavy underline
  validatorRow.className = "classErrorExpectedOutputRow";
} // fn: drawValidatorRow()

/**
 * Draw row for custom validator functions (e.g. failed: 3  passed: 1)
 *
 * @param data backend data structure
 * @param type e.g. bad output, passed, disagree
 * @param row row of tbody
 */
function drawValidatorRow(type, row) {
  const id = row.getAttribute("id");
  const index = data[type].findIndex((element) => element.id == id);
  if (index <= -1) {
    throw new Error("invalid id");
  }
  // const correctType = data[type][index][validatorLabel];
  // const numInputs = resultsData.results[id].input.length;

  // If actual output does not match expected output, show expected/actual output
  const validatorRow = row.insertAdjacentElement(
    "afterend",
    document.createElement("tr")
  );
  const cell = validatorRow.appendChild(document.createElement("td"));
  cell.colSpan = getColCountForTable(type);

  const validatorsFailed = [];
  const validatorsPassed = [];
  for (let i in data[type][index].allValidators) {
    if (data[type][index].allValidators[i]) {
      validatorsPassed.push(validators.validators[i]);
    } else {
      validatorsFailed.push(validators.validators[i]);
    }
  }
  // prettier-ignore
  cell.innerHTML = /* html */ `
  <div class="slightFade">
    <span class="codicon codicon-hubot"></span>
  </div>
  <div>
    <span class="tooltipped tooltipped-ne" aria-label="failed:\n ${toNewLineList(validatorsFailed)}">
      <div class="slightFade"> 
        &nbsp; <u> failed</u>: ${validatorsFailed.length}
      </div>
    </span>
    <span class="tooltipped tooltipped-ne" aria-label="passed:\n ${toNewLineList(validatorsPassed)}">
      <div class="slightFade">  
        &nbsp; <u> passed</u>: ${validatorsPassed.length}
      </div>
    </span>
  </div>
  `;
  // Marked X but not currently being edited; display expected output
  // row.cells[numInputs].className = "classErrorCell"; // red wavy underline
  validatorRow.className = "classErrorExpectedOutputRow";
} // fn: drawValidatorRow()

/**
 * Checks if actual output matches expected output (based on correct icons selected).
 * If not, shows error message.
 * Assumes that either the check or error icon is selected.
 *
 * @param type e.g. bad output, passed
 * @param row row of tbody
 * @param tbody table body for 'type'
 */
function handleExpectedOutput(type, row, tbody, isClicking, button) {
  const id = row.getAttribute("id");
  let toggledId;
  if (isClicking) {
    toggledId =
      button.parentElement.getAttribute("id") ?? // human validation X button
      button.getAttribute("rowId"); // expected value edit button
  }

  const index = data[type].findIndex((element) => element.id == id);
  if (index <= -1) {
    throw new Error("invalid id");
  }
  const correctType = data[type][index][correctLabel];
  const numInputs = resultsData.results[id].input.length;

  // If actual output does not match expected output, show expected/actual output
  if (correctType + "" === "false") {
    const expectedRow = row.insertAdjacentElement(
      "afterend",
      document.createElement("tr")
    );
    const cell = expectedRow.appendChild(document.createElement("td"));
    cell.colSpan = getColCountForTable(type);

    if (isClicking && id === toggledId) {
      // If marked X and it's the row being clicked on, ask for expected output
      expectedRow.className = "classGetExpectedOutputRow";
      cell.innerHTML = expectedOutputHtml(id, index, type);

      // Event handler for text field
      const textField = document.getElementById(`fuzz-expectedOutput${id}`);
      textField.addEventListener("change", (e) =>
        buildExpectedTestCase(textField, id, type, index)
      );

      // Event handler for timeout radio button
      const radioTimeout = document.getElementById(`fuzz-radioTimeout${id}`);
      radioTimeout.addEventListener("change", () =>
        buildExpectedTestCase(radioTimeout, id, type, index)
      );

      // Event handler for exception radio button
      const radioException = document.getElementById(
        `fuzz-radioException${id}`
      );
      radioException.addEventListener("change", () =>
        buildExpectedTestCase(radioException, id, type, index)
      );

      // Event handler for value radio button
      const radioValue = document.getElementById(`fuzz-radioValue${id}`);
      radioValue.addEventListener("change", () =>
        buildExpectedTestCase(radioValue, id, type, index)
      );

      // Event handler for ok button
      const okButton = document.getElementById(`fuzz-expectedOutputOk${id}`);
      okButton.addEventListener("click", (e) => {
        // Build the test case from the expected output panel
        const testCase = buildExpectedTestCase(radioValue, id, type, index);

        // If the test case is valid, save it & exit the screen
        if (testCase) {
          // Update the front-end data structure
          data[type][index][expectedLabel] = testCase.expectedOutput;

          // Send the test case to the back-end
          window.setTimeout(() => {
            vscode.postMessage({
              command: "test.pin",
              json: JSON5.stringify(testCase),
            });
          });

          // Re-draw the expected output row again
          handleExpectedOutput(type, row, tbody, false, button);

          // Hide this panel that is collecting the expected output
          expectedRow.remove();
        }
      });

      // Bounce & give focus to the value field if the value radio is selected
      window.setTimeout(() => {
        if (radioValue.checked) {
          textField.focus();
        }
      });
    } else {
      // Marked X but not currently being edited; display expected output
      row.cells[numInputs].className = "classErrorCell"; // red wavy underline
      expectedRow.className = "classErrorExpectedOutputRow";

      // Display the expected outout
      const expectedOutput = data[type][index][expectedLabel];
      let expectedText;
      if (expectedOutput && expectedOutput.length) {
        if (expectedOutput[0].isTimeout) {
          expectedText = "timeout";
        } else if (expectedOutput[0].isException) {
          expectedText = "exception";
        } else {
          // expectedText = `output value: ${JSON5.stringify(expectedOutput[0].value)}`;
          expectedText = `output: ${JSON5.stringify(expectedOutput[0].value)}`;
        }
      } else {
        expectedText = "value: undefined";
      }
      cell.innerHTML = /* html */ `
        <div class="slightFade">
          <span class="codicon codicon-person"></span>
        </div>
        <div class="slightFade">
          <!-- expected ${expectedText}&nbsp; -->
          &nbsp; expected ${expectedText}&nbsp;
        </div>
        <div class="alignAsMidCell">
          <vscode-button id="fuzz-editExpectedOutput${id}" rowId="${row.id}" appearance="icon" aria-label="Edit">
            <span class="tooltipped tooltipped-n" aria-label="Edit">
              <span class="codicon codicon-edit"></span>
            </span>
          </vscode-button>
        </div>`;

      // Create event handler for edit click
      const editButton = document.getElementById(
        `fuzz-editExpectedOutput${id}`
      );
      editButton.addEventListener("click", (e) => {
        toggleHidden(expectedRow);
        handleExpectedOutput(type, row, tbody, true, editButton);
      });
    }
  }
}

/**
 * HTML for X icon expected output row. Adds radio buttons for operator
 * type -- 'not equal' (default), 'equal'. Adds text field for expected output
 *
 * @param id id of row
 * @param index index in `data`
 * @param data back-end data structure
 * @param type e.g. bad output, passed
 */
function expectedOutputHtml(id, index, type) {
  const expectedOutput = data[type][index][expectedLabel];
  let defaultOutput;

  if (expectedOutput && expectedOutput.length) {
    defaultOutput = expectedOutput[0];
  } else {
    defaultOutput = { value: "" };
  }

  // prettier-ignore
  let html = /*html*/ `
    What is the expected ouput?
    <vscode-radio-group>
      <vscode-radio id="fuzz-radioException${id}" ${defaultOutput.isException ? " checked " : ""}>Exception</vscode-radio>
      <vscode-radio class="hidden" id="fuzz-radioTimeout${id}" ${defaultOutput.isTimeout ? " checked " : ""}>Timeout</vscode-radio>
      <vscode-radio id="fuzz-radioValue${id}" ${!defaultOutput.isTimeout && !defaultOutput.isException ? " checked " : ""} >Value:</vscode-radio>
    </vscode-radio-group> 
    <div>
      <vscode-text-field id="fuzz-expectedOutput${id}" placeholder="Literal value (JSON)" value=${JSON5.stringify(defaultOutput.value)}></vscode-text-field>
      <span><vscode-button id="fuzz-expectedOutputOk${id}" aria-label="ok" style="display: table-cell; vertical-align: top;">ok</vscode-button></span>
      <span id="fuzz-expectedOutputMessage${id}"></span>
    </div>
  `;
  return html;
}

/**
 * Builds a test case from the expected output panel
 *
 * @param e on-change event
 * @param id id of row
 * @param data back-end data structure
 * @param type e.g. bad output, passed
 * @param index index in `data`
 *
 * @returns test case object or undefined if the expected value is invalid
 */
function buildExpectedTestCase(e, id, type, index) {
  const textField = document.getElementById(`fuzz-expectedOutput${id}`);
  const radioTimeout = document.getElementById(`fuzz-radioTimeout${id}`);
  const radioException = document.getElementById(`fuzz-radioException${id}`);
  const errorMessage = document.getElementById(
    `fuzz-expectedOutputMessage${id}`
  );
  const okButton = document.getElementById(`fuzz-expectedOutputOk${id}`);

  // Check if the expected value is valid JSON
  const expectedValue = textField.getAttribute("current-value");
  let parsedExpectedValue;
  try {
    // Attempt to parse the expected value
    parsedExpectedValue =
      expectedValue === null || expectedValue === "undefined"
        ? undefined
        : JSON5.parse(expectedValue);
  } catch (e) {
    // Indicate to the user that there is an error
    textField.classList.add("classErrorCell");
    errorMessage.classList.add("expectedOutputErrorMessage");
    errorMessage.innerHTML = "invalid; not saved";
    hide(okButton);

    // Return w/o saving
    return undefined;
  }

  // Update the UI -- everything looks fine
  textField.classList.remove("classErrorCell");
  errorMessage.classList.remove("expectedOutputErrorMessage");
  errorMessage.innerHTML = "";
  show(okButton);

  // Build the expected output object
  const expectedOutput = {
    name: "0",
    offset: 0,
  };
  if (radioTimeout.checked) {
    expectedOutput["isTimeout"] = true;
  } else if (radioException.checked) {
    expectedOutput["isException"] = true;
  } else {
    expectedOutput["value"] = parsedExpectedValue;
  }

  // Build & return the test case object
  return {
    input: resultsData.results[id].input,
    output: resultsData.results[id].output,
    pinned: data[type][index][pinnedLabel],
    expectedOutput: [expectedOutput],
  };
} // fn: buildExpectedTestCase()

/**
 * Handles change mode onClick() event, sends requested mode to the extension
 *
 * @param {*} mode
 */
function handleChangeMode(mode) {
  console.log("POSTING MESSAGE: ", JSON5.stringify(mode));
  // const mode = e.target.id;

  window.setTimeout(() => {
    vscode.postMessage({
      command: "mode.change",
      json: JSON5.stringify(mode),
    });
  });
} // fn: handleChangeMode()

/**
 * Handles the fuzz.start button onClick() event: retrieves the fuzzer options
 * from the UI and sends them to the extension to start the fuzzer.
 *
 * // e onClick() event
 * @param eCurrTarget current target of onClick() event
 */
function handleFuzzStart(eCurrTarget) {
  const overrides = { fuzzer: {}, args: [] }; // Fuzzer option overrides (from UI)
  const disableArr = [eCurrTarget]; // List of controls to disable while fuzzer is busy
  const fuzzBase = "fuzz"; // Base html id name

  // Process integer fuzzer options
  ["suiteTimeout", "maxTests", "fnTimeout", "maxFailures"].forEach((e) => {
    const item = document.getElementById(fuzzBase + "-" + e);
    if (item !== null) {
      disableArr.push(item);
      overrides.fuzzer[e] = parseInt(item.getAttribute("current-value"));
    }
  });

  // Process boolean fuzzer options
  ["onlyFailures", "useHuman", "useImplicit", "useProperty"].forEach((e) => {
    const item = document.getElementById(fuzzBase + "-" + e);
    if (item !== null) {
      disableArr.push(item);
      overrides.fuzzer[e] =
        (item.getAttribute("value") ?? item.getAttribute("current-checked")) ===
        "true";
    }
  });

  // Process all the argument overrides
  for (let i = 0; document.getElementById(getIdBase(i)) !== null; i++) {
    const idBase = getIdBase(i);
    const thisOverride = {};
    overrides.args.push(thisOverride);

    // Get all the possible controls for this argument
    const min = document.getElementById(idBase + "-min");
    const max = document.getElementById(idBase + "-max");
    const numInteger = document.getElementById(idBase + "-numInteger");
    const trueFalse = document.getElementById(idBase + "-trueFalse");
    const trueOnly = document.getElementById(idBase + "-trueOnly");
    const falseOnly = document.getElementById(idBase + "-falseOnly");
    const minStrLen = document.getElementById(idBase + "-minStrLen");
    const maxStrLen = document.getElementById(idBase + "-maxStrLen");

    // Process numeric overrides
    if (numInteger !== null) {
      disableArr.push(numInteger);
      thisOverride["number"] = {
        numInteger:
          numInteger.getAttribute("current-checked") === "true" ? true : false,
      };
      if (min !== null && max !== null) {
        disableArr.push(min, max);
        const minVal = min.getAttribute("current-value");
        const maxVal = max.getAttribute("current-value");
        if (minVal !== undefined && maxVal !== undefined) {
          thisOverride.number["min"] = Math.min(Number(minVal), Number(maxVal));
          thisOverride.number["max"] = Math.max(Number(minVal), Number(maxVal));
        }
      }
    } // TODO: Validation !!!

    // Process boolean overrides
    if (trueFalse !== null && trueOnly !== null && falseOnly !== null) {
      disableArr.push(trueFalse, trueOnly, falseOnly);
      thisOverride["boolean"] = {
        min: trueOnly.getAttribute("current-checked") === "true" ? true : false,
        max:
          falseOnly.getAttribute("current-checked") === "true" ? false : true,
      };
    } // TODO: Validation !!!

    // Process string overrides
    if (minStrLen !== null && maxStrLen !== null) {
      disableArr.push(minStrLen, maxStrLen);
      const minStrLenVal = minStrLen.getAttribute("current-value");
      const maxStrLenVal = maxStrLen.getAttribute("current-value");
      if (minStrLenVal !== undefined && maxStrLenVal !== undefined) {
        thisOverride.string = {
          minStrLen: Math.max(
            0,
            Math.min(Number(minStrLenVal), Number(maxStrLenVal))
          ),
          maxStrLen: Math.max(Number(minStrLenVal), Number(maxStrLenVal), 0),
        };
      }
    } // TODO: Validation !!!

    // Process array dimension overrides
    const dimLength = [];
    let dim = 0;
    let arrayBase = `${idBase}-array-${dim}`;
    while (document.getElementById(`${arrayBase}-min`) !== null) {
      const min = document.getElementById(`${arrayBase}-min`);
      const max = document.getElementById(`${arrayBase}-max`);
      if (min !== null && max !== null) {
        disableArr.push(min, max);
        const minVal = min.getAttribute("current-value");
        const maxVal = max.getAttribute("current-value");
        if (minVal !== undefined && maxVal !== undefined) {
          dimLength.push({
            min: Math.max(Math.min(Number(minVal), Number(maxVal)), 0),
            max: Math.max(Number(minVal), Number(maxVal), 0),
          });
        }
      }
      arrayBase = `${idBase}-array-${++dim}`;
    }
    if (dimLength.length > 0) {
      thisOverride.array = {
        dimLength: dimLength,
      };
    }
  }

  // Disable input elements while the Fuzzer runs.
  disableArr.forEach((e) => {
    e.style.disabled = true;
  });

  // Disable the validator controls while the Fuzzer runs.
  const validatorFnGrp = document.getElementById("validatorFunctions-radios");
  for (const e of validatorFnGrp.children) {
    e.style.disabled = true;
  }

  console.log("fuzzpanelmain.js overrides:", overrides);

  // Send the fuzzer start command to the extension
  vscode.postMessage({
    command: "fuzz.start",
    json: JSON5.stringify(overrides),
  });
} // fn: handleFuzzStart

function listForValidatorFnTooltip(validatorList) {
  let list = "";
  if (validatorList.validators.length === 0) {
    list += "(none)";
  }
  for (const idx in validatorList.validators) {
    list += validatorList.validators[idx];
    if (idx !== validatorList.validators.length) {
      list += "\n";
    }
  }
  return list;
}

/**
 * Refreshes the displayed list of validtors based on a list of
 * validators provided from the back-end.
 *
 * @param {*} object of type: {
 *  validator?: string,   // selected custom validator
 *  validators: string[], // list of available custom validators
 * }
 */
function refreshValidators(validatorList) {
  // If no default validator is selected or the selected validator does not
  // exist, then select the implicit validator
  if (
    "validator" in validatorList &&
    validatorList.validator !== undefined &&
    validatorList.validators.some((e) => e === validatorList.validator)
  ) {
    // noop; we have a valid validator
  } else {
    validatorList.validator = implicitOracleValidatorName;
  }

  // THISISME
  const validatorFnListWithTooltip = document.getElementById(
    "validator-functionList"
  );
  validatorFnListWithTooltip.setAttribute(
    "aria-label",
    listForValidatorFnTooltip(validatorList)
  );

  // THISISME

  // Get the current list of validator controls
  const validatorFnGrp = document.getElementById("validatorFunctions-radios");

  // Add the validator function buttons to the delete list & delete them
  const deleteList = [];
  for (const child of validatorFnGrp.children) {
    if (child.tagName === "VSCODE-RADIO") {
      deleteList.push(child);
    }
  }
  deleteList.forEach((e) => validatorFnGrp.removeChild(e)); // buh bye

  // Add buttons w/event listeners for each validator option
  [implicitOracleValidatorName, ...validatorList.validators]
    .reverse() // because of pre-pending before add and refresh buttons
    .forEach((name) => {
      // The implicit oracle has a special display name
      const displayName =
        name === implicitOracleValidatorName ? "(none)" : `${name}()`;

      // Create the radio button
      const radio = document.createElement("vscode-radio");
      radio.setAttribute("id", `validator-${name}`);
      radio.setAttribute("name", name);
      radio.setAttribute("value", name);
      if (validatorList.disabled) {
        radio.setAttribute("disabled", "true");
      }
      radio.innerHTML = displayName;
      if (name === validatorList.validator) {
        radio.setAttribute("checked", "true");
      }

      // Add the radio button to the radio group
      validatorFnGrp.prepend(radio);

      // Add the onClick event handler
      radio.addEventListener("click", (e) => {
        handleSetValidator(e, mode);
      });
    });

  // Set the radio group's value b/c this is necessary to maintain
  // consistent button state when a selected radio is deleted
  validatorFnGrp.setAttribute("value", validatorList.validator);

  // THISISME vvv
  const validatorFnBullets = document.getElementById(
    "validatorFunctions-bullets"
  );
  // Add the validator function buttons to the delete list & delete them
  const deleteListBullets = [];
  for (const child of validatorFnBullets.children) {
    if (child.tagName === "LI") {
      deleteListBullets.push(child);
    }
  }
  deleteListBullets.forEach((e) => validatorFnBullets.removeChild(e)); // buh bye
  if (![...validatorList.validators].length) {
    // Create the new bullet
    const bullet = document.createElement("li");
    bullet.innerHTML = "no validator functions found";

    // Add the bullet to the bulleted list
    validatorFnBullets.prepend(bullet);
  }
  // Add validators to bulleted list
  [...validatorList.validators]
    .reverse() // because of pre-pending before add and refresh buttons
    .forEach((name) => {
      const displayName = `${name}()`; // (not including implicit oracle here)

      // Create the new bullet
      const bullet = document.createElement("li");
      bullet.innerHTML = displayName;

      // Add the bullet to the bulleted list
      validatorFnBullets.prepend(bullet);
    });
} // fn: refreshValidators

/**
 * Send message to back-end to add code skeleton to source code (because the
 * user clicked the customValidator button)
 *
 * @param e on-click event
 */
function handleAddValidator(e) {
  vscode.postMessage({
    command: "validator.add",
    json: JSON5.stringify(""),
  });
} // fn: handleAddValidator()

/**
 * Send message to back-end to save the validator that the user selected
 * using the radio buttons
 *
 * @param e on-click event
 */
function handleSetValidator(validatorList) {
  const validatorName = validatorList.currentTarget.getAttribute("name");

  // Update the back-end with the newly-selected validator function
  vscode.postMessage({
    command: "validator.set",
    json: JSON5.stringify(
      validatorName === implicitOracleValidatorName ? "" : validatorName
    ),
  });
} // fn: handleSetValidator()

/**
 * Send message to back-end to refresh the validators
 *
 * @param e on-click event
 */
function handleGetListOfValidators() {
  vscode.postMessage({
    command: "validator.getList",
    json: "{}",
  });
} // fn: handleGetListOfValidators()

/**
 * Returns true if the DOM node is hidden using the 'hidden' class.
 *
 * @param e The DOM node to check for the 'hidden' class
 * @returns true if the DOM node is hidden; false otherwise
 */
function isHidden(e) {
  return e.classList.contains("hidden");
} // fn: isHidden()

/**
 * Toggles whether an element is hidden or not
 *
 * @param e DOM element to toggle
 */
function toggleHidden(e) {
  if (e.classList.contains("hidden")) {
    e.classList.remove("hidden");
  } else {
    e.classList.add("hidden");
  }
} // fn: toggleHidden()

/**
 * Hides a DOM element
 *
 * @param e DOM element to hide
 */
function hide(e) {
  e.classList.add("hidden");
} // fn: hide()

/**
 * Shows a DOM element
 *
 * @param e DOM element to hide
 */
function show(e) {
  e.classList.remove("hidden");
} // fn: hide()

/**
 * Returns the number of columns in a table
 *
 * @param type Table type key
 * @returns sum of colspans for table header
 */
function getColCountForTable(type) {
  // Get the table header row
  const thead = document.getElementById(`fuzzResultsGrid-${type}-thead`);
  const theadRow = thead.rows[0];

  // Return the sum of the cell colspans
  return Array.from(theadRow.cells)
    .map((cell) => cell.colSpan)
    .reduce((a, b) => a + b, 0);
} // fn: getColCountForTable()

/**
 * Return index of a column in table header
 * @param {*} id
 * @param {*} hRow
 * @returns
 */
function getIdxInTableHeader(id, hRow) {
  // Get idx of first custom validator col
  let idx = 0;
  for (const hCell of hRow.cells) {
    console.log("hcell.id:", hCell.id);
    if (hCell.id === id) {
      break;
    }
    ++idx;
  }
  return idx;
}

/**
 * Returns string for list separated with \n
 *
 * @param list list of strings
 * @returns string for list
 */
function toNewLineList(list) {
  let str = list.length === 0 ? `none` : ``;
  list.forEach((e) => {
    str += `${e}\n`;
  });
  return str;
}

/**
 * Returns HTML for a bulleted list
 *
 * @param list list of strings
 * @returns HTML for bulleted list
 */
function toBulletListHTML(list) {
  let html = `<ul>`;
  list.forEach((e) => {
    html += `<li> ${e} </li>`;
  });
  return (html += `</ul>`);
}

/**
 * Returns a base id name for a particular argument input.
 *
 * @param i unique argument id
 * @returns HTML id for the argument
 */
function getIdBase(i) {
  return "argDef-" + i;
} // fn: getIdBase()

/**
 * Adapted from: escape-goat/index.js
 *
 * Unescapes an HTML string.
 *
 * @param html HTML to unescape
 * @returns unescaped string
 */
function htmlUnescape(html) {
  return html
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
} // fn: htmlUnescape()

/**
 * Adapted from: escape-goat/index.js
 *
 * Escapes a string for use in HTML.
 *
 * @param str string to escape
 * @returns escaped string
 */
function htmlEscape(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
} // fn: htmlEscape()
