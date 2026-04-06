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
import { Plus, Pencil, Trash2, CreditCard, ArrowUp, ArrowDown, Star, AlertTriangle, QrCode, Clock, RefreshCw, Webhook, Copy, CheckCircle2, Settings, ShieldCheck, Zap } from 'lucide-react';

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

const EMPTY_GW_FORM = {
  name: '',
  type: 'razorpay',
  icon_emoji: '🔵',
  instruction: '',
  redirect_url: '',
  is_active: true,
  position: 0,
};

const EMPTY_QR_FORM = {
  name: '',
  upi_id: '',
  qr_image_url: '',
  instructions: '',
  is_active: true,
  position: 0,
  rotate_interval_min: 30,
};

// ─── Auto Gateways Tab ────────────────────────────────────────────────────────
function AutoGatewaysTab() {
  const qc = useQueryClient();
  const { data: gateways = [], isLoading } = useQuery({
    queryKey: ['payment-gateways'],
    queryFn: api.paymentGateways,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_GW_FORM });
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
    setForm({ ...EMPTY_GW_FORM, position: nextPos });
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
  const sorted = [...(gateways as any[])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const activeCount = sorted.filter(g => g.is_active).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Automatic gateways for web. Primary (top active) is used first, others are fallbacks.</p>
        <Button onClick={openCreate} size="sm" className="gap-2"><Plus size={14} /> Add Gateway</Button>
      </div>

      <div className="rounded-xl border bg-violet-50 dark:bg-violet-950/20 p-4 space-y-2">
        <div className="flex items-center gap-2 font-semibold text-violet-800 dark:text-violet-300 text-sm">
          <CreditCard size={16} /> How Auto-Selection Works
        </div>
        <ul className="text-xs text-violet-700 dark:text-violet-400 space-y-1 list-disc list-inside">
          <li>Lowest position = <strong>Primary</strong> gateway. If it fails, the next active one is tried.</li>
          <li>On <strong>Android</strong> — Google Pay is used natively. On <strong>iOS</strong> — Apple Pay.</li>
          <li>On <strong>Web</strong> — Primary active gateway redirect URL is opened.</li>
        </ul>
      </div>

      {activeCount === 0 && !isLoading && (
        <div className="flex items-center gap-3 rounded-xl border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 p-4 text-sm text-yellow-800 dark:text-yellow-300">
          <AlertTriangle size={16} className="shrink-0" />
          No active gateways! Web payments require at least one active gateway.
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
          <Button onClick={openCreate} className="mt-4 gap-2" variant="outline" size="sm"><Plus size={14} /> Add Gateway</Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {sorted.map((gw: any, idx: number) => {
            const info = typeInfo(gw.type);
            const isPrimary = idx === 0 && !!gw.is_active;
            const fallbackNum = gw.is_active ? sorted.filter((g: any, i: number) => i < idx && g.is_active).length : null;
            return (
              <div key={gw.id} className={`flex items-center gap-4 rounded-xl border p-4 shadow-sm ${isPrimary ? 'border-violet-400 bg-violet-50/50 dark:bg-violet-950/20' : 'bg-card'}`}>
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button onClick={() => swapPositions(idx, idx - 1)} disabled={idx === 0} className="p-1 rounded hover:bg-muted disabled:opacity-20"><ArrowUp size={12} /></button>
                  <button onClick={() => swapPositions(idx, idx + 1)} disabled={idx === sorted.length - 1} className="p-1 rounded hover:bg-muted disabled:opacity-20"><ArrowDown size={12} /></button>
                </div>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isPrimary ? 'bg-violet-600 text-white' : 'bg-muted text-muted-foreground'}`}>{idx + 1}</div>
                <div className="text-2xl shrink-0">{gw.icon_emoji || info.emoji}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate">{gw.name}</span>
                    <Badge variant="secondary" className="text-xs">{info.label}</Badge>
                    {isPrimary && <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold bg-violet-600 text-white"><Star size={9} /> PRIMARY</span>}
                    {!isPrimary && gw.is_active && fallbackNum !== null && <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">FALLBACK {fallbackNum + 1}</span>}
                    {!gw.is_active && <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">DISABLED</span>}
                  </div>
                  {gw.instruction && <p className="text-xs text-muted-foreground mt-0.5 truncate">{gw.instruction}</p>}
                  {gw.redirect_url ? <p className="text-xs text-blue-500 mt-0.5 truncate">{gw.redirect_url}</p> : <p className="text-xs text-orange-500 mt-0.5">⚠ No redirect URL — direct API processing only</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={!!gw.is_active} onCheckedChange={(v) => toggleActive.mutate({ id: gw.id, is_active: v })} />
                  <Button size="icon" variant="ghost" onClick={() => openEdit(gw)}><Pencil size={14} /></Button>
                  <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleting(gw.id)}><Trash2 size={14} /></Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Edit Gateway' : 'Add Payment Gateway'}</DialogTitle></DialogHeader>
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
              <Select value={form.type} onValueChange={v => { const info = GATEWAY_TYPES.find(t => t.value === v); setForm(f => ({ ...f, type: v, icon_emoji: info?.emoji || f.icon_emoji })); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{GATEWAY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.emoji} {t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Payment Redirect URL</Label>
              <Input placeholder="https://pay.example.com/checkout" value={form.redirect_url} onChange={e => setForm(f => ({ ...f, redirect_url: e.target.value }))} />
              <p className="text-xs text-muted-foreground">On web, users are redirected here with <code className="bg-muted px-1 rounded text-[10px]">?plan_id&amount&coins</code> appended.</p>
            </div>
            <div className="space-y-1.5">
              <Label>User-facing Description (optional)</Label>
              <Input placeholder="e.g. UPI, Card, Net Banking & more" value={form.instruction} onChange={e => setForm(f => ({ ...f, instruction: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Priority Order</Label>
                <Input type="number" min={0} value={form.position} onChange={e => setForm(f => ({ ...f, position: parseInt(e.target.value) || 0 }))} />
                <p className="text-xs text-muted-foreground">Lower = higher priority.</p>
              </div>
              <div className="flex items-end gap-2 pb-5">
                <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
                <Label>{form.is_active ? 'Active' : 'Inactive'}</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={create.isPending || update.isPending}>{editing ? 'Save Changes' : 'Add Gateway'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={v => !v && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Gateway?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This removes the gateway permanently.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleting && remove.mutate(deleting)} disabled={remove.isPending}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Manual QR Codes Tab ──────────────────────────────────────────────────────
function ManualQRTab() {
  const qc = useQueryClient();
  const { data: qrCodes = [], isLoading } = useQuery({
    queryKey: ['manual-qr-codes'],
    queryFn: api.manualQRCodes,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_QR_FORM });
  const [deleting, setDeleting] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: api.createManualQRCode,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['manual-qr-codes'] }); setOpen(false); toast.success('QR Code added!'); },
    onError: (e: any) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, data }: any) => api.updateManualQRCode(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['manual-qr-codes'] }); setOpen(false); toast.success('QR Code updated!'); },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: api.deleteManualQRCode,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['manual-qr-codes'] }); setDeleting(null); toast.success('QR Code deleted'); },
    onError: (e: any) => toast.error(e.message),
  });
  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: any) => api.updateManualQRCode(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['manual-qr-codes'] }),
  });
  const movePos = useMutation({
    mutationFn: ({ id, pos }: any) => api.updateManualQRCode(id, { position: pos }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['manual-qr-codes'] }),
  });

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_QR_FORM, position: (qrCodes as any[]).length });
    setOpen(true);
  }

  function openEdit(qr: any) {
    setEditing(qr);
    setForm({
      name: qr.name || '',
      upi_id: qr.upi_id || '',
      qr_image_url: qr.qr_image_url || '',
      instructions: qr.instructions || '',
      is_active: !!qr.is_active,
      position: qr.position ?? 0,
      rotate_interval_min: qr.rotate_interval_min ?? 30,
    });
    setOpen(true);
  }

  function handleSave() {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (!form.upi_id.trim()) { toast.error('UPI ID is required'); return; }
    if (!form.qr_image_url.trim()) { toast.error('QR Image URL is required'); return; }
    if (editing) update.mutate({ id: editing.id, data: form });
    else create.mutate(form);
  }

  function swapPos(indexA: number, indexB: number) {
    const sorted = [...(qrCodes as any[])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const a = sorted[indexA], b = sorted[indexB];
    if (!a || !b) return;
    movePos.mutate({ id: a.id, pos: b.position });
    movePos.mutate({ id: b.id, pos: a.position });
  }

  const sorted = [...(qrCodes as any[])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const activeCount = sorted.filter(q => q.is_active).length;

  // Simulate which QR is "current" based on server-side rotation logic
  const intervalMin = activeCount > 0 ? Math.max(1, Math.min(...sorted.filter(q => q.is_active).map((q: any) => q.rotate_interval_min || 30))) : 30;
  const slot = Math.floor(Date.now() / 1000 / 60 / intervalMin);
  const activeOnes = sorted.filter(q => q.is_active);
  const currentQR = activeOnes.length > 0 ? activeOnes[slot % activeOnes.length] : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Add multiple UPI QR codes. They rotate automatically for users based on the interval you set.</p>
        <Button onClick={openCreate} size="sm" className="gap-2"><Plus size={14} /> Add QR Code</Button>
      </div>

      {/* How rotation works */}
      <div className="rounded-xl border bg-green-50 dark:bg-green-950/20 p-4 space-y-2">
        <div className="flex items-center gap-2 font-semibold text-green-800 dark:text-green-300 text-sm">
          <RefreshCw size={16} /> How QR Rotation Works
        </div>
        <ul className="text-xs text-green-700 dark:text-green-400 space-y-1 list-disc list-inside">
          <li>Active QR codes rotate automatically based on the <strong>Rotate Every</strong> interval (minutes).</li>
          <li>Rotation is time-based — all users see the <strong>same QR</strong> at the same time, ensuring payment goes to the right account.</li>
          <li>The QR with the <strong>lowest position</strong> appears first in the rotation cycle.</li>
          <li>You can have unlimited QR codes. Only <strong>active</strong> ones are shown to users.</li>
          <li>User submits UTR reference after payment — admin approves from the <strong>Deposits</strong> section.</li>
        </ul>
      </div>

      {/* Current QR indicator */}
      {currentQR && (
        <div className="flex items-center gap-3 rounded-xl border border-green-300 bg-green-50 dark:bg-green-900/20 p-3 text-sm">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
          <span className="font-medium text-green-800 dark:text-green-300">Currently showing users:</span>
          <span className="text-green-700 dark:text-green-400">{currentQR.name} — <code className="text-xs">{currentQR.upi_id}</code></span>
          <span className="ml-auto text-xs text-green-600 flex items-center gap-1">
            <Clock size={11} /> Rotates every {intervalMin} min
          </span>
        </div>
      )}

      {activeCount === 0 && !isLoading && (
        <div className="flex items-center gap-3 rounded-xl border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 p-4 text-sm text-yellow-800 dark:text-yellow-300">
          <AlertTriangle size={16} className="shrink-0" />
          No active QR codes! Users cannot make manual payments until you add at least one active QR code.
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border rounded-xl">
          <QrCode size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No QR codes yet</p>
          <p className="text-sm mt-1">Add UPI QR codes so users can pay manually</p>
          <Button onClick={openCreate} className="mt-4 gap-2" variant="outline" size="sm"><Plus size={14} /> Add QR Code</Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {sorted.map((qr: any, idx: number) => {
            const isCurrent = currentQR?.id === qr.id;
            return (
              <div key={qr.id} className={`flex items-center gap-4 rounded-xl border p-4 shadow-sm transition-shadow hover:shadow ${isCurrent ? 'border-green-400 bg-green-50/50 dark:bg-green-950/20' : 'bg-card'}`}>
                {/* Move Up/Down */}
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button onClick={() => swapPos(idx, idx - 1)} disabled={idx === 0} className="p-1 rounded hover:bg-muted disabled:opacity-20"><ArrowUp size={12} /></button>
                  <button onClick={() => swapPos(idx, idx + 1)} disabled={idx === sorted.length - 1} className="p-1 rounded hover:bg-muted disabled:opacity-20"><ArrowDown size={12} /></button>
                </div>

                {/* Position badge */}
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isCurrent ? 'bg-green-600 text-white' : 'bg-muted text-muted-foreground'}`}>{idx + 1}</div>

                {/* QR Preview */}
                {qr.qr_image_url ? (
                  <button onClick={() => setPreview(qr.qr_image_url)} className="shrink-0 hover:opacity-80 transition-opacity" title="Click to preview">
                    <img src={qr.qr_image_url} alt={qr.name} className="w-12 h-12 rounded-lg object-cover border" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </button>
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0"><QrCode size={20} className="opacity-30" /></div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate">{qr.name}</span>
                    {isCurrent && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold bg-green-600 text-white">
                        <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE NOW
                      </span>
                    )}
                    {!qr.is_active && <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">DISABLED</span>}
                  </div>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5 font-mono">{qr.upi_id}</p>
                  {qr.instructions && <p className="text-xs text-muted-foreground mt-0.5 truncate">{qr.instructions}</p>}
                  <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                    <Clock size={10} /> Rotates every {qr.rotate_interval_min ?? 30} min
                  </div>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={!!qr.is_active} onCheckedChange={(v) => toggleActive.mutate({ id: qr.id, is_active: v })} />
                  <Button size="icon" variant="ghost" onClick={() => openEdit(qr)}><Pencil size={14} /></Button>
                  <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleting(qr.id)}><Trash2 size={14} /></Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Edit QR Code' : 'Add Manual QR Code'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>Display Name *</Label>
                <Input placeholder="e.g. PhonePe Business" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>UPI ID *</Label>
              <Input placeholder="e.g. business@phonepe" value={form.upi_id} onChange={e => setForm(f => ({ ...f, upi_id: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Users will be shown this UPI ID to send payment to.</p>
            </div>

            <div className="space-y-1.5">
              <Label>QR Code Image URL *</Label>
              <Input placeholder="https://..." value={form.qr_image_url} onChange={e => setForm(f => ({ ...f, qr_image_url: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Upload your QR code image to any CDN (e.g. Cloudflare Images, imgbb, postimg) and paste the URL here.</p>
              {form.qr_image_url && (
                <div className="mt-2 flex items-center gap-3 p-2 border rounded-lg bg-muted/30">
                  <img src={form.qr_image_url} alt="QR Preview" className="w-20 h-20 rounded-md object-contain bg-white border" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  <p className="text-xs text-muted-foreground">Preview — make sure QR is scannable</p>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Payment Instructions (optional)</Label>
              <Input placeholder="e.g. Scan QR or pay to UPI ID, then enter UTR below" value={form.instructions} onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-1">
                <Label>Rotate Every (min)</Label>
                <Input type="number" min={1} max={1440} value={form.rotate_interval_min} onChange={e => setForm(f => ({ ...f, rotate_interval_min: parseInt(e.target.value) || 30 }))} />
                <p className="text-xs text-muted-foreground">Minutes before switching to next QR</p>
              </div>
              <div className="space-y-1.5 col-span-1">
                <Label>Position</Label>
                <Input type="number" min={0} value={form.position} onChange={e => setForm(f => ({ ...f, position: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="flex items-end gap-2 pb-5 col-span-1">
                <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
                <Label>{form.is_active ? 'Active' : 'Inactive'}</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={create.isPending || update.isPending}>{editing ? 'Save Changes' : 'Add QR Code'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleting} onOpenChange={v => !v && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete QR Code?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This removes the QR code permanently. The next active QR will take over in the rotation.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleting && remove.mutate(deleting)} disabled={remove.isPending}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Preview Modal */}
      <Dialog open={!!preview} onOpenChange={v => !v && setPreview(null)}>
        <DialogContent className="max-w-xs flex flex-col items-center gap-4">
          <DialogHeader><DialogTitle>QR Code Preview</DialogTitle></DialogHeader>
          {preview && <img src={preview} alt="QR" className="w-64 h-64 object-contain rounded-xl border bg-white p-2" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Webhook & Settings Tab ───────────────────────────────────────────────────
const WEBHOOK_BASE = 'https://voxlink-api.ssunilkumarmohanta3.workers.dev/api/payment/webhook';
const WEBHOOKS = [
  { key: 'razorpay', label: 'Razorpay', emoji: '🔵', url: `${WEBHOOK_BASE}/razorpay`, secretKey: 'razorpay_webhook_secret', hint: 'Razorpay Dashboard → Settings → Webhooks → Events: payment.captured' },
  { key: 'phonepe', label: 'PhonePe', emoji: '📱', url: `${WEBHOOK_BASE}/phonepe`, secretKey: 'phonepe_webhook_secret', hint: 'PhonePe Business → API → Webhook URL. Event: PAYMENT_SUCCESS' },
  { key: 'stripe', label: 'Stripe', emoji: '💳', url: `${WEBHOOK_BASE}/stripe`, secretKey: 'stripe_webhook_secret', hint: 'Stripe Dashboard → Developers → Webhooks → Events: checkout.session.completed' },
  { key: 'paytm', label: 'Paytm', emoji: '💰', url: `${WEBHOOK_BASE}/paytm`, secretKey: null, hint: 'Paytm Dashboard → Payments → Webhooks' },
  { key: 'generic', label: 'Generic / Custom', emoji: '⚙️', url: `${WEBHOOK_BASE}/generic`, secretKey: 'generic_webhook_secret', hint: 'Your custom gateway can POST { purchase_id, status: "success", secret } to this URL' },
];

function WebhookSettingsTab() {
  const qc = useQueryClient();
  const { data: config = {}, isLoading } = useQuery({ queryKey: ['app-config'], queryFn: api.appConfig });
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  // Auto-approve settings
  const [autoApprove, setAutoApprove] = useState(false);
  const [autoApproveMax, setAutoApproveMax] = useState('');
  const [autoSaving, setAutoSaving] = useState(false);
  const [gpKey, setGpKey] = useState('');
  const [gpSaving, setGpSaving] = useState(false);

  // Sync local state from loaded config
  useEffect(() => {
    if (!config || isLoading) return;
    const c = config as any;
    setAutoApprove(c.auto_approve_manual === 'true' || c.auto_approve_manual === '1');
    setAutoApproveMax(c.auto_approve_manual_max_amount || '');
    WEBHOOKS.forEach(w => {
      if (w.secretKey && c[w.secretKey]) setSecrets(s => ({ ...s, [w.secretKey!]: c[w.secretKey!] }));
    });
  }, [config, isLoading]);

  const saveMutation = useMutation({ mutationFn: api.updateAppConfig, onSuccess: () => qc.invalidateQueries({ queryKey: ['app-config'] }) });

  function copyUrl(url: string, key: string) {
    navigator.clipboard?.writeText(url).then(() => { setCopied(s => ({ ...s, [key]: true })); setTimeout(() => setCopied(s => ({ ...s, [key]: false })), 2000); });
  }

  async function saveSecret(w: typeof WEBHOOKS[0]) {
    if (!w.secretKey) return;
    await saveMutation.mutateAsync({ [w.secretKey]: secrets[w.secretKey] || '' });
    setSaved(s => ({ ...s, [w.secretKey!]: true })); setTimeout(() => setSaved(s => ({ ...s, [w.secretKey!]: false })), 2000);
    toast.success(`${w.label} webhook secret saved!`);
  }

  async function saveAutoApprove() {
    setAutoSaving(true);
    await saveMutation.mutateAsync({ auto_approve_manual: autoApprove ? 'true' : 'false', auto_approve_manual_max_amount: autoApproveMax });
    setAutoSaving(false);
    toast.success('Auto-approve settings saved!');
  }

  async function saveGPKey() {
    setGpSaving(true);
    await saveMutation.mutateAsync({ google_play_service_account_note: gpKey ? 'configured' : '' });
    setGpSaving(false);
    toast.success('Note saved — add GOOGLE_PLAY_SERVICE_ACCOUNT_JSON as environment variable in Cloudflare Workers dashboard');
  }

  if (isLoading) return <div className="flex items-center justify-center h-40"><div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-8">
      {/* How it works */}
      <div className="rounded-xl border bg-blue-50 dark:bg-blue-950/20 p-4 space-y-2">
        <div className="flex items-center gap-2 font-semibold text-blue-800 dark:text-blue-300 text-sm"><Zap size={16} /> How Auto-Matching Works</div>
        <ul className="text-xs text-blue-700 dark:text-blue-400 space-y-1 list-disc list-inside">
          <li><strong>Web Auto Gateway:</strong> User pays → gateway sends webhook to VoxLink → coins auto-credited instantly.</li>
          <li><strong>Web Manual UPI:</strong> User submits UTR → admin approves (or auto-approved if enabled below).</li>
          <li><strong>Android Google Play:</strong> User pays in Play Store → app sends purchase token → VoxLink verifies with Google → coins auto-credited.</li>
        </ul>
      </div>

      {/* Gateway Webhooks */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Webhook size={16} className="text-primary" />
          <h3 className="font-semibold text-sm">Gateway Webhook URLs & Secrets</h3>
        </div>
        <p className="text-xs text-muted-foreground">Configure these webhook URLs in each payment gateway's dashboard. When a payment succeeds, the gateway calls this URL and VoxLink automatically credits the coins.</p>
        <div className="space-y-4">
          {WEBHOOKS.map(w => (
            <div key={w.key} className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">{w.emoji}</span>
                <span className="font-semibold text-sm">{w.label}</span>
              </div>
              {/* Webhook URL */}
              <div className="space-y-1.5">
                <Label className="text-xs">Webhook URL (copy & paste into {w.label} dashboard)</Label>
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-2 bg-muted rounded-lg px-3 py-2 min-w-0">
                    <code className="text-xs text-muted-foreground truncate flex-1">{w.url}</code>
                  </div>
                  <Button size="sm" variant="outline" className="gap-2 shrink-0" onClick={() => copyUrl(w.url, w.key)}>
                    {copied[w.key] ? <CheckCircle2 size={13} className="text-green-500" /> : <Copy size={13} />}
                    {copied[w.key] ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">{w.hint}</p>
              </div>
              {/* Secret */}
              {w.secretKey && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Webhook Secret (from {w.label} dashboard)</Label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder={`Paste ${w.label} webhook signing secret`}
                      value={secrets[w.secretKey] || ''}
                      onChange={e => setSecrets(s => ({ ...s, [w.secretKey!]: e.target.value }))}
                      className="flex-1"
                    />
                    <Button size="sm" variant="outline" className="gap-2 shrink-0" onClick={() => saveSecret(w)}>
                      {saved[w.secretKey] ? <CheckCircle2 size={13} className="text-green-500" /> : <ShieldCheck size={13} />}
                      {saved[w.secretKey] ? 'Saved!' : 'Save'}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Used to verify webhook authenticity. Never share this publicly.</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Auto-Approve Manual Payments */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-amber-500" />
          <h3 className="font-semibold text-sm">Auto-Approve Manual (UPI) Payments</h3>
          <Badge variant="secondary" className="text-[10px]">Manual QR</Badge>
        </div>
        <p className="text-xs text-muted-foreground">When enabled, manual UPI deposits are automatically approved as soon as the user submits their UTR — without admin review. Use only if you trust your users or have verified your UPI account receives funds properly.</p>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Switch checked={autoApprove} onCheckedChange={setAutoApprove} />
            <Label className="text-sm font-medium">{autoApprove ? 'Auto-approve ON' : 'Auto-approve OFF (requires admin approval)'}</Label>
          </div>
        </div>
        {autoApprove && (
          <div className="space-y-1.5">
            <Label className="text-xs">Max Amount for Auto-Approve (leave 0 for no limit)</Label>
            <div className="flex gap-2 items-center">
              <Input type="number" min={0} placeholder="0 = no limit" value={autoApproveMax} onChange={e => setAutoApproveMax(e.target.value)} className="max-w-48" />
              <span className="text-xs text-muted-foreground">Deposits above this amount still require manual review.</span>
            </div>
          </div>
        )}
        <div className={`flex items-center gap-3 rounded-lg p-3 text-xs ${autoApprove ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 border border-amber-200' : 'bg-muted text-muted-foreground'}`}>
          <AlertTriangle size={14} className="shrink-0" />
          {autoApprove
            ? 'Warning: Auto-approve trusts that every UTR submission is legitimate. Users could potentially submit fake UTRs. Enable only for trusted audiences or low-risk amounts.'
            : 'Auto-approve is off. Every manual deposit requires admin review in the Deposits section.'}
        </div>
        <Button onClick={saveAutoApprove} disabled={autoSaving} size="sm" className="gap-2">
          {autoSaving ? 'Saving...' : <><CheckCircle2 size={13} /> Save Auto-Approve Settings</>}
        </Button>
      </div>

      {/* Android / Google Play */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <h3 className="font-semibold text-sm">Android — Google Play Auto-Verification</h3>
        </div>
        <p className="text-xs text-muted-foreground">Android app purchases via Google Play are verified server-side using the Google Play Developer API. Setup requires a Google Cloud Service Account with Android Publisher API access.</p>
        <div className="space-y-3">
          <div className="rounded-lg bg-muted p-3 space-y-1.5 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">Setup Steps:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Go to <strong>Google Cloud Console</strong> → Create Service Account with role "Android Publisher"</li>
              <li>Download the service account JSON key file</li>
              <li>Link the service account in <strong>Google Play Console</strong> → Setup → API access</li>
              <li>Base64-encode the JSON: <code className="bg-background px-1 rounded">base64 service-account.json</code></li>
              <li>Add it as env var <code className="bg-background px-1 rounded">GOOGLE_PLAY_SERVICE_ACCOUNT_JSON</code> in Cloudflare Workers dashboard</li>
            </ol>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Verification Endpoint (for reference)</Label>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
                <code className="text-xs text-muted-foreground truncate">POST https://voxlink-api.ssunilkumarmohanta3.workers.dev/api/payment/verify-google-play</code>
              </div>
              <Button size="sm" variant="outline" onClick={() => copyUrl('https://voxlink-api.ssunilkumarmohanta3.workers.dev/api/payment/verify-google-play', 'gp')}>
                {copied['gp'] ? 'Copied!' : <Copy size={13} />}
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 size={12} className="text-green-500 shrink-0" />
            If service account is not configured, Google Play purchases go to pending (manual review) automatically.
          </div>
        </div>
      </div>

      {/* Payment Initiation API */}
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Settings size={16} className="text-primary" />
          <h3 className="font-semibold text-sm">Payment Initiation Endpoint</h3>
        </div>
        <p className="text-xs text-muted-foreground">Use this endpoint to create a pending purchase order server-side before redirecting users to a payment gateway. The gateway should embed the <code className="bg-muted px-1 rounded text-[10px]">purchase_id</code> in payment metadata/notes so the webhook can auto-match it.</p>
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="flex-1 bg-muted rounded-lg px-3 py-2">
              <code className="text-xs">POST /api/payment/initiate — Body: &#123; plan_id, gateway_id, promo_code &#125;</code>
            </div>
            <Button size="sm" variant="outline" onClick={() => copyUrl('POST /api/payment/initiate — { plan_id, gateway_id, promo_code }', 'init')}>
              <Copy size={13} />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">Returns: <code>&#123; purchase_id, redirect_url, amount, coins, currency &#125;</code> — Redirect user to <code>redirect_url</code>; webhook auto-credits coins on payment success.</p>
        </div>
      </div>
    </div>
  );
}

// ─── Main PaymentGateways Page ────────────────────────────────────────────────
export default function PaymentGateways() {
  const [activeTab, setActiveTab] = useState<'manual' | 'auto' | 'settings'>('manual');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Payment Gateways</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage payment methods. Manual QR for UPI. Auto gateways for web. Webhook config for automatic deposit matching.</p>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b gap-1 overflow-x-auto">
        <button
          onClick={() => setActiveTab('manual')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'manual' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          <QrCode size={15} /> Manual QR / UPI
        </button>
        <button
          onClick={() => setActiveTab('auto')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'auto' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          <CreditCard size={15} /> Auto Gateways
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'settings' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          <Webhook size={15} /> Webhooks & Auto-Match
        </button>
      </div>

      {activeTab === 'manual' ? <ManualQRTab /> : activeTab === 'auto' ? <AutoGatewaysTab /> : <WebhookSettingsTab />}
    </div>
  );
}
