import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Pencil, Trash2, CreditCard, ArrowUp, ArrowDown, Star, AlertTriangle } from 'lucide-react';

const GATEWAY_TYPES = [
  { value: 'googlepay',  label: 'Google Pay',   emoji: '🟢' },
  { value: 'applepay',   label: 'Apple Pay',    emoji: '🍎' },
  { value: 'stripe',     label: 'Stripe',       emoji: '💳' },
  { value: 'razorpay',   label: 'Razorpay',     emoji: '🔵' },
  { value: 'paypal',     label: 'PayPal',       emoji: '🅿️' },
  { value: 'paytm',      label: 'Paytm',        emoji: '💰' },
  { value: 'phonepe',    label: 'PhonePe',      emoji: '📱' },
  { value: 'upi',        label: 'UPI',          emoji: '🇮🇳' },
  { value: 'manual',     label: 'Manual/Bank',  emoji: '🏦' },
  { value: 'custom',     label: 'Custom',       emoji: '⚙️' },
];

const EMPTY_FORM = {
  name: '',
  type: 'razorpay',
  icon_emoji: '🔵',
  instruction: '',
  redirect_url: '',
  is_active: true,
  position: 0,
};

export default function PaymentGateways() {
  const qc = useQueryClient();
  const { data: gateways = [], isLoading } = useQuery({
    queryKey: ['payment-gateways'],
    queryFn: api.paymentGateways,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [deleting, setDeleting] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: api.createPaymentGateway,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payment-gateways'] }); setOpen(false); toast.success('Gateway added!'); },
    onError: (e: any) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, data }: any) => api.updatePaymentGateway(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payment-gateways'] }); setOpen(false); toast.success('Gateway updated!'); },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: api.deletePaymentGateway,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payment-gateways'] }); setDeleting(null); toast.success('Gateway deleted'); },
    onError: (e: any) => toast.error(e.message),
  });
  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: any) => api.updatePaymentGateway(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payment-gateways'] }),
  });
  const moveUp = useMutation({
    mutationFn: ({ id, pos }: any) => api.updatePaymentGateway(id, { position: pos }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payment-gateways'] }),
  });

  function openCreate() {
    setEditing(null);
    const nextPos = (gateways as any[]).length;
    setForm({ ...EMPTY_FORM, position: nextPos });
    setOpen(true);
  }

  function openEdit(gw: any) {
    setEditing(gw);
    setForm({
      name: gw.name || '',
      type: gw.type || 'manual',
      icon_emoji: gw.icon_emoji || '💳',
      instruction: gw.instruction || '',
      redirect_url: gw.redirect_url || '',
      is_active: !!gw.is_active,
      position: gw.position || 0,
    });
    setOpen(true);
  }

  function handleSave() {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (editing) update.mutate({ id: editing.id, data: form });
    else create.mutate(form);
  }

  function swapPositions(indexA: number, indexB: number) {
    const sorted = [...(gateways as any[])].sort((a, b) => a.position - b.position);
    const a = sorted[indexA];
    const b = sorted[indexB];
    if (!a || !b) return;
    moveUp.mutate({ id: a.id, pos: b.position });
    moveUp.mutate({ id: b.id, pos: a.position });
  }

  const typeInfo = (type: string) => GATEWAY_TYPES.find(t => t.value === type) || { emoji: '💳', label: type };

  // Sort by position
  const sorted = [...(gateways as any[])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const activeCount = sorted.filter(g => g.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payment Gateways</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage payment methods for the app. Only the first active gateway is used — others are automatic fallbacks.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus size={16} /> Add Gateway
        </Button>
      </div>

      {/* How it works */}
      <div className="rounded-xl border bg-violet-50 dark:bg-violet-950/20 p-4 space-y-2">
        <div className="flex items-center gap-2 font-semibold text-violet-800 dark:text-violet-300 text-sm">
          <CreditCard size={16} />
          How Gateway Auto-Selection Works
        </div>
        <ul className="text-xs text-violet-700 dark:text-violet-400 space-y-1 list-disc list-inside">
          <li>The gateway with the <strong>lowest position (top of list)</strong> is used as the <strong>Primary</strong> gateway.</li>
          <li>If Primary fails or is disabled, the next gateway is tried automatically (Fallback chain).</li>
          <li>On <strong>Android</strong> — Google Pay is used natively. On <strong>iOS</strong> — Apple Pay is used natively.</li>
          <li>On <strong>Web</strong> — the Primary active gateway's redirect URL is opened directly.</li>
          <li>Users <strong>never see</strong> gateway selection — it's fully automatic and transparent.</li>
        </ul>
      </div>

      {activeCount === 0 && !isLoading && (
        <div className="flex items-center gap-3 rounded-xl border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 p-4 text-sm text-yellow-800 dark:text-yellow-300">
          <AlertTriangle size={16} className="shrink-0" />
          No active gateways! Users cannot complete payments on web until at least one gateway is active.
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border rounded-xl">
          <CreditCard size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No payment gateways configured</p>
          <p className="text-sm mt-1">Add your first gateway to enable web payments</p>
          <Button onClick={openCreate} className="mt-4 gap-2" variant="outline">
            <Plus size={14} /> Add Gateway
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {sorted.map((gw: any, idx: number) => {
            const info = typeInfo(gw.type);
            const isFirst = idx === 0;
            const isPrimary = isFirst && !!gw.is_active;
            const fallbackNum = gw.is_active ? sorted.filter((g: any, i: number) => i < idx && g.is_active).length : null;

            return (
              <div
                key={gw.id}
                className={`flex items-center gap-4 rounded-xl border p-4 shadow-sm transition-shadow hover:shadow ${
                  isPrimary ? 'border-violet-400 bg-violet-50/50 dark:bg-violet-950/20' : 'bg-card'
                }`}
              >
                {/* Move Up/Down */}
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    onClick={() => swapPositions(idx, idx - 1)}
                    disabled={idx === 0}
                    className="p-1 rounded hover:bg-muted disabled:opacity-20"
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    onClick={() => swapPositions(idx, idx + 1)}
                    disabled={idx === sorted.length - 1}
                    className="p-1 rounded hover:bg-muted disabled:opacity-20"
                  >
                    <ArrowDown size={12} />
                  </button>
                </div>

                {/* Position number */}
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  isPrimary ? 'bg-violet-600 text-white' : 'bg-muted text-muted-foreground'
                }`}>
                  {idx + 1}
                </div>

                {/* Emoji */}
                <div className="text-2xl shrink-0">{gw.icon_emoji || info.emoji}</div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate">{gw.name}</span>
                    <Badge variant="secondary" className="text-xs">{info.label}</Badge>
                    {isPrimary && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold bg-violet-600 text-white">
                        <Star size={9} /> PRIMARY
                      </span>
                    )}
                    {!isPrimary && gw.is_active && fallbackNum !== null && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        FALLBACK {fallbackNum + 1}
                      </span>
                    )}
                    {!gw.is_active && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">
                        DISABLED
                      </span>
                    )}
                  </div>
                  {gw.instruction && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{gw.instruction}</p>
                  )}
                  {gw.redirect_url ? (
                    <p className="text-xs text-blue-500 mt-0.5 truncate">{gw.redirect_url}</p>
                  ) : (
                    <p className="text-xs text-orange-500 mt-0.5">⚠ No redirect URL set — direct API processing only</p>
                  )}
                </div>

                {/* Controls */}
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={!!gw.is_active}
                    onCheckedChange={(v) => toggleActive.mutate({ id: gw.id, is_active: v })}
                  />
                  <Button size="icon" variant="ghost" onClick={() => openEdit(gw)}>
                    <Pencil size={14} />
                  </Button>
                  <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleting(gw.id)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Gateway' : 'Add Payment Gateway'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Gateway Name *</Label>
                <Input placeholder="e.g. Razorpay" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Icon Emoji</Label>
                <Input placeholder="💳" value={form.icon_emoji} onChange={e => setForm(f => ({ ...f, icon_emoji: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Gateway Type</Label>
              <Select value={form.type} onValueChange={v => {
                const info = GATEWAY_TYPES.find(t => t.value === v);
                setForm(f => ({ ...f, type: v, icon_emoji: info?.emoji || f.icon_emoji }));
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GATEWAY_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.emoji} {t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Payment Redirect URL</Label>
              <Input
                placeholder="https://pay.example.com/checkout"
                value={form.redirect_url}
                onChange={e => setForm(f => ({ ...f, redirect_url: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                On web, users are redirected here with <code className="bg-muted px-1 rounded text-[10px]">?plan_id&amount&coins</code> appended automatically.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>User-facing Description (optional)</Label>
              <Input placeholder="e.g. UPI, Card, Net Banking & more" value={form.instruction} onChange={e => setForm(f => ({ ...f, instruction: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Priority Order</Label>
                <Input
                  type="number" min={0}
                  value={form.position}
                  onChange={e => setForm(f => ({ ...f, position: parseInt(e.target.value) || 0 }))}
                />
                <p className="text-xs text-muted-foreground">Lower = higher priority. 0 = Primary.</p>
              </div>
              <div className="flex items-end gap-2 pb-5">
                <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
                <Label>{form.is_active ? 'Active' : 'Inactive'}</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={create.isPending || update.isPending}>
              {editing ? 'Save Changes' : 'Add Gateway'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleting} onOpenChange={v => !v && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Gateway?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the gateway permanently. If it is the Primary, the next gateway in the list will automatically become Primary.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleting && remove.mutate(deleting)} disabled={remove.isPending}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
