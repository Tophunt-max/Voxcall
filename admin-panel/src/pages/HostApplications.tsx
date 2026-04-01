import React, { useEffect, useState, useCallback } from "react";

const API_URL = import.meta.env.VITE_API_URL || "https://voxlink-api.ssunilkumarmohanta3.workers.dev";
const ADMIN_TOKEN_KEY = "voxlink_admin_token";
function getToken() { return localStorage.getItem(ADMIN_TOKEN_KEY) || ""; }

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

const STATUS_COLORS: Record<AppStatus, { bg: string; text: string; label: string }> = {
  pending:      { bg: "#FEF3C7", text: "#D97706", label: "Pending" },
  under_review: { bg: "#DBEAFE", text: "#1D4ED8", label: "Under Review" },
  approved:     { bg: "#D1FAE5", text: "#059669", label: "Approved" },
  rejected:     { bg: "#FEE2E2", text: "#DC2626", label: "Rejected" },
};

const FILTER_TABS: Array<{ label: string; value: string }> = [
  { label: "All", value: "" },
  { label: "Pending", value: "pending" },
  { label: "Under Review", value: "under_review" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
];

async function apiCall(method: string, path: string, body?: any) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error((err as any).error || res.statusText);
  }
  return res.json();
}

export default function HostApplicationsPage() {
  const [apps, setApps] = useState<HostApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<HostApp | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [imageModal, setImageModal] = useState<string | null>(null);

  const fetchApps = useCallback(async () => {
    setLoading(true);
    try {
      const path = filter ? `/api/admin/host-applications?status=${filter}` : "/api/admin/host-applications";
      const data = await apiCall("GET", path);
      setApps(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchApps(); }, [fetchApps]);

  const handleReview = async (action: "approve" | "reject") => {
    if (!selected) return;
    if (action === "reject" && !rejectReason.trim()) {
      alert("Please enter a rejection reason.");
      return;
    }
    setReviewing(true);
    try {
      await apiCall("PATCH", `/api/admin/host-applications/${selected.id}/review`, {
        action,
        rejection_reason: action === "reject" ? rejectReason.trim() : undefined,
      });
      await fetchApps();
      setSelected(null);
      setRejectReason("");
      setShowRejectInput(false);
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setReviewing(false);
    }
  };

  const pending = apps.filter((a) => a.status === "pending" || a.status === "under_review").length;

  return (
    <div style={{ padding: 28 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#111329" }}>Host KYC Applications</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#84889F" }}>
            Review and approve host verification requests
          </p>
        </div>
        {pending > 0 && (
          <div style={{ backgroundColor: "#FEF3C7", color: "#D97706", fontWeight: 700, padding: "8px 16px", borderRadius: 20, fontSize: 14 }}>
            {pending} Pending Review
          </div>
        )}
      </div>

      {/* Filter Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            style={{
              padding: "8px 18px",
              borderRadius: 20,
              border: "1.5px solid",
              borderColor: filter === tab.value ? "#A00EE7" : "#E5E7EB",
              backgroundColor: filter === tab.value ? "#F4E8FD" : "#fff",
              color: filter === tab.value ? "#A00EE7" : "#6B7280",
              fontWeight: filter === tab.value ? 700 : 400,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {tab.label}
          </button>
        ))}
        <button onClick={fetchApps} style={{ marginLeft: "auto", padding: "8px 16px", borderRadius: 20, border: "1.5px solid #E5E7EB", background: "#fff", cursor: "pointer", fontSize: 14 }}>
          ↻ Refresh
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#84889F" }}>Loading applications...</div>
      ) : apps.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "#84889F", background: "#F8F9FC", borderRadius: 16 }}>
          No applications found.
        </div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E5E7EB", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                {["Name", "Email", "Gender", "Specialties", "Rates", "Status", "Submitted", "Actions"].map((h) => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6B7280", borderBottom: "1px solid #E5E7EB" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => {
                const sc = STATUS_COLORS[app.status] ?? STATUS_COLORS.pending;
                return (
                  <tr key={app.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ padding: "14px 16px", fontWeight: 600, color: "#111329" }}>{app.display_name || "—"}</td>
                    <td style={{ padding: "14px 16px", color: "#6B7280", fontSize: 13 }}>{app.email}</td>
                    <td style={{ padding: "14px 16px", color: "#6B7280", fontSize: 13, textTransform: "capitalize" }}>{app.gender || "—"}</td>
                    <td style={{ padding: "14px 16px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {(app.specialties || []).slice(0, 3).map((s) => (
                          <span key={s} style={{ background: "#F4E8FD", color: "#A00EE7", padding: "2px 8px", borderRadius: 10, fontSize: 12 }}>{s}</span>
                        ))}
                        {app.specialties?.length > 3 && <span style={{ fontSize: 12, color: "#84889F" }}>+{app.specialties.length - 3}</span>}
                      </div>
                    </td>
                    <td style={{ padding: "14px 16px", fontSize: 13, color: "#6B7280" }}>
                      🎤 {app.audio_rate}/min &nbsp; 🎥 {app.video_rate}/min
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span style={{ background: sc.bg, color: sc.text, padding: "4px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600 }}>{sc.label}</span>
                    </td>
                    <td style={{ padding: "14px 16px", fontSize: 13, color: "#84889F" }}>
                      {app.submitted_at ? new Date(app.submitted_at * 1000).toLocaleDateString() : "—"}
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <button
                        onClick={() => { setSelected(app); setShowRejectInput(false); setRejectReason(""); }}
                        style={{ padding: "6px 14px", borderRadius: 8, border: "1.5px solid #A00EE7", background: "#F4E8FD", color: "#A00EE7", fontWeight: 600, cursor: "pointer", fontSize: 13 }}
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Review Modal */}
      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 32, maxWidth: 680, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#111329" }}>Review Application</h2>
              <button onClick={() => setSelected(null)} style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: "#84889F" }}>×</button>
            </div>

            {/* Basic Info */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Name", value: selected.display_name },
                { label: "Email", value: selected.email },
                { label: "Gender", value: selected.gender },
                { label: "Phone", value: selected.phone },
                { label: "Audio Rate", value: `${selected.audio_rate} coins/min` },
                { label: "Video Rate", value: `${selected.video_rate} coins/min` },
                { label: "Status", value: STATUS_COLORS[selected.status]?.label },
                { label: "Submitted", value: selected.submitted_at ? new Date(selected.submitted_at * 1000).toLocaleString() : "—" },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: "#F8F9FC", padding: 12, borderRadius: 10 }}>
                  <div style={{ fontSize: 11, color: "#84889F", marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#111329" }}>{value || "—"}</div>
                </div>
              ))}
            </div>

            {/* Specialties */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111329", marginBottom: 8 }}>Specialties</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(selected.specialties || []).map((sp) => (
                  <span key={sp} style={{ background: "#F4E8FD", color: "#A00EE7", padding: "4px 12px", borderRadius: 12, fontSize: 13 }}>{sp}</span>
                ))}
              </div>
            </div>

            {/* Bio */}
            {selected.bio && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#111329", marginBottom: 6 }}>Bio</div>
                <p style={{ margin: 0, fontSize: 14, color: "#84889F", lineHeight: 1.6, background: "#F8F9FC", padding: 12, borderRadius: 10 }}>{selected.bio}</p>
              </div>
            )}

            {/* KYC Documents */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111329", marginBottom: 12 }}>KYC Documents</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {[
                  { label: "Aadhar Front", url: selected.aadhar_front_url },
                  { label: "Aadhar Back", url: selected.aadhar_back_url },
                  { label: "Video", url: selected.verification_video_url, isVideo: true },
                ].map(({ label, url, isVideo }) => (
                  <div key={label} style={{ background: "#F8F9FC", borderRadius: 12, overflow: "hidden", border: "1px solid #E5E7EB" }}>
                    {url ? (
                      isVideo ? (
                        <video src={url} controls style={{ width: "100%", height: 100, objectFit: "cover" }} />
                      ) : (
                        <img
                          src={url}
                          alt={label}
                          style={{ width: "100%", height: 100, objectFit: "cover", cursor: "pointer" }}
                          onClick={() => setImageModal(url)}
                        />
                      )
                    ) : (
                      <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center", color: "#84889F", fontSize: 12 }}>Not uploaded</div>
                    )}
                    <div style={{ padding: "8px 10px", fontSize: 12, fontWeight: 600, color: "#6B7280" }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Rejection reason (if previously rejected) */}
            {selected.rejection_reason && (
              <div style={{ background: "#FEE2E2", borderRadius: 10, padding: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#DC2626", marginBottom: 4 }}>Previous Rejection Reason</div>
                <div style={{ fontSize: 14, color: "#6B7280" }}>{selected.rejection_reason}</div>
              </div>
            )}

            {/* Action Buttons */}
            {(selected.status === "pending" || selected.status === "under_review") && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {showRejectInput && (
                  <div>
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Enter rejection reason (required)..."
                      style={{ width: "100%", borderRadius: 10, border: "1.5px solid #EF4444", padding: 12, fontSize: 14, fontFamily: "inherit", resize: "vertical", minHeight: 80, boxSizing: "border-box" }}
                    />
                  </div>
                )}
                <div style={{ display: "flex", gap: 12 }}>
                  <button
                    onClick={() => handleReview("approve")}
                    disabled={reviewing}
                    style={{ flex: 1, padding: "14px 0", borderRadius: 12, border: "none", background: "#22C55E", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer" }}
                  >
                    {reviewing ? "Processing..." : "✓ Approve"}
                  </button>
                  {showRejectInput ? (
                    <button
                      onClick={() => handleReview("reject")}
                      disabled={reviewing || !rejectReason.trim()}
                      style={{ flex: 1, padding: "14px 0", borderRadius: 12, border: "none", background: "#EF4444", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", opacity: !rejectReason.trim() ? 0.5 : 1 }}
                    >
                      {reviewing ? "Processing..." : "✗ Confirm Reject"}
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowRejectInput(true)}
                      style={{ flex: 1, padding: "14px 0", borderRadius: 12, border: "2px solid #EF4444", background: "#fff", color: "#EF4444", fontWeight: 700, fontSize: 15, cursor: "pointer" }}
                    >
                      ✗ Reject
                    </button>
                  )}
                </div>
              </div>
            )}
            {selected.status === "approved" && (
              <div style={{ background: "#D1FAE5", borderRadius: 12, padding: 16, textAlign: "center", color: "#059669", fontWeight: 700, fontSize: 15 }}>
                ✓ This application is approved
              </div>
            )}
          </div>
        </div>
      )}

      {/* Image lightbox */}
      {imageModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setImageModal(null)}>
          <img src={imageModal} alt="Document" style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 12 }} />
        </div>
      )}
    </div>
  );
}
