import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { codeRoot } from '../lib/paths.mjs';
import { TOOL_SKILLS_DIR, TOOL_SKILL_PREFIX, toolSkills } from '../lib/test-folder.mjs';

const EXPECTED = ['auto-check-context', 'auto-check-propose-solution', 'auto-check-resolve-issue', 'auto-check-write-check'];

test('the tool ships its skills in skills/, and nowhere else', () => {
  assert.equal(TOOL_SKILLS_DIR, path.join(codeRoot, 'skills'));
  assert.deepEqual(toolSkills(), EXPECTED);
  for (const folder of ['.claude/skills', '.github/skills']) {
    const dir = path.join(codeRoot, ...folder.split('/'));
    if (!existsSync(dir)) continue;
    const copies = readdirSync(dir).filter((name) => name.startsWith(TOOL_SKILL_PREFIX));
    assert.deepEqual(copies, [], `${folder} holds a copy of auto-check's skills`);
  }
});

test('every skill has front matter whose name matches its folder', () => {
  for (const name of toolSkills()) {
    const file = path.join(TOOL_SKILLS_DIR, name, 'SKILL.md');
    assert.ok(existsSync(file), file);
    const text = readFileSync(file, 'utf8');
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(front, `${name}: SKILL.md needs front matter`);
    assert.match(front[1], new RegExp(`^name: ${name}$`, 'm'));
    assert.match(front[1], /^description: \S/m);
    assert.ok(text.length > 400, `${name}: SKILL.md is too short to be useful`);
  }
});
