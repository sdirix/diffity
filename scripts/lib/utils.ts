import matter from 'gray-matter';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

export interface SkillData {
  name: string;
  description: string;
  [key: string]: unknown;
}

export interface SkillFile {
  /** Relative to the skill's folder. */
  path: string;
  content: Buffer;
}

export interface Skill {
  name: string;
  data: SkillData;
  content: string;
  /** The skill's other files, like the prompts of its subagents, copied as they are. */
  files: SkillFile[];
}

export interface TransformOptions {
  binary: string;
  namePrefix?: string;
  slashPrefix?: string;
  installHint?: string;
}

function readSkillFiles(dir: string, prefix = ''): SkillFile[] {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  return entries.flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      return readSkillFiles(join(dir, entry.name), path);
    }
    return path === 'SKILL.md' ? [] : [{ path, content: readFileSync(join(dir, entry.name)) }];
  });
}

export function readSkills(sourceDir: string): Skill[] {
  const skills: Skill[] = [];
  const entries = readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillPath = join(sourceDir, entry.name, 'SKILL.md');
    if (!existsSync(skillPath)) {
      continue;
    }

    const raw = readFileSync(skillPath, 'utf-8');
    const { data, content } = matter(raw);
    skills.push({ name: entry.name, data: data as SkillData, content, files: readSkillFiles(join(sourceDir, entry.name)) });
  }

  return skills;
}

export function renderSkill(skill: Skill, { binary, namePrefix, slashPrefix, installHint }: TransformOptions): string {
  const slash = slashPrefix ?? '/diffity-';
  const hint = installHint ?? 'install it with `npm install -g diffity`';
  const body = skill.content
    .replaceAll('{{binary}}', binary)
    .replaceAll('{{slash}}', slash)
    .replaceAll('{{install_hint}}', hint);
  const data = { ...skill.data };
  if (namePrefix) {
    data.name = data.name.replace('diffity-', `${namePrefix}-`);
  }
  return matter.stringify(body, data);
}

export function writeFile(filePath: string, content: string | Buffer): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

/** Writes the rendered SKILL.md and the other files of `skill` to `dir`, and returns the SKILL.md. */
export function writeSkill(skill: Skill, dir: string, options: TransformOptions): string {
  const content = renderSkill(skill, options);
  writeFile(join(dir, 'SKILL.md'), content);
  for (const file of skill.files) {
    writeFile(join(dir, file.path), file.content);
  }
  return content;
}

export function cleanDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true });
  }
  mkdirSync(dir, { recursive: true });
}

export const DEV_NAME_PREFIX = 'diffity-dev';

/** Removes the dev skills a sync wrote to `skillsDir` and keeps every other skill there. */
export function removeDevSkills(skillsDir: string): void {
  if (!existsSync(skillsDir)) {
    return;
  }
  for (const name of readdirSync(skillsDir)) {
    if (name.startsWith(`${DEV_NAME_PREFIX}-`)) {
      rmSync(join(skillsDir, name), { recursive: true, force: true });
    }
  }
}
