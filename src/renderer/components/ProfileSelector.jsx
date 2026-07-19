import { useState, useEffect } from "react";

export function ProfileSelector({ onSelect }) {
  const [profiles, setProfiles] = useState([]);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [newName, setNewName] = useState("");
  const [newAge, setNewAge] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const loadProfiles = async () => {
    const data = await window.cpapAPI.getProfiles();
    setProfiles(data || []);
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const id = crypto.randomUUID();
    await window.cpapAPI.createProfile({
      id,
      name: newName.trim(),
      age: newAge ? parseInt(newAge, 10) : null,
      notes: newNotes.trim() || null
    });
    setIsCreating(false);
    setNewName("");
    setNewAge("");
    setNewNotes("");
    await loadProfiles();
  };

  const handleSelect = async (id) => {
    await window.cpapAPI.setActiveProfile(id);
    onSelect(id);
  };

  const handleDelete = async (profile) => {
    const confirmed = window.confirm(
      `Permanently delete "${profile.name}" and all data stored for this profile? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingId(profile.id);
    try {
      const result = await window.cpapAPI.deleteProfile(profile.id);
      if (!result?.success) {
        window.alert(result?.error || "Profile deletion failed.");
        return;
      }
      await loadProfiles();
    } finally {
      setDeletingId(null);
    }
  };

  if (isCreating || profiles.length === 0) {
    return (
      <div className="app-shell profile-screen">
        <div className="panel profile-panel profile-panel-compact">
          <ProfileHeader
            title="Create Profile"
            subtitle="Keep each patient’s therapy data securely separated on this device."
          />
          <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div>
              <label htmlFor="profile-name">Name</label>
              <input
                id="profile-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label htmlFor="profile-age">Age (Optional)</label>
              <input
                id="profile-age"
                type="number"
                value={newAge}
                onChange={(e) => setNewAge(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label htmlFor="profile-notes">Notes (Optional)</label>
              <input
                id="profile-notes"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
              <button type="submit" className="btn-primary" style={{ flex: 1 }}>
                Save Profile
              </button>
              {profiles.length > 0 && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsCreating(false)}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell profile-screen">
      <div className="panel profile-panel">
        <ProfileHeader title="Select Profile" subtitle="Choose a local workspace to review therapy data." />
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "60vh", overflowY: "auto" }}>
          {profiles.map((p) => (
            <div
              key={p.id}
              className="info-item"
              style={{
                padding: "15px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "16px"
              }}
            >
              <div>
                <strong>{p.name}</strong>
                {p.age && <span className="profile-meta">Age: {p.age}</span>}
                {p.notes && (
                  <div className="profile-meta" style={{ marginTop: "4px" }}>
                    {p.notes}
                  </div>
                )}
              </div>
              <div className="profile-action-row">
                <button type="button" className="btn-primary profile-load-button" onClick={() => handleSelect(p.id)}>
                  Load Profile
                </button>
                <button
                  type="button"
                  className="btn-secondary profile-delete-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(p);
                  }}
                  disabled={deletingId === p.id}
                  aria-label={deletingId === p.id ? `Deleting ${p.name}` : `Delete ${p.name}`}
                  title={deletingId === p.id ? "Deleting profile" : `Delete ${p.name}`}
                >
                  {deletingId === p.id ? (
                    <span aria-hidden="true">...</span>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v8h-2v-8Zm4 0h2v8h-2v-8ZM7 10h2v8H7v-8Zm-1 10h12l1-12H5l1 12Z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          className="btn-secondary"
          onClick={() => setIsCreating(true)}
          style={{ width: "100%", marginTop: "20px" }}
        >
          + Create New Profile
        </button>
      </div>
    </div>
  );
}

function ProfileHeader({ title, subtitle }) {
  return (
    <header className="profile-header">
      <img src={new URL("../assets/PLIcon.png", import.meta.url).href} alt="" aria-hidden="true" />
      <div>
        <div className="section-eyebrow">PAPLens clinical workspace</div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </header>
  );
}
