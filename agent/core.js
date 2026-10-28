// The agent core.
//
// The assistant is the shell; skills are the capabilities. A skill is a folder
// under skills/ containing a skill.json manifest and a runner. The core
// discovers them from the filesystem — adding a capability means adding a
// folder, not editing this file.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../tools/config.js';

/** Every well-formed skill folder, with its manifest. */
export function listSkills() {
  let dirs = [];
  try {
    dirs = fs.readdirSync(paths.skills, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }

  return dirs
    .map((d) => {
      const manifestPath = path.join(paths.skills, d.name, 'skill.json');
      if (!fs.existsSync(manifestPath)) {
        return { name: d.name, ok: false, problem: 'no skill.json manifest' };
      }
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const entry = manifest.entry ? path.join(paths.skills, d.name, manifest.entry) : null;
        const hasEntry = entry ? fs.existsSync(entry) : false;
        return {
          name: manifest.name || d.name,
          dir: d.name,
          ok: true,
          title: manifest.title || manifest.name || d.name,
          one_liner: manifest.one_liner || '',
          description: manifest.description || '',
          version: manifest.version || '0.0.0',
          status: manifest.status || (hasEntry ? 'ready' : 'stub'),
          inputs: manifest.inputs || {},
          steps: manifest.steps || [],
          memory: manifest.memory || null,
          guarantees: manifest.guarantees || [],
          entry: manifest.entry || null,
          runnable: hasEntry,
          has_prompt: fs.existsSync(path.join(paths.skills, d.name, 'prompt.md')),
        };
      } catch (err) {
        return { name: d.name, ok: false, problem: `unreadable manifest: ${err.message}` };
      }
    })
    .sort((a, b) => (a.runnable === b.runnable ? String(a.name).localeCompare(String(b.name)) : a.runnable ? -1 : 1));
}

export function getSkill(name) {
  return listSkills().find((s) => s.name === name || s.dir === name) || null;
}

/**
 * Load and invoke a skill by name. Kept deliberately small: the core picks the
 * skill and hands over, it does not orchestrate the steps itself.
 */
export async function invokeSkill(name, input = {}) {
  const skill = getSkill(name);
  if (!skill) throw new Error(`No skill named "${name}". Found: ${listSkills().map((s) => s.name).join(', ')}`);
  if (!skill.runnable) throw new Error(`Skill "${name}" is a stub: ${skill.description || 'no runner yet'}`);

  const mod = await import(`file://${path.join(paths.skills, skill.dir, skill.entry).replace(/\\/g, '/')}`);
  const fn = mod.run || mod.default || mod.runProofRun;
  if (typeof fn !== 'function') {
    throw new Error(`Skill "${name}" entry ${skill.entry} exports no run() function.`);
  }

  // Required inputs are checked here so a skill author does not have to.
  for (const [key, spec] of Object.entries(skill.inputs)) {
    if (spec.required && input[key] === undefined && spec.default === undefined) {
      throw new Error(`Skill "${name}" requires input "${key}" (${spec.description || spec.type}).`);
    }
  }

  return fn(input);
}
