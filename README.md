# CHT Inventory Scanner – iPad (Prototype 1)

Web app version of the Chapel Hill Tire inventory scanner. Runs in Safari on iPad,
works offline after the first visit, and produces the same Excel and CSV reports
as the Windows app.

## Files
| File | What it is |
| --- | --- |
| index.html | The screens and styling |
| app.js | Counting logic (matches the Windows app) |
| xlsx.js | Builds the Excel report (no internet needed) |
| barcode.js | Draws the barcode labels for bulk tanks |
| sw.js, manifest.webmanifest | Offline support and Home Screen app settings |
| icon-*.png, apple-touch-icon.png | App icons |

## Data
In this prototype, the barcode list, store-specific parts, skipped barcodes and the
saved count are stored on the iPad only. Back up the barcode list from
Barcodes & Data → Save Barcode List.

Version: Prototype 1 · v0.3.2 (Counted Value column, inventory value on Summary, faster updates)
