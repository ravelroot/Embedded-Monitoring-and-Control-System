import { useState } from 'preact/hooks';

import { CHANNELS, emptyRule, OUTPUTS, PWM_MAX, RULE_SLOTS, type Rule, type Severity } from '../../shared/model';
import { parseRule, ValidationError } from '../../shared/validation';
import { Button, Card, Chip, Confirm, Dialog, Empty, Field, PageHead, severityTone, Toggle } from '../components/ui';
import { describeAction, describeCondition, describeRule, severityName } from '../format';
import { call, isOnline, useStore } from '../store';

function RuleEditor(props: { slot: number; initial: Rule; onClose: () => void }) {
  const [rule, setRule] = useState<Rule>(props.initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const update = (patch: Partial<Rule>) => {
    setError('');
    setRule((current) => ({ ...current, ...patch }));
  };
  const channel = CHANNELS[rule.channel];
  const output = rule.output === null ? null : OUTPUTS[rule.output];
  const valueControl = (key: 'onValue' | 'offValue', label: string) => {
    if (!output) {
      return null;
    }
    return (
      <Field label={label}>
        {output.kind === 'relay' ? (
          <select class="input" value={rule[key]} onChange={(event) => update({ [key]: Number(event.currentTarget.value) })}>
            <option value={1}>Ligar</option>
            <option value={0}>Desligar</option>
          </select>
        ) : (
          <div class="input-unit">
            <input
              class="input mono"
              type="number"
              min={0}
              max={100}
              step={5}
              value={Math.round((rule[key] / PWM_MAX) * 100)}
              onInput={(event) => update({ [key]: Math.round(Math.min(100, Math.max(0, Number(event.currentTarget.value))) * 10) })}
            />
            <span>%</span>
          </div>
        )}
      </Field>
    );
  };
  const submit = async () => {
    let parsed: Rule;
    try {
      parsed = parseRule(rule);
    } catch (problem) {
      setError(problem instanceof ValidationError ? problem.message : String(problem));
      return;
    }
    setBusy(true);
    const result = await call(window.malha.setRule(props.slot, parsed), `Regra ${props.slot + 1} enviada ao dispositivo.`);
    setBusy(false);
    if (result) {
      props.onClose();
    }
  };
  return (
    <Dialog
      title={`Regra ${props.slot + 1}`}
      wide
      onClose={props.onClose}
      footer={
        <>
          <span class="field-error grow">{error}</span>
          <Button variant="ghost" onClick={props.onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Enviando…' : 'Enviar ao dispositivo'}
          </Button>
        </>
      }
    >
      <div class="form-grid">
        <Toggle checked={rule.enabled} onChange={(enabled) => update({ enabled })} label="Regra ativa" hint="Desligada, a regra fica guardada mas não age." />
        <div />
        <Field label="Canal">
          <select class="input" value={rule.channel} onChange={(event) => update({ channel: Number(event.currentTarget.value) })}>
            {CHANNELS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Condição">
          <select class="input" value={rule.comparison} onChange={(event) => update({ comparison: event.currentTarget.value as Rule['comparison'] })}>
            <option value="above">Acima do limite</option>
            <option value="below">Abaixo do limite</option>
          </select>
        </Field>
        <Field label="Limite" hint={channel?.key === 'presence' ? 'Presença: use 0,5 (0 = ausente, 1 = detectada).' : undefined}>
          <div class="input-unit">
            <input class="input mono" type="number" step="any" value={rule.threshold} onInput={(event) => update({ threshold: Number(event.currentTarget.value) })} />
            <span>{channel?.unit}</span>
          </div>
        </Field>
        <Field label="Histerese" hint="Margem para voltar ao normal e evitar liga-desliga.">
          <div class="input-unit">
            <input class="input mono" type="number" min={0} step="any" value={rule.hysteresis} onInput={(event) => update({ hysteresis: Number(event.currentTarget.value) })} />
            <span>{channel?.unit}</span>
          </div>
        </Field>
        <Field label="Atraso" hint="Tempo que a condição precisa durar para a regra agir.">
          <div class="input-unit">
            <input class="input mono" type="number" min={0} max={3600} step={1} value={rule.delayS} onInput={(event) => update({ delayS: Math.round(Number(event.currentTarget.value)) })} />
            <span>s</span>
          </div>
        </Field>
        <Field label="Severidade do alarme">
          <select class="input" value={rule.severity} onChange={(event) => update({ severity: Number(event.currentTarget.value) as Severity })}>
            {[0, 1, 2, 3].map((value) => (
              <option key={value} value={value}>
                {severityName(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ação">
          <select
            class="input"
            value={rule.output ?? 'none'}
            onChange={(event) => {
              const value = event.currentTarget.value;
              const next = value === 'none' ? null : Number(value);
              const kind = next === null ? null : OUTPUTS[next].kind;
              update({ output: next, onValue: kind === 'pwm' ? PWM_MAX : kind === 'relay' ? 1 : 0, offValue: 0 });
            }}
          >
            <option value="none">Somente gerar alarme</option>
            {OUTPUTS.map((item) => (
              <option key={item.id} value={item.id}>
                Comandar {item.name}
              </option>
            ))}
          </select>
        </Field>
        <div />
        {valueControl('onValue', 'Ao ativar')}
        {valueControl('offValue', 'Ao voltar ao normal')}
      </div>
      <p class="rule-preview">{describeRule(rule)}</p>
    </Dialog>
  );
}

export function Rules() {
  const rules = useStore((state) => state.rules);
  const telemetry = useStore((state) => state.telemetry);
  const online = useStore(isOnline);
  const [editing, setEditing] = useState<{ slot: number; rule: Rule } | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  if (!online) {
    return (
      <div class="view">
        <PageHead eyebrow="Automação" title="Regras" description="Até 8 regras executadas pelo próprio ESP32 a cada leitura, com histerese e atraso." />
        <Card>
          <Empty title="Regras ficam no dispositivo" text="Conecte o ESP32 ou o simulador para ver e editar as regras de automação. Elas continuam valendo mesmo com o computador desligado." />
        </Card>
      </div>
    );
  }
  const used = rules.filter((slot) => slot.rule.enabled || slot.rule.output !== null || slot.rule.severity > 0);
  const free = Array.from({ length: RULE_SLOTS }, (_, index) => index).find((index) => !used.some((slot) => slot.slot === index));
  return (
    <div class="view">
      <PageHead
        eyebrow="Automação"
        title="Regras"
        description="Até 8 regras executadas pelo próprio ESP32 a cada leitura, com histerese e atraso. Continuam valendo com o computador desligado."
        actions={
          <>
            <Button variant="primary" disabled={free === undefined} onClick={() => free !== undefined && setEditing({ slot: free, rule: { ...emptyRule(), enabled: true, severity: 1 } })}>
              Nova regra
            </Button>
            <Button onClick={() => void call(window.malha.loadExampleRules(), 'Regras de exemplo enviadas.')}>Carregar exemplos</Button>
            <Button onClick={() => void call(window.malha.restoreRuleBackup(), 'Regras restauradas a partir do computador.')}>Restaurar do computador</Button>
            <Button onClick={() => void call(window.malha.save(), 'Regras gravadas na memória do dispositivo.')}>Gravar no dispositivo</Button>
          </>
        }
      />
      <Card>
        {used.length === 0 ? (
          <Empty title="Nenhuma regra configurada" text="Crie uma regra ou carregue os exemplos: ventilador por temperatura, bomba por nível, sirene crítica e alarme de alimentação." />
        ) : (
          <table class="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Situação</th>
                <th>Condição</th>
                <th>Ação</th>
                <th>Alarme</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {used.map((slot) => {
                const active = telemetry ? (telemetry.activeRules & (1 << slot.slot)) !== 0 : slot.active;
                return (
                  <tr key={slot.slot} class={active ? `row-active row-${severityTone(slot.rule.severity)}` : ''}>
                    <td class="mono">{slot.slot + 1}</td>
                    <td>{!slot.rule.enabled ? <Chip>desligada</Chip> : active ? <Chip tone={severityTone(slot.rule.severity) === 'neutral' ? 'accent' : severityTone(slot.rule.severity)}>atuando</Chip> : <Chip tone="ok">vigiando</Chip>}</td>
                    <td>{describeCondition(slot.rule)}</td>
                    <td>{describeAction(slot.rule)}</td>
                    <td>{slot.rule.severity > 0 ? <Chip tone={severityTone(slot.rule.severity)}>{severityName(slot.rule.severity)}</Chip> : <span class="muted">—</span>}</td>
                    <td class="row-actions">
                      <Button small onClick={() => setEditing({ slot: slot.slot, rule: slot.rule })}>
                        Editar
                      </Button>
                      <Button small variant="ghost" onClick={() => setRemoving(slot.slot)}>
                        Remover
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Como as regras funcionam">
        <ul class="explain">
          <li>A regra ativa quando a condição dura o tempo de atraso e só volta ao normal depois de passar a histerese.</li>
          <li>Ao ativar e ao voltar ao normal, a saída escolhida recebe o valor configurado. Comandos manuais valem até a próxima mudança da regra.</li>
          <li>Se a comunicação com o computador cair, as regras continuam rodando no ESP32. As saídas comandadas manualmente vão para o estado seguro, se essa opção estiver ligada.</li>
          <li>Alterações ficam na memória de trabalho até você usar “Gravar no dispositivo”. Uma cópia de cada regra também fica guardada neste computador.</li>
        </ul>
      </Card>
      {editing && <RuleEditor slot={editing.slot} initial={editing.rule} onClose={() => setEditing(null)} />}
      {removing !== null && (
        <Confirm
          title={`Remover a regra ${removing + 1}?`}
          text="A regra é apagada do dispositivo. Se ela estiver atuando, a saída volta ao valor de normal antes da remoção."
          confirm="Remover"
          danger
          onConfirm={() => void call(window.malha.clearRule(removing), `Regra ${removing + 1} removida.`)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
