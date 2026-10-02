import type { Command } from 'commander';
import pc from 'picocolors';
import { InputError } from '@diffity/git';
import { commandExists, splitCommand } from '../editor.js';
import { readSettings, settingsPath, updateSettings } from '../settings.js';

function setEditorCommand(command: string): void {
  const trimmed = command.trim();
  if (!trimmed) {
    const { editor } = readSettings();
    updateSettings({ editorCommand: '', ...(editor === 'custom' ? { editor: 'auto' } : {}) });
    console.log('Custom editor command removed.');
    return;
  }
  if (splitCommand(trimmed) === null) {
    console.error(pc.red('Error: Unclosed quote in the command'));
    process.exit(1);
  }
  try {
    updateSettings({ editor: 'custom', editorCommand: trimmed });
  } catch (err) {
    if (err instanceof InputError) {
      console.error(pc.red(`Error: ${err.message}`));
      process.exit(1);
    }
    throw err;
  }
  console.log(`Files open with ${pc.cyan(trimmed)}`);
  const program = splitCommand(trimmed)?.[0];
  if (program && !commandExists(program, process.cwd())) {
    console.log(pc.yellow(`  ${program} was not found on PATH.`));
  }
}

export function registerConfigCommand(program: Command) {
  const config = program
    .command('config')
    .description(`Change the settings only the CLI may set, kept in ${settingsPath()}`);

  config
    .command('editor')
    .description('Show or set the custom editor command')
    .argument('[command]', 'Program and arguments with {file}, {line} and {column}, "" to remove it')
    .addHelpText('after', `
Runs without a shell. The file is appended when the command has no {file}.

Examples:
  $ diffity config editor "subl {file}:{line}:{column}"
  $ diffity config editor "emacsclient -n +{line}:{column} {file}"
  $ diffity config editor ""`)
    .action((command?: string) => {
      if (command !== undefined) {
        setEditorCommand(command);
        return;
      }
      const { editor, editorCommand } = readSettings();
      if (!editorCommand) {
        console.log(pc.dim('No custom editor command set.'));
        return;
      }
      console.log(editorCommand);
      if (editor !== 'custom') {
        console.log(pc.dim('  Not in use, choose Custom command in the settings.'));
      }
    });
}
