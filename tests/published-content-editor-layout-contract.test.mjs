import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("published content editor owns its layout in both A and F domains", () => {
  const editor = read("app/components/domain-views/published-content-editor.tsx");
  const styles = read("app/components/domain-views/published-content-editor.module.css");

  assert.match(editor, /import styles from "\.\/published-content-editor\.module\.css"/);
  assert.match(editor, /className=\{styles\.editor\}/);
  assert.match(editor, /className=\{styles\.sectionGrid\}/);
  assert.match(editor, /className=\{styles\.formGrid\}/);
  assert.match(editor, /const \[expanded, setExpanded\] = useState\(false\)/);
  assert.match(editor, /aria-expanded=\{expanded\}/);
  assert.match(editor, /expanded \? "收起" : "维护策略"/);
  assert.match(editor, /\{expanded && \(/);
  assert.doesNotMatch(editor, /className="(?:l-card|l-h|l-b|two-col|tiny|r|ttl|sub|l-btn)/);

  assert.match(styles, /\.editor\s*\{[^}]*background:\s*var\(--surface\)/s);
  assert.match(styles, /\.formGrid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
  assert.match(styles, /\.sectionGrid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
  assert.match(styles, /\.editor\s+:is\(input,\s*select,\s*textarea\)\s*\{[^}]*width:\s*100%/s);
  assert.match(styles, /@media\s*\(max-width:\s*900px\)[\s\S]*\.sectionGrid\s*\{[^}]*grid-template-columns:\s*1fr/s);
});
