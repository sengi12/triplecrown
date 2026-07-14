// Readable source lives in src/templates/coaching-template.html; build.py inlines it here
// as a JSON string so the shipped index.html remains a single self-contained file.
const SCHEME_TEMPLATE_INLINE = __INLINE_TEXT__("templates/coaching-template.html");
