import { Button, Input, Switch } from '@fluentui/react-components';
import { CodeRegular, OpenRegular, SearchRegular, SparkleRegular } from '@fluentui/react-icons';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { defaultCustomAction, MAX_CUSTOM_ACTIONS, type ActionsSettings, type CustomAction } from '../../../shared/actionCatalog';
import type { Settings } from '../../../shared/settings';
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

export function ActionsSection({ settings: s, update }: { settings: Settings; update: Update }) {
  const t = useText();
  const set = (patch: Partial<ActionsSettings>): void => {
    void update({ actions: { ...s.actions, ...patch } });
  };
  const { openApp, runScript, aiExplain, clipboardSearch } = s.actions;
  const editPlugin = (id: string, patch: Partial<CustomAction>): void => {
    set({ custom: s.actions.custom.map((a) => a.id === id ? { ...a, ...patch } : a) });
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
    </>
  );
}
