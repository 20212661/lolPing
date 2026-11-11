import { Button, Dropdown, Input, Option, Switch } from '@fluentui/react-components';
import { ClipboardPasteRegular, CodeRegular, OpenRegular, SearchRegular, SparkleRegular } from '@fluentui/react-icons';
import { useEffect, useState, type KeyboardEvent } from 'react';
import type { ManifestErrorCode } from '../../../../packages/plugin-api/src/validate';
import { defaultCustomAction, MAX_CUSTOM_ACTIONS, type ActionsSettings, type CustomAction } from '../../../shared/actionCatalog';
import type { PluginListResult } from '../../../shared/commandTiles';
import type { Settings } from '../../../shared/settings';
import { api } from '../api';
import { useText } from '../text';
import type { Update } from '../useAppState';
import { SettingRow } from './rows';

/** A text box that keeps its own draft and saves on blur, the way the room name does. */
function ActionInput(props: { value: string; width?: number; password?: boolean; placeholder?: string; onSave(v: string): void }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]); // a reset or another window's change reaches the box
  const save = (): void => {
    if (draft !== props.value) props.onSave(draft);
  };
  return (
    <Input
      type={props.password ? 'password' : 'text'}
      value={draft}
      spellCheck={false}
      placeholder={props.placeholder}
      style={{ width: props.width ?? 320 }}
      onChange={(_, d) => setDraft(d.value)}
      onBlur={save}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** One configuration entry of a scanned plugin, as the control its type calls for. */
function ConfigField(props: { prop: PluginListResult['plugins'][number]['configuration'][number]; value: unknown; onSave(v: string | number | boolean): void }) {
  const { prop, value } = props;
  const asText = String(value ?? prop.default ?? '');
  if (prop.type === 'boolean') {
    return <Switch label={prop.title} checked={value === true} onChange={(_, d) => props.onSave(d.checked)} />;
  }
  if (prop.enum) {
    return (
      <label>
        {prop.title}
        <Dropdown
          style={{ minWidth: 180 }}
          value={asText}
          selectedOptions={[asText]}
          onOptionSelect={(_, d) => props.onSave(String(d.optionValue ?? ''))}
        >
          {prop.enum.map((o) => <Option key={o} value={o} text={o}>{o}</Option>)}
        </Dropdown>
      </label>
    );
  }
  if (prop.type === 'number') {
    return <label>{prop.title}<ActionInput value={asText} width={180} onSave={(v) => props.onSave(Number(v) || 0)} /></label>;
  }
  if (prop.multiline) {
    return (
      <label>
        {prop.title}
        <textarea className="pluginConfigArea" defaultValue={asText} spellCheck={false}
          onBlur={(e) => { if (e.target.value !== asText) props.onSave(e.target.value); }} />
      </label>
    );
  }
  return <label>{prop.title}<ActionInput value={asText} password={prop.type === 'secret'} onSave={props.onSave} /></label>;
}

export function ActionsSection(
  { settings: s, update, plugins, onRefreshPlugins }: {
    settings: Settings;
    update: Update;
    /** The last scan's result, or null while the first one is on its way. */
    plugins: PluginListResult | null;
    onRefreshPlugins(): void;
  },
) {
  const t = useText();
  const set = (patch: Partial<ActionsSettings>): void => {
    void update({ actions: { ...s.actions, ...patch } });
  };
  const { openApp, runScript, aiExplain, clipboardSearch } = s.actions;
  const editPlugin = (id: string, patch: Partial<CustomAction>): void => {
    set({ custom: s.actions.custom.map((a) => a.id === id ? { ...a, ...patch } : a) });
  };
  const setPluginValue = (pluginId: string, key: string, value: string | number | boolean): void => {
    const current = s.plugins.configs[pluginId] ?? {};
    void update({ plugins: { ...s.plugins, configs: { ...s.plugins.configs, [pluginId]: { ...current, [key]: value } } } });
  };
  return (
    <>
      <p className="desc">{t.actionsBlurb}</p>
      <SettingRow icon={<OpenRegular />} title={t.actionNames['open-app']} description={t.actionOpenAppDesc}>
        <ActionInput value={openApp.target} onSave={(target) => set({ openApp: { target } })} />
      </SettingRow>
      <SettingRow icon={<CodeRegular />} title={t.actionNames['run-script']} description={t.actionRunScriptDesc}>
        <ActionInput value={runScript.command} onSave={(command) => set({ runScript: { command } })} />
      </SettingRow>
      <SettingRow icon={<SparkleRegular />} title={t.actionNames['ai-explain']} description={t.actionAiDesc} />
      <div className="card actionFields">
        <label>
          {t.actionAiBase}
          <ActionInput value={aiExplain.baseUrl} onSave={(baseUrl) => set({ aiExplain: { ...aiExplain, baseUrl } })} />
        </label>
        <label>
          {t.actionAiKey}
          <ActionInput value={aiExplain.apiKey} password width={220} onSave={(apiKey) => set({ aiExplain: { ...aiExplain, apiKey } })} />
        </label>
        <label>
          {t.actionAiModel}
          <ActionInput value={aiExplain.model} width={180} onSave={(model) => set({ aiExplain: { ...aiExplain, model } })} />
        </label>
      </div>
      <SettingRow icon={<SearchRegular />} title={t.actionNames['clipboard-search']} description={t.actionSearchDesc}>
        <ActionInput value={clipboardSearch.url} onSave={(url) => set({ clipboardSearch: { url } })} />
      </SettingRow>
      <h3>{t.pluginTitle}</h3>
      <p className="desc">{t.pluginDescription}</p>
      <p className="desc">{t.pluginTrust}</p>
      {s.actions.custom.map((a) => (
        <div className="card pluginFields" key={a.id}>
          <label>{t.pluginName}<ActionInput value={a.name} onSave={(name) => editPlugin(a.id, { name })} /></label>
          <label>{t.pluginEntry}<ActionInput value={a.entry} onSave={(entry) => editPlugin(a.id, { entry })} /></label>
          <label>{t.pluginCommand}<ActionInput value={a.command} onSave={(command) => editPlugin(a.id, { command })} /></label>
          <label>{t.pluginConfig}<ActionInput value={a.config} onSave={(config) => editPlugin(a.id, { config })} /></label>
          <label>{t.pluginTimeout}<ActionInput value={String(a.timeoutMs / 1000)}
            onSave={(seconds) => editPlugin(a.id, { timeoutMs: Number(seconds) * 1000 })} /></label>
          <Switch label={t.pluginClipboard} checked={a.useClipboard}
            onChange={(_, d) => editPlugin(a.id, { useClipboard: d.checked })} />
          <div className="pluginButtons">
            <Switch label={t.pluginEnabled} checked={a.enabled}
              onChange={(_, d) => editPlugin(a.id, { enabled: d.checked })} />
            <Button onClick={() => set({ custom: s.actions.custom.filter((item) => item.id !== a.id) })}>
              {t.pluginRemove}
            </Button>
          </div>
        </div>
      ))}
      <Button disabled={s.actions.custom.length >= MAX_CUSTOM_ACTIONS} onClick={() => set({
        custom: [...s.actions.custom, defaultCustomAction(`plugin:${crypto.randomUUID()}`, t.pluginNewName)],
      })}>{t.pluginAdd}</Button>

      <h3>{t.pluginsSectionTitle}</h3>
      <p className="desc">{t.pluginsSectionDesc}</p>
      <div className="pluginButtons">
        <Button onClick={onRefreshPlugins}>{t.pluginsRefresh}</Button>
        <Button onClick={() => void api.openPluginsFolder()}>{t.pluginsOpenFolder}</Button>
      </div>
      {api.platform === 'win' ? (
        <SettingRow icon={<ClipboardPasteRegular />} title={t.pluginsSimulateCopy} description={t.pluginsSimulateCopyDesc}>
          <Switch checked={s.plugins.simulateCopy}
            onChange={(_, d) => void update({ plugins: { ...s.plugins, simulateCopy: d.checked } })} />
        </SettingRow>
      ) : null}
      {plugins !== null && plugins.plugins.length === 0 && plugins.failures.length === 0 ? (
        <p className="desc">{t.pluginsNone}</p>
      ) : null}
      {plugins?.failures.map((f) => (
        <div className="card pluginFields" key={f.dir}>
          <div className="pluginHead"><b>{f.dir}</b><span className="desc">{t.pluginsInvalid}</span></div>
          <ul className="pluginErrorList">
            {f.errors.map((e, i) => (
              <li key={i}>
                {t.pluginErrors[e.code as ManifestErrorCode]}
                {e.path ? <span className="desc"> ({e.path}{e.value ? `: ${e.value}` : ''})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {plugins?.plugins.map((p) => (
        <div className="card pluginFields" key={p.id}>
          <div className="pluginHead"><b>{p.name}</b><span className="desc">{p.id} · v{p.version}</span></div>
          {p.description ? <p className="desc">{p.description}</p> : null}
          {p.permissions.length > 0 ? (
            <div className="permBadges">
              {t.pluginsPermissions}:
              {p.permissions.map((perm) => <span key={perm} className="permBadge">{t.permNames[perm]}</span>)}
            </div>
          ) : null}
          {p.configuration.length > 0 ? (
            <>
              <div className="pluginConfigTitle">{t.pluginsConfiguration}</div>
              {p.configuration.map((prop) => (
                <ConfigField
                  key={prop.key}
                  prop={prop}
                  value={(s.plugins.configs[p.id] ?? {})[prop.key]}
                  onSave={(v) => setPluginValue(p.id, prop.key, v)}
                />
              ))}
            </>
          ) : null}
          <div className="desc">{p.commands.map((c) => c.title).join(' · ')}</div>
        </div>
      ))}
    </>
  );
}
