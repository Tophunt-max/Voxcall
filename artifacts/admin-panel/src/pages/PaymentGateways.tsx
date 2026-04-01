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
import { Plus, Pencil, Trash2, CreditCard, GripVertical, Globe, Smartphone } from 'lucide-react';

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

const PLATFORM_OPTIONS = [
  { value: 'android', label: 'Android', icon: Smartphone },
  { value: 'ios',     label: 'iOS',     icon: Smartphone },
  { value: 'web',     label: 'Web',     icon: Globe },
  { value: 'all',     label: 'All Platforms', icon: Globe },
];

const EMPTY_FORM = {
  name: '',
  type: 'manual',
  icon_emoji: '💳',
  platforms: ['all'] as string[],
  instruction: '',
  redirect_url: '',
  is_active: true,
  position: 0,
};

export default function PaymentGateways() {
  const qc = useQueryClient();
  const { data: gateways = [], isLoading } = useQuery({ queryKey: ['payment-gateways'], queryFn: api.paymentGateways });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [deleting, setDeleting] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: api.createPaymentGateway,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payment-gateways'] }); setOpen(false); toast.success('Gateway created!'); },
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

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setOpen(true);
  }

  function openEdit(gw: any) {
    setEditing(gw);
    let platforms = ['all'];
    try { platforms = JSON.parse(gw.platforms || '["all"]'); } catch {}
    setForm({
      name: gw.name || '',
      type: gw.type || 'manual',
      icon_emoji: gw.icon_emoji || '💳',
      platforms,
      instruction: gw.instruction || '',
      redirect_url: gw.redirect_url || '',
      is_active: !!gw.is_active,
      position: gw.position || 0,
    });
    setOpen(true);
  }

  function handleSave() {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    const payload = { ...form };
    if (editing) update.mutate({ id: editing.id, data: payload });
    else create.mutate(payload);
  }

  function togglePlatform(p: string) {
    setForm(f => {
      const cur = f.platforms;
      if (p === 'all') return { ...f, platforms: ['all'] };
      const without = cur.filter(x => x !== 'all' && x !== p);
      const newList = cur.includes(p) ? without : [...without, p];
      return { ...f, platforms: newList.length === 0 ? ['all'] : newList };
    });
  }

  const typeInfo = (type: string) => GATEWAY_TYPES.find(t => t.value === type) || { emoji: '💳', label: type };

  const platformColor: Record<string, string> = {
    android: 'bg-green-100 text-green-700',
    ios: 'bg-gray-100 text-gray-700',
    web: 'bg-blue-100 text-blue-700',
    all: 'bg-purple-100 text-purple-700',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payment Gateways</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage payment methods shown to users in the app — auto-detected by platform.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus size={16} /> Add Gateway
        </Button>
      </div>

      {/* Info Banner */}
      <div className="rounded-xl border bg-violet-50 dark:bg-violet-950/20 p-4 flex gap-3 items-start">
        <CreditCard className="text-violet-600 mt-0.5 shrink-0" size={18} />
        <div className="text-sm text-violet-800 dark:text-violet-300">
          <p className="font-semibold mb-1">Platform Auto-Detection</p>
          <ul className="list-disc list-inside space-y-0.5 text-violet-700 dark:text-violet-400">
            <li>🤖 <strong>Android</strong> — Google Pay is auto-shown natively + Android gateways</li>
            <li>🍎 <strong>iOS</strong> — Apple Pay is auto-shown natively + iOS gateways</li>
            <li>🌐 <strong>Web</strong> — Shows only web-compatible gateways from this list</li>
          </ul>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : gateways.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border rounded-xl">
          <CreditCard size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No payment gateways configured</p>
          <p className="text-sm mt-1">Add your first gateway to enable payments in the app</p>
          <Button onClick={openCreate} className="mt-4 gap-2" variant="outline">
            <Plus size={14} /> Add Gateway
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {gateways.map((gw: any) => {
            const info = typeInfo(gw.type);
            let platforms: string[] = ['all'];
            try { platforms = JSON.parse(gw.platforms || '["all"]'); } catch {}
            return (
              <div key={gw.id} className="flex items-center gap-4 rounded-xl border bg-card p-4 shadow-sm hover:shadow transition-shadow">
                <GripVertical size={16} className="text-muted-foreground/40 shrink-0" />
                <div className="text-2xl shrink-0">{gw.icon_emoji || info.emoji}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate">{gw.name}</span>
                    <Badge variant="secondary" className="text-xs">{info.label}</Badge>
                    {platforms.map(p => (
                      <span key={p} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${platformColor[p] || 'bg-gray-100 text-gray-600'}`}>
                        {p}
                      </span>
                    ))}
                  </div>
                  {gw.instruction && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{gw.instruction}</p>
                  )}
                  {gw.redirect_url && (
                    <p className="text-xs text-blue-500 mt-0.5 truncate">{gw.redirect_url}</p>
                  )}
                </div>
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
                <Input placeholder="e.g. Google Pay" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
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
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GATEWAY_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.emoji} {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Supported Platforms</Label>
              <div className="flex flex-wrap gap-2">
                {PLATFORM_OPTIONS.map(p => {
                  const active = form.platforms.includes(p.value);
                  return (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => togglePlatform(p.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        active
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>User Instruction / Description</Label>
              <Input placeholder="e.g. Pay securely via UPI / QR code" value={form.instruction} onChange={e => setForm(f => ({ ...f, instruction: e.target.value }))} />
            </div>

            <div className="space-y-1.5">
              <Label>Payment / Redirect URL (optional)</Label>
              <Input placeholder="https://pay.example.com/voxlink" value={form.redirect_url} onChange={e => setForm(f => ({ ...f, redirect_url: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Display Order</Label>
                <Input type="number" min={0} value={form.position} onChange={e => setForm(f => ({ ...f, position: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="flex items-end gap-2 pb-0.5">
                <Switch
                  checked={form.is_active}
                  onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))}
                />
                <Label>{form.is_active ? 'Active' : 'Inactive'}</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={create.isPending || update.isPending}>
              {editing ? 'Save Changes' : 'Create Gateway'}
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
          <p className="text-sm text-muted-foreground">This will remove the payment gateway from the app. This cannot be undone.</p>
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
