---
Title: PUI Edit Workflow
Description: Interne technische Dokumentation zu Architektur, Vertragen und Implementierungsdetails.
Last Updated: 2026-05-17
---

# PUI Edit Workflow

`pui-edit` is a local-only command for ProfoundUI display files. It reads a DDS display member, changes the embedded PUI JSON block, and writes the result back only when you explicitly confirm the write.

## Supported actions

- `roundtrip-check` validates that parse and serialize preserve the file shape.
- `dump-json` prints the embedded PUI JSON document.
- `validate-json` validates plain JSON or `dddl` payloads without modifying DDS files.
- `export-json` writes embedded PUI JSON to a file as `pretty`, `compact`, or `dddl` wrapper format.
- `import-json` reads `pretty`/`compact` JSON or `dddl` wrapper and writes it back into DDS (with backup, requires `--confirm`).
- `plan` previews a declarative change set without writing the file.
- `apply` applies a declarative change set after `--confirm`.
- `grid-add-column` keeps the existing specialized grid workflow for local display files.

## Safe workflow

1. Run `plan` first to verify the intended edits.
2. Review the preview output and the matched items.
3. Run `apply --confirm` only after the change set is approved.
4. Keep the generated `.bak` backup until the change has been validated.

## DDDL contract

- `dddl` uses `kind: "zeus-pui-dddl"` with `version: 1`.
- Strict validation is enforced on import (unknown keys fail fast in strict mode).
- Legacy payloads (`kind: "zeus-pui-dddl-v0"` or `version: 0` with `json`) are migrated to v1 before validation.
- `dddl` is a local raw interchange format only. It is not a toolkit knowledgebase format, not MCP-safe, and must not be promoted into reusable project knowledge.

## Change set format

A change set is a JSON object with a required `operations` array. The current engine supports these operation types:

- `update-item` updates one item selected by a `where` filter.
- `remove-item` removes one or more matching items.
- `insert-item-after` inserts a new item after a matching anchor item.
- `add-column` adds a new column to a grid and updates column count/widths/headings.
- `delete-column` removes a column from a grid and renumbers remaining columns.
- `update-column-width` resizes a specific grid column.
- `hide-item` sets an item's visibility to hidden.
- `show-item` sets an item's visibility to visible.
- `toggle-item-visibility` toggles an item's visibility state (or sets it explicitly with mode).

### Basic Examples

#### update-item
```json
{
  "description": "Resize the panel and move the end button",
  "operations": [
    {
      "type": "update-item",
      "where": { "id": "PANEL_MAIN" },
      "set": { "width": "1040px" }
    },
    {
      "type": "update-item",
      "where": { "id": "BTN_CLOSE" },
      "set": { "left": "905px" }
    }
  ]
}
```

#### add-column
```json
{
  "description": "Add cost column to grid",
  "operations": [
    {
      "type": "add-column",
      "grid": "gridMain",
      "columnHeading": "Amount",
      "columnWidth": "100",
      "columnId": "gridMain_colAmount",
      "fieldType": "output field",
      "set": {
        "value": {
          "fieldName": "FIELD_AMOUNT",
          "dataType": "zoned",
          "formatting": "Number"
        },
        "font family": "Arial",
        "text align": "right"
      }
    }
  ]
}
```

#### delete-column
```json
{
  "description": "Remove unused column from grid",
  "operations": [
    {
      "type": "delete-column",
      "grid": "gridMain",
      "column": "3"
    }
  ]
}
```

#### update-column-width
```json
{
  "description": "Widen the status column",
  "operations": [
    {
      "type": "update-column-width",
      "grid": "gridMain",
      "column": "2",
      "width": "150"
    }
  ]
}
```

#### hide-item / show-item
```json
{
  "description": "Hide filter button and show all labels",
  "operations": [
    {
      "type": "hide-item",
      "where": { "id": "BTN_FILTER" }
    },
    {
      "type": "show-item",
      "where": { "field type": "output field", "css class": "label" },
      "allowMultiple": true
    }
  ]
}
```

Selectors support nested paths and a few modifiers such as `$contains`, `$matches`, `$in`, and `$exists`. For example, `{"id$matches":"^BTN_"}` matches all button IDs starting with `BTN_`.

## Notes

- The command only touches files in the local workspace.
- `apply` always writes a `.bak` backup next to the target file before saving.
- The command is intended for local review and controlled edits, not for direct IBM i writes.
