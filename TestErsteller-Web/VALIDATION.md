# Validation v2.5

- Admin upload supports native drag-and-drop for PDF/DOCX.
- Drag state is visually highlighted and uses copy semantics.
- Dropped files are merged with already selected files and deduplicated by name/size/lastModified.
- Unsupported file types are rejected client-side with a visible message.
- Existing limits remain enforced client-side and server-side: max. 10 files, max. 4 MB total.
- Selected documents are shown individually with file size and can be removed before analysis.
- File-picker remains available as a fallback and can be used repeatedly.
- Parsed all 24 TypeScript/TSX source files with the TypeScript parser: 0 syntax-error files.
