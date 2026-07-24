import { useState } from 'react';
import { ListChecks, Crown, Gift } from 'lucide-react';
import RewardTasks from './RewardTasks';
import RewardPass from './RewardPass';
import VipPlans from './VipPlans';

// ─────────────────────────────────────────────────────────────────────────────
// Rewards & VIP — unified admin hub
// ─────────────────────────────────────────────────────────────────────────────
// Combines the three tightly-linked surfaces into one tabbed page so admins
// manage the whole engagement funnel in one place:
//   • Reward Tasks  — earn coins + Pass Points (the engine)
//   • Monthly Pass  — tier progression driven by Pass Points (Common + VIP)
//   • VIP Plans     — the premium membership that unlocks the Pass Premium track
//
// Each tab renders the existing, self-contained page component unchanged — this
// is purely an organisational wrapper, so all three keep working standalone too.

type TabId = 'tasks' | 'pass' | 'vip';

const TABS: { id: TabId; label: string; icon: typeof Gift; hint: string }[] = [
  { id: 'tasks', label: 'Reward Tasks', icon: ListChecks, hint: 'Daily / monthly coin-earning tasks' },
  { id: 'pass',  label: 'Monthly Pass Rewards (Free & VIP)', icon: Gift, hint: 'Tier rewards — Free (Common) users + VIP (Premium) users' },
  { id: 'vip',   label: 'VIP Plans',    icon: Crown,       hint: 'Premium membership & perks' },
];

export default function RewardsCenter() {
  const [tab, setTab] = useState<TabId>('tasks');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-bold text-xl">Rewards &amp; VIP</h1>
        <p className="text-sm text-muted-foreground">
          The full engagement funnel in one place: tasks earn Pass Points → the Monthly Pass unlocks tiered rewards → VIP unlocks the Premium track.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card border border-border text-muted-foreground hover:bg-secondary'
              }`}
              title={t.hint}
            >
              <Icon size={15} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Active tab hint */}
      <p className="text-xs text-muted-foreground -mt-2">
        {TABS.find((t) => t.id === tab)?.hint}
      </p>

      {/* Panels — the existing self-contained pages, unchanged. */}
      <div>
        {tab === 'tasks' && <RewardTasks />}
        {tab === 'pass'  && <RewardPass />}
        {tab === 'vip'   && <VipPlans />}
      </div>
    </div>
  );
}
