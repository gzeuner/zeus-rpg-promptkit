/**
 * pui-edit — CLI tool for programmatically editing ProfoundUI Display File members.
 *
 * Usage:
 *   node cli/zeus.js pui-edit --file <path> --action <action> [--options...]
 *
 * Actions:
 *   grid-add-column    Insert a new column into a grid
 *   dump-json          Print the parsed JSON content of the main format
 *   validate-json      Validate a JSON/DDDL file (no DDS write access)
 *   export-json        Export PUI JSON as pretty|compact|dddl file
 *   import-json        Import PUI JSON (pretty/compact/dddl) back into DDS
 *   roundtrip-check    Parse + serialize and verify the output is identical
 *   plan               Validate a declarative change set without writing
 *   apply              Apply a declarative change set after --confirm
 *
 * Options for grid-add-column:
 *   --grid-id          ID of the grid element (e.g. "gridMain")
 *   --col-position     0-based column position to insert at
 *   --col-heading      Column heading
 *   --col-width        Column width in pixels (number)
 *   --field-id         ID of the new PUI field element (e.g. "GRID_FIELD_NEW")
 *   --field-name       DDS field name (e.g. "FIELD_NEW")
 *   --field-type       PUI field type (e.g. "output field", "textbox")
 *   --field-data-type  PUI data type (e.g. "char", "zoned")
 *   --field-length     Data length
 *   --field-width      Display width in px (e.g. "100px")
 *   --sfl-field        DDS field line(s) to insert into an SFL record (repeatable)
 *   --sfl-record       Optional: explicit record name for --sfl-field
 *   --no-auto-adjust   Skip layout auto-adjustment (grid/panel width + buttons)
 *
 * The action logic lives in src/pui/puiEditService.js so it can be shared with
 * the zeus.pui-edit MCP tool.
 */

'use strict';

const { executePuiEdit } = require('../../pui/puiEditService');

async function run(args) {
  try {
    const result = executePuiEdit(args, { cwd: process.cwd(), allowWrites: true });

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
