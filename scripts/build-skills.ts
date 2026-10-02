import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readSkills, writeSkill, writeFile, cleanDir, removeDevSkills, DEV_NAME_PREFIX } from './lib/utils.js';
import { claudeCode } from './lib/transformers/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const sourceDir = join(rootDir, 'packages', 'skills');
const outputDir = join(rootDir, 'skills');
const homeDir = process.env.HOME || process.env.USERPROFILE || '';
const globalClaudeSkillsDir = join(homeDir, '.claude', 'skills');

const skills = readSkills(sourceDir);
console.log(`Found ${skills.length} skills`);

cleanDir(outputDir);
const renderedSkills: string[] = [];
for (const skill of skills) {
  const content = writeSkill(skill, join(outputDir, skill.name), { binary: 'diffity' });
  renderedSkills.push([content, ...skill.files.map((file) => `${file.path}\n${file.content}`)].join('\n'));
}
console.log(`Built ${skills.length} skills to skills/`);

const skillsHash = createHash('sha256').update(renderedSkills.sort().join('')).digest('hex').slice(0, 12);
writeFile(
  join(rootDir, 'packages', 'cli', 'src', 'generated', 'skills-hash.ts'),
  `export const SKILLS_HASH = '${skillsHash}';\n`,
);
console.log(`Skills hash: ${skillsHash}`);

removeDevSkills(globalClaudeSkillsDir);
for (const skill of skills) {
  claudeCode(skill, homeDir, { binary: 'diffity-dev', namePrefix: DEV_NAME_PREFIX, slashPrefix: `/${DEV_NAME_PREFIX}-`, installHint: 'run `npm run dev` from the diffity repo root to link the CLI' });
}
console.log(`Synced ${skills.length} dev skills to ~/.claude/skills/`);
