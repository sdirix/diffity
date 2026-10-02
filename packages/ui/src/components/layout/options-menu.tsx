import { useState, useRef, useEffect, type ReactNode } from 'react';
import { SunIcon } from '../icons/sun-icon';
import { MoonIcon } from '../icons/moon-icon';
import { EllipsisIcon } from '../icons/ellipsis-icon';
import { GitHubIcon } from '../icons/github-icon';
import { EyeOffIcon } from '../icons/eye-off-icon';
import { SettingsIcon } from '../icons/settings-icon';
import { openSettings } from '../../hooks/use-settings-dialog';
import { usePaletteActions, type PaletteAction } from '../../hooks/use-palette';
import { shortcutHint } from '../../lib/shortcuts';

export const menuItemClass = 'flex items-center gap-2.5 w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-hover hover:text-text transition-colors cursor-pointer text-left';

const SETTINGS_ACTIONS: PaletteAction[] = [{
  id: 'settings',
  title: 'Settings',
  hint: shortcutHint('settings'),
  keywords: 'preferences options theme colours layout whitespace hidden files editor clear data',
  icon: <SettingsIcon className="w-3.5 h-3.5" />,
  run: () => openSettings(),
}];

interface OptionsMenuProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  renderExtraItems?: (close: () => void) => ReactNode;
}

export function OptionsMenu(props: OptionsMenuProps) {
  const { theme, onToggleTheme, renderExtraItems } = props;
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  usePaletteActions('settings', SETTINGS_ACTIONS);

  useEffect(() => {
    if (!showMenu) {
      return;
    }
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  const close = () => setShowMenu(false);

  return (
    <div className="relative" ref={menuRef}>
      <button
        className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-hover bg-bg-tertiary transition-colors cursor-pointer"
        onClick={() => setShowMenu(!showMenu)}
        title="More options"
      >
        <EllipsisIcon className="w-4 h-4" />
      </button>
      {showMenu && (
        <div className="absolute right-0 top-full mt-1 w-48 py-1 bg-bg-secondary rounded-md shadow-lg ring-1 ring-border z-50">
          {renderExtraItems && renderExtraItems(close)}
          <button
            className={menuItemClass}
            onClick={() => {
              openSettings('diff', 'hidden-files');
              close();
            }}
          >
            <EyeOffIcon className="w-3.5 h-3.5" />
            Hidden files
          </button>
          <button
            className={menuItemClass}
            onClick={() => {
              onToggleTheme();
              close();
            }}
          >
            {theme === 'light' ? <MoonIcon className="w-3.5 h-3.5" /> : <SunIcon className="w-3.5 h-3.5" />}
            {theme === 'light' ? 'Dark mode' : 'Light mode'}
          </button>
          <button
            className={menuItemClass}
            onClick={() => {
              openSettings();
              close();
            }}
          >
            <SettingsIcon className="w-3.5 h-3.5" />
            Settings
            <span className="ml-auto text-text-muted">{shortcutHint('settings')}</span>
          </button>
          <div className="border-t border-border my-1" />
          <a
            href="https://github.com/kamranahmedse/diffity"
            target="_blank"
            rel="noopener noreferrer"
            className={menuItemClass}
            onClick={close}
          >
            <GitHubIcon className="w-3.5 h-3.5" />
            GitHub
          </a>
        </div>
      )}
    </div>
  );
}
