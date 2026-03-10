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
            <div className="app-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
                <div className="panel" style={{ maxWidth: "400px", width: "100%" }}>
                    <h2 style={{ textAlign: "center", marginBottom: "20px" }}>Create Profile</h2>
                    <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        <div>
                            <label>Name</label>
                            <input value={newName} onChange={(e) => setNewName(e.target.value)} required style={{ width: "100%" }} />
                        </div>
                        <div>
                            <label>Age (Optional)</label>
                            <input type="number" value={newAge} onChange={(e) => setNewAge(e.target.value)} style={{ width: "100%" }} />
                        </div>
                        <div>
                            <label>Notes (Optional)</label>
                            <input value={newNotes} onChange={(e) => setNewNotes(e.target.value)} style={{ width: "100%" }} />
                        </div>
                        <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                            <button type="submit" className="btn-primary" style={{ flex: 1 }}>Save Profile</button>
                            {profiles.length > 0 && (
                                <button type="button" className="btn-secondary" onClick={() => setIsCreating(false)} style={{ flex: 1 }}>Cancel</button>
                            )}
                        </div>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="app-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
            <div className="panel" style={{ maxWidth: "500px", width: "100%" }}>
                <h2 style={{ textAlign: "center", marginBottom: "20px" }}>Select Profile</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "60vh", overflowY: "auto" }}>
                    {profiles.map(p => (
                        <div
                            key={p.id}
                            className="info-item"
                            style={{ padding: "15px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px" }}
                        >
                            <div>
                                <strong>{p.name}</strong>
                                {p.age && <span className="profile-meta">Age: {p.age}</span>}
                                {p.notes && <div className="profile-meta" style={{ marginTop: "4px" }}>{p.notes}</div>}
                            </div>
                            <div className="profile-action-row">
                                <button
                                    type="button"
                                    className="btn-primary profile-load-button"
                                    onClick={() => handleSelect(p.id)}
                                >
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
