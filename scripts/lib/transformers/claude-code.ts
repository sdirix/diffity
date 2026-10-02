import { join } from 'path';
import { writeSkill, type Skill, type TransformOptions } from '../utils.js';

export function transform(skill: Skill, outputDir: string, options: TransformOptions): void {
  const dirName = options.namePrefix
    ? skill.name.replace('diffity-', `${options.namePrefix}-`)
    : skill.name;
  writeSkill(skill, join(outputDir, '.claude', 'skills', dirName), options);
}
