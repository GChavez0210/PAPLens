import { useState, useEffect } from "react";

export function ProfileSelector({ onSelect }) {
    const [profiles, setProfiles] = useState([]);
    const [isCreating, setIsCreating] = useState(false);
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
                            style={{ cursor: "pointer", padding: "15px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                            onClick={() => handleSelect(p.id)}
                        >
                            <div>
                                <strong>{p.name}</strong>
                                {p.age && <span style={{ marginLeft: "10px", fontSize: "0.8em", color: "var(--muted)" }}>Age: {p.age}</span>}
                                {p.notes && <div style={{ fontSize: "0.8em", color: "var(--muted)", marginTop: "4px" }}>{p.notes}</div>}
                            </div>
                            <span style={{ fontSize: "1.2em", color: "var(--brand)" }}>→</span>
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
