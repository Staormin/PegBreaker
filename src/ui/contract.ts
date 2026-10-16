// ui/contract.ts — bandeau du contrat de vague (F2), placé par hud.ts sous la barre du haut.
// Actif : texte (≤ 40 caractères, {n} → target), jauge progress/target (fond du bandeau + « 1/3 »),
// récompense en icône. Réussi : vert 1 s « ✓ +récompense » puis disparaît. Raté : grisé 0,8 s
// « ✗ texte » puis disparaît. Les événements pilotent les transitions ; l'état (`RunState.contract`)
// sert de secours (reprise de sauvegarde, événement manqué) et de source de la progression.
import type { EventBus } from '../core/events';
import type { ContractDef, GameConfig, RewardOption, RunState } from '../core/types';
import { clip, el } from './dom';
import { optionIcon } from './options';

const DONE_MS = 1000;
const FAILED_MS = 800;
const MAX_TEXT = 40;

type Mode = 'hidden' | 'active' | 'done' | 'failed';

export interface ContractBanner {
  readonly el: HTMLElement;
  /** le bandeau occupe la bande sous la barre du haut */
  readonly busy: boolean;
  update(state: Readonly<RunState>): void;
  reset(): void;
}

/** texte du contrat : {n} → target, 40 caractères max */
export function contractText(def: ContractDef, target: number): string {
  return clip(def.text.split('{n}').join(String(target)), MAX_TEXT);
}

/** quantité courte affichée à côté de l'icône de récompense */
function rewardAmount(r: RewardOption): string {
  switch (r.kind) {
    case 'coins':
    case 'heal':
      return `+${r.amount}`;
    case 'ball':
      return '+1';
    default:
      return '';
  }
}

function rewardLabel(config: GameConfig, r: RewardOption): string {
  switch (r.kind) {
    case 'coins':
      return `${r.amount} pièces`;
    case 'heal':
      return `${r.amount} PV`;
    case 'ball': {
      const d = config.balls.defs.find((b) => b.id === r.element);
      return `1 balle ${d?.name ?? r.element}`;
    }
    case 'relic':
      return config.relics.defs.find((d) => d.id === r.relicId)?.name ?? 'relique';
    case 'fuse':
      return 'fusion';
  }
}

export function createContractBanner(config: GameConfig, bus: EventBus, onBusyChange: () => void): ContractBanner {
  const box = el('div', 'hud-contract');
  box.setAttribute('role', 'status');
  box.dataset.state = 'hidden';
  const fill = el('span', 'hc-fill');
  fill.setAttribute('aria-hidden', 'true');
  const text = el('span', 'hc-text');
  const prog = el('span', 'num hc-prog');
  const reward = el('span', 'hc-reward');
  const rewardIco = el('span', 'hc-ico');
  const rewardNum = el('span', 'num hc-amt');
  reward.append(rewardIco, rewardNum);
  box.append(fill, text, prog, reward);

  let mode: Mode = 'hidden';
  let shownId: string | null = null;
  let shownDef: ContractDef | null = null;
  let cProg = -1;
  let cTarget = -1;
  let endTimer = 0;

  function setMode(m: Mode): void {
    const wasBusy = mode !== 'hidden';
    mode = m;
    box.dataset.state = m;
    box.classList.toggle('on', m !== 'hidden');
    if (wasBusy !== (m !== 'hidden')) onBusyChange();
  }

  function setReward(r: RewardOption): void {
    rewardIco.textContent = '';
    rewardIco.append(optionIcon(config, r));
    rewardNum.textContent = rewardAmount(r);
    reward.setAttribute('aria-label', `Récompense : ${rewardLabel(config, r)}`);
  }

  function setProgress(p: number, target: number): void {
    if (p === cProg && target === cTarget) return;
    cProg = p;
    cTarget = target;
    const t = target > 0 ? target : 1;
    const ratio = Math.max(0, Math.min(1, p / t));
    fill.style.transform = `scaleX(${ratio})`;
    prog.textContent = `${Math.min(p, target)}/${target}`;
    box.setAttribute('aria-label', `Contrat : ${text.textContent ?? ''}, ${Math.min(p, target)} sur ${target}`);
  }

  function show(def: ContractDef, progress: number, target: number): void {
    clearTimeout(endTimer);
    shownId = def.id;
    shownDef = def;
    text.textContent = contractText(def, target);
    setReward(def.reward);
    cProg = cTarget = -1;
    setProgress(progress, target);
    setMode('active');
  }

  function end(kind: 'done' | 'failed', def: ContractDef, r: RewardOption | null): void {
    clearTimeout(endTimer);
    if (shownId !== def.id || mode === 'hidden') {
      shownId = def.id;
      shownDef = def;
      setReward(def.reward);
    }
    const target = cTarget > 0 ? cTarget : def.target;
    if (kind === 'done') {
      if (r) setReward(r);
      text.textContent = '✓';
      setProgress(target, target);
      box.setAttribute('aria-label', `Contrat réussi : ${rewardLabel(config, r ?? def.reward)}`);
    } else {
      text.textContent = `✗ ${contractText(def, target)}`;
      box.setAttribute('aria-label', `Contrat raté : ${contractText(def, target)}`);
    }
    setMode(kind);
    endTimer = window.setTimeout(() => setMode('hidden'), kind === 'done' ? DONE_MS : FAILED_MS);
  }

  bus.on('contract:offered', (e) => show(e.def, e.contract.progress, e.contract.target));
  bus.on('contract:progress', (e) => {
    if (mode === 'active') setProgress(e.progress, e.target);
  });
  bus.on('contract:completed', (e) => end('done', e.def, e.reward));
  bus.on('contract:failed', (e) => end('failed', e.def, null));

  function update(s: Readonly<RunState>): void {
    const c = s.contract;
    if (mode === 'active') {
      if (!c || c.id !== shownId) {
        // run relancée ou contrat remplacé sans événement
        if (c && c.status === 'active') {
          const def = config.contracts.defs.find((d) => d.id === c.id);
          if (def) show(def, c.progress, c.target);
          else setMode('hidden');
        } else setMode('hidden');
      } else if (c.status === 'active') setProgress(c.progress, c.target);
      else if (shownDef && c.status === 'done') end('done', shownDef, null);
      else if (shownDef && c.status === 'failed') end('failed', shownDef, null);
    } else if (mode === 'hidden' && c && c.status === 'active') {
      // secours : reprise de sauvegarde (pas de contract:offered)
      const def = config.contracts.defs.find((d) => d.id === c.id);
      if (def) show(def, c.progress, c.target);
    }
  }

  function reset(): void {
    clearTimeout(endTimer);
    shownId = null;
    shownDef = null;
    if (mode !== 'hidden') setMode('hidden');
  }

  return {
    el: box,
    get busy() {
      return mode !== 'hidden';
    },
    update,
    reset,
  };
}
