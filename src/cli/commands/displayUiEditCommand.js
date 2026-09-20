/**
 * display-ui-edit — CLI tool for editing local display-file UI members.
 *
 * Usage:
 *   node cli/zeus.js display-ui-edit --file <path> --action <action> [--options...]
 *   Legacy alias: display-ui-edit
 *
 * Actions:
 *   grid-add-column    Insert a new column into a grid
 *   dump-json          Print the parsed JSON content of the main format
 *   validate-json      Validate a JSON/DDDL file (no DDS write access)
 *   export-json        Export display UI JSON as pretty|compact|dddl file
 *   import-json        Import display UI JSON (pretty/compact/dddl) back into DDS
 *   roundtrip-check    Parse + serialize and verify the output is identical
 *   plan               Validate a declarative change set without writing
 *   apply              Apply a declarative change set after --confirm
 *
 * Options for grid-add-column:
 *   --grid-id          ID of the grid element (e.g. "gridMain")
 *   --col-position     0-based column position to insert at
 *   --col-heading      Column heading
 *   --col-width        Column width in pixels (number)
 *   --field-id         ID of the new display UI field element (e.g. "GRID_FIELD_NEW")
 *   --field-name       DDS field name (e.g. "FIELD_NEW")
 *   --field-type       Display UI field type (e.g. "output field", "textbox")
 *   --field-data-type  Display UI data type (e.g. "char", "zoned")
 *   --field-length     Data length
 *   --field-width      Display width in px (e.g. "100px")
 *   --sfl-field        DDS field line(s) to insert into an SFL record (repeatable)
 *   --sfl-record       Optional: explicit record name for --sfl-field
 *   --no-auto-adjust   Skip layout auto-adjustment (grid/panel width + buttons)
 *
 * The action logic lives in src/displayUi/displayUiEditService.js so it can be shared with
 * the display UI MCP tools.
 */

'use strict';

const { executeDisplayUiEdit } = require('../../displayUi/displayUiEditService');

async function run(args) {
  try {
    const result = executeDisplayUiEdit(args, { cwd: process.cwd(), allowWrites: true });

    for (const warning of result.warnings || []) {
      console.warn(warning);
    }
    for (const message of result.messages || []) {
      console.log(message);
    }

    if (result.ok === false) {
      process.exitCode = 1;
    }
    return result;
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

module.exports = { run };
