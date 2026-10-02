import { updateSettings, useSettings } from '../../lib/preferences';
import { SettingsGroup, SettingsRow, Switch } from '../settings/settings-controls';
import { StatusDot, statusText } from './agent-status';
import { WATCH_COMMAND } from './request-state';
import { OFFLINE_HINT, useAgentStatus } from './use-agent';

/** The agent pane of the settings dialog. */
export function AgentSettingsSection() {
  const settings = useSettings();
  const status = useAgentStatus();

  return (
    <SettingsGroup title="Requests">
      <SettingsRow
        id="agent-status"
        label="Status"
        hint={<>Your coding agent takes requests while it runs <code className="font-mono">{WATCH_COMMAND}</code>.</>}
      >
        <span className="flex items-center gap-1.5 text-xs text-text-secondary" title={status.state === 'offline' ? OFFLINE_HINT : undefined}>
          <StatusDot state={status.state} />
          {statusText(status)}
        </span>
      </SettingsRow>
      <SettingsRow id="agent-mentions" label="Ask the agent with @mentions" hint="A comment or reply with @claude or @agent sends its thread to the agent.">
        <Switch
          label="Ask the agent with @mentions"
          checked={settings.agentMentions}
          onChange={(agentMentions) => void updateSettings({ agentMentions })}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
