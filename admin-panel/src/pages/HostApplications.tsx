import React, { useEffect, useState, useCallback } from "react";
import { req } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { CheckCircle, XCircle, RefreshCw, Clock, FileText, Video } from "lucide-react";

type AppStatus = "pending" | "under_review" | "approved" | "rejected";

interface HostApp {
  id: string;
  user_id: string;
  display_name: string;
  email: string;
  gender: string;
  phone: string;
  bio: string;
  specialties: string[];
  languages: string[];
  audio_rate: number;
  video_rate: number;
  status: AppStatus;
  rejection_reason: string | null;
  aadhar_front_url: string | null;
  aadhar_back_url: string | null;
  verification_video_url: string | null;
  submitted_at: number;
  reviewed_at: number | null;
}

const STATUS_VARIANT: Record<AppStatus, string> = {
  pending: "pending",
  under_review: "info",
  approved: "active",
  rejected: "banned",
};

const FILTER_TABS: Array<{ label: string; value: string }> = [
  { label: "All", value: "" },
  { label: "Pending", value: "pending" },
  { label: "Under Review", value: "under_review" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
];

function InfoField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="bg-secondary rounded-xl p-3">
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-foreground capitalize">{value || "—"}</p>
    </div>
  );
}

export default function HostApplicationsPage() {
  const [apps, setApps] = useState<HostApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<HostApp | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [imageModal, setImageModal] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  const fetchApps = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const path = filter ? `/admin/host-applications?status=${filter}` : "/admin/host-applications";
      const data = await req<HostApp[]>("GET", path);
      setApps(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setLoadError(e.message || "Failed to load applications");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchApps(); }, [fetchApps]);

  const handleReview = async (action: "approve" | "reject") => {
    if (!selected) return;
    if (action === "reject" && !rejectReason.trim()) {
      showToast("Please enter a rejection reason.");
      return;
    }
    setReviewing(true);
    try {
      await req("PATCH", `/admin/host-applications/${selected.id}/review`, {
        action,
        rejection_reason: action === "reject" ? rejectReason.trim() : undefined,
      });
      showToast(action === "approve" ? "Application approved!" : "Application rejected.");
      setSelected(null);
      setRejectReason("");
      setShowRejectInput(false);
      await fetchApps();
    } catch (e: any) {
      showToast("Error: " + (e.message || "Something went wrong"));
    } finally {
      setReviewing(false);
    }
  };

  const pendingCount = apps.filter((a) => a.status === "pending" || a.status === "under_review").length;

  return (
    <div className="space-y-5">
      {toast && <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">{toast}</div>}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg">Host KYC Applications</h2>
          <p className="text-sm text-muted-foreground">Review and approve host verification requests</p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="bg-amber-100 text-amber-700 font-bold px-3 py-1.5 rounded-full text-sm">
              {pendingCount} Pending
            </span>
          )}
          <button
            onClick={fetchApps}
            className="flex items-center gap-1.5 border border-border rounded-xl px-3 py-2 text-sm hover:bg-secondary transition-colors"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          Failed to load: {loadError} — <button className="underline font-semibold" onClick={fetchApps}>Retry</button>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              filter === tab.value
                ? "bg-primary/10 border-primary text-primary font-semibold"
                : "border-border text-muted-foreground hover:bg-secondary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          Loading applications...
        </div>
      ) : apps.length === 0 ? (
        <div className="flex items-center justify-center py-16 bg-secondary rounded-2xl text-muted-foreground text-sm">
          No applications found.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-secondary border-b border-border">
                  {["Name", "Email", "Specialties", "Rates", "Status", "Submitted", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {apps.map((app) => (
                  <tr key={app.id} className="border-b border-border/50 hover:bg-secondary/40 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-sm text-foreground">{app.display_name || "—"}</p>
                      <p className="text-xs text-muted-foreground capitalize">{app.gender || ""}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{app.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(app.specialties || []).slice(0, 2).map((s) => (
                          <span key={s} className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-xs">{s}</span>
                        ))}
                        {app.specialties?.length > 2 && (
                          <span className="text-xs text-muted-foreground">+{app.specialties.length - 2}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <div>🎤 {app.audio_rate}/min</div>
                      <div>🎥 {app.video_rate}/min</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[app.status] || "default"}>
                        {app.status.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {app.submitted_at ? new Date(app.submitted_at * 1000).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => { setSelected(app); setShowRejectInput(false); setRejectReason(""); }}
                        className="text-xs font-semibold text-primary hover:underline whitespace-nowrap"
                      >
                        Review →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={!!selected} onClose={() => { setSelected(null); setShowRejectInput(false); setRejectReason(""); }} title="Review Application">
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <InfoField label="Name" value={selected.display_name} />
              <InfoField label="Email" value={selected.email} />
              <InfoField label="Gender" value={selected.gender} />
              <InfoField label="Phone" value={selected.phone} />
              <InfoField label="Audio Rate" value={`${selected.audio_rate} coins/min`} />
              <InfoField label="Video Rate" value={`${selected.video_rate} coins/min`} />
              <InfoField label="Submitted" value={selected.submitted_at ? new Date(selected.submitted_at * 1000).toLocaleString() : "—"} />
              <div className="bg-secondary rounded-xl p-3 flex items-center gap-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Status</p>
                  <Badge variant={STATUS_VARIANT[selected.status] || "default"}>
                    {selected.status.replace("_", " ")}
                  </Badge>
                </div>
              </div>
            </div>

            {(selected.specialties || []).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-foreground mb-2">Specialties</p>
                <div className="flex flex-wrap gap-1.5">
                  {selected.specialties.map((sp) => (
                    <span key={sp} className="bg-primary/10 text-primary px-2.5 py-1 rounded-full text-xs">{sp}</span>
                  ))}
                </div>
              </div>
            )}

            {(selected.languages || []).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-foreground mb-2">Languages</p>
                <div className="flex flex-wrap gap-1.5">
                  {selected.languages.map((l) => (
                    <span key={l} className="bg-secondary border border-border px-2.5 py-1 rounded-full text-xs text-muted-foreground">{l}</span>
                  ))}
                </div>
              </div>
            )}

            {selected.bio && (
              <div>
                <p className="text-xs font-semibold text-foreground mb-1.5">Bio</p>
                <p className="text-sm text-muted-foreground bg-secondary rounded-xl p-3 leading-relaxed">{selected.bio}</p>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-foreground mb-2">KYC Documents</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Aadhar Front", url: selected.aadhar_front_url, isVideo: false },
                  { label: "Aadhar Back", url: selected.aadhar_back_url, isVideo: false },
                  { label: "Video", url: selected.verification_video_url, isVideo: true },
                ].map(({ label, url, isVideo }) => (
                  <div key={label} className="bg-secondary border border-border rounded-xl overflow-hidden">
                    {url ? (
                      isVideo ? (
                        <video src={url} controls className="w-full h-24 object-cover" />
                      ) : (
                        <img
                          src={url} alt={label}
                          className="w-full h-24 object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
                          onClick={() => setImageModal(url)}
                        />
                      )
                    ) : (
                      <div className="h-24 flex flex-col items-center justify-center gap-1 text-muted-foreground">
                        {isVideo ? <Video size={18} /> : <FileText size={18} />}
                        <span className="text-xs">Not uploaded</span>
                      </div>
                    )}
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {selected.rejection_reason && (
              <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                <p className="text-xs font-bold text-red-600 mb-1">Previous Rejection Reason</p>
                <p className="text-sm text-red-700">{selected.rejection_reason}</p>
              </div>
            )}

            {(selected.status === "pending" || selected.status === "under_review") && (
              <div className="space-y-3">
                {showRejectInput && (
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Enter rejection reason (required)..."
                    rows={3}
                    className="w-full border border-red-300 rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
                  />
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleReview("approve")}
                    disabled={reviewing}
                    className="flex items-center justify-center gap-1.5 bg-green-500 text-white rounded-xl py-3 text-sm font-semibold hover:bg-green-600 disabled:opacity-50 transition-colors"
                  >
                    <CheckCircle size={15} /> {reviewing ? "Processing..." : "Approve"}
                  </button>
                  {showRejectInput ? (
                    <button
                      onClick={() => handleReview("reject")}
                      disabled={reviewing || !rejectReason.trim()}
                      className="flex items-center justify-center gap-1.5 bg-red-500 text-white rounded-xl py-3 text-sm font-semibold hover:bg-red-600 disabled:opacity-50 transition-colors"
                    >
                      <XCircle size={15} /> {reviewing ? "Processing..." : "Confirm Reject"}
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowRejectInput(true)}
                      className="flex items-center justify-center gap-1.5 border-2 border-red-400 text-red-500 rounded-xl py-3 text-sm font-semibold hover:bg-red-50 transition-colors"
                    >
                      <XCircle size={15} /> Reject
                    </button>
                  )}
                </div>
              </div>
            )}

            {selected.status === "approved" && (
              <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-center">
                <p className="text-green-700 font-semibold text-sm flex items-center justify-center gap-2">
                  <CheckCircle size={16} /> This application is approved
                </p>
              </div>
            )}

            {selected.status === "rejected" && (
              <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-center">
                <p className="text-red-700 font-semibold text-sm flex items-center justify-center gap-2">
                  <XCircle size={16} /> This application was rejected
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {imageModal && (
        <div
          className="fixed inset-0 bg-black/85 z-[2000] flex items-center justify-center p-5"
          onClick={() => setImageModal(null)}
        >
          <img src={imageModal} alt="Document" className="max-w-full max-h-[90vh] rounded-xl object-contain" />
        </div>
      )}
    </div>
  );
}
