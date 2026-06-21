import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useReviewStore } from "../store/reviewStore";

const ACCEPTED = ".pdf,.docx,.doc";
const MAX_MB = 50;

export function ContractUpload() {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const { uploadContract, loading, error, clearError } = useReviewStore();
  const navigate = useNavigate();

  const handleFile = (f: File) => {
    if (f.size > MAX_MB * 1024 * 1024) {
      alert(`File must be under ${MAX_MB} MB`);
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
    clearError();
    const contract = await uploadContract(file);
    navigate(`/review/${contract.id}`);
  };

  return (
    <div className="upload-wrapper">
      <div
        className={`dropzone ${dragging ? "dropzone--active" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
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
        <div className="dropzone__icon">📄</div>
        {file ? (
          <p className="dropzone__filename">{file.name}</p>
        ) : (
          <>
            <p className="dropzone__primary">Drop a contract here</p>
            <p className="dropzone__secondary">PDF or DOCX, up to {MAX_MB} MB</p>
          </>
        )}
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
          <button className="alert__close" onClick={clearError}>✕</button>
        </div>
      )}

      <button
        className="btn btn--primary btn--full"
        onClick={onSubmit}
        disabled={!file || loading}
      >
        {loading ? "Uploading…" : "Start AI Review"}
      </button>
    </div>
  );
}
