import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useReviewStore } from "../store/reviewStore";

const ACCEPTED = ".pdf,.docx,.doc";
const ACCEPTED_EXTENSIONS = ACCEPTED.split(",");
const MAX_MB = 50;

export function ContractUpload() {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState("");
  const { uploadContract, loading, error, clearError } = useReviewStore();
  const navigate = useNavigate();

  // handles both the file picker (already filtered by `accept`) and
  // drag-and-drop, which ignores `accept` entirely — without this check a
  // dropped .txt or .exe was silently accepted with no feedback at all.
  const handleFile = (f: File) => {
    setLocalError("");
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setLocalError(`Unsupported file type "${ext}" — upload a PDF, DOC, or DOCX file`);
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setLocalError(`File must be under ${MAX_MB} MB (this file is ${(f.size / 1024 / 1024).toFixed(1)} MB)`);
      return;
    }
    setFile(f);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const onSubmit = async () => {
    if (!file) return;
    setLocalError("");
    clearError();
    try {
      const contract = await uploadContract(file);
      navigate(`/review/${contract.id}`);
    } catch (e) {
      // Error handled by store
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = 2;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  return (
    <div className="upload-wrapper">
      <div
        className={`dropzone ${dragging ? "dropzone--active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => document.getElementById("file-input")?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload contract"
      >
        <input
          id="file-input"
          type="file"
          accept={ACCEPTED}
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        
        <div className="dropzone__icon">
          {file ? (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.5">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <path d="M8 13h8M8 17h8" />
            </svg>
          ) : (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-dim)" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
          )}
        </div>

        {file ? (
          <div>
            <p className="dropzone__filename">{file.name}</p>
            <p className="dropzone__secondary" style={{ marginTop: "4px" }}>
              Ready for ingestion • {formatSize(file.size)}
            </p>
          </div>
        ) : (
          <>
            <p className="dropzone__primary">Drag & drop contract files here</p>
            <p className="dropzone__secondary">PDF, DOC, or DOCX formats supported (up to {MAX_MB} MB)</p>
          </>
        )}
      </div>

      {(localError || error) && (
        <div className="alert alert--error" role="alert">
          <div>
            <strong style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem", fontWeight: "700" }}>
              {localError ? "Invalid File" : "Ingestion Failed"}
            </strong>
            <span style={{ fontSize: "0.8rem" }}>{localError || error}</span>
          </div>
          <button
            className="alert__close"
            onClick={() => {
              setLocalError("");
              clearError();
            }}
          >
            ✕
          </button>
        </div>
      )}

      {loading && (
        <div style={{ width: "100%", background: "var(--color-border)", height: "4px", borderRadius: "99px", overflow: "hidden" }}>
          <div
            style={{
              width: "40%",
              background: "var(--color-accent)",
              height: "100%",
              borderRadius: "99px",
              animation: "loading-progress 1.5s infinite ease-in-out"
            }}
          />
          <style>{`
            @keyframes loading-progress {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(250%); }
            }
          `}</style>
        </div>
      )}

      <button
        className="btn btn--primary btn--full"
        onClick={onSubmit}
        disabled={!file || loading}
      >
        {loading ? (
          <>
            <span className="spinner spinner--sm" style={{ borderTopColor: "#fff" }} />
            <span>Analyzing Document with Agents…</span>
          </>
        ) : (
          "Initiate AI Pipeline"
        )}
      </button>
    </div>
  );
}
